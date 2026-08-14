use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use super::job_object::JobHandle;

const SERVER_PORT: u16 = 43124;
/// If the default port is blocked (e.g. by Hyper-V/HNS port reservation on
/// Windows), try up to this many consecutive ports before giving up.
const PORT_FALLBACK_RANGE: u16 = 200;
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Try to find a port that can be bound on 127.0.0.1, starting from
/// `SERVER_PORT` and incrementing up to `PORT_FALLBACK_RANGE` times.
/// Returns the first port where a TCP listener can be opened, or the
/// original `SERVER_PORT` if none work (sidecar will try and fail with a
/// clear error).
fn find_available_port() -> u16 {
    for offset in 0..PORT_FALLBACK_RANGE {
        let port = SERVER_PORT + offset;
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            if offset > 0 {
                log::warn!(
                    "[server] Port {} blocked (likely Hyper-V/HNS reservation), using {} instead",
                    SERVER_PORT, port
                );
            }
            return port;
        }
    }
    log::error!(
        "[server] No available port found in range {}-{}, falling back to {}",
        SERVER_PORT, SERVER_PORT + PORT_FALLBACK_RANGE - 1, SERVER_PORT
    );
    SERVER_PORT
}

/// Prevent a console window from appearing when spawning the sidecar on Windows.
fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Send SIGTERM first, wait briefly, then SIGKILL if the process is still alive.
/// This gives the sidecar a chance to disconnect DingTalk Stream gracefully.
fn graceful_kill(child: &mut Child) {
    #[cfg(unix)]
    {
        // Send SIGTERM via kill command
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(child.id().to_string())
            .output();
        let deadline = Instant::now() + Duration::from_millis(1500);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                _ => {}
            }
            if Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Check if the given TCP port is currently accepting connections on 127.0.0.1.
fn is_port_in_use(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    if let Ok(socket_addr) = addr.parse() {
        std::net::TcpStream::connect_timeout(&socket_addr, Duration::from_millis(200)).is_ok()
    } else {
        false
    }
}

/// Verify that the server listening on the port is actually our server AND
/// running the same version. Returns true only if it's healthy and version-matched.
fn is_our_server_healthy(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    match client.get(&url).send() {
        Ok(resp) => {
            if !resp.status().is_success() {
                return false;
            }
            let expected = env!("CARGO_PKG_VERSION");
            match resp.json::<serde_json::Value>() {
                Ok(body) => body.get("version")
                    .and_then(|v| v.as_str())
                    .map(|v| v == expected)
                    .unwrap_or(false),
                Err(_) => false,
            }
        }
        Err(_) => false,
    }
}

/// If the given port is held by a non-AmbiCrew process (or a stale orphan from
/// a previous run), kill it and wait briefly for the port to be released.
/// Best-effort: returns Ok even if we couldn't kill, to allow startup to proceed.
fn kill_existing_on_port(port: u16) {
    if !is_port_in_use(port) {
        return;
    }

    log::warn!("[server] Port {} occupied — attempting to kill orphan process", port);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        // lsof -ti :PORT  prints one PID per line
        if let Ok(output) = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
        {
            let pids = String::from_utf8_lossy(&output.stdout);
            for pid in pids.lines() {
                let pid = pid.trim();
                if pid.is_empty() {
                    continue;
                }
                let _ = Command::new("kill").args(["-9", pid]).output();
                log::info!("[server] Killed orphan process {} on port {}", pid, port);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // netstat -ano | findstr :PORT  →  parse PID from last column
        if let Ok(output) = Command::new("netstat").args(["-ano", "-p", "TCP"]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let needle_local = format!(":{} ", port);
            let needle_listening = "LISTENING";
            for line in stdout.lines() {
                if !line.contains(&needle_local) || !line.contains(needle_listening) {
                    continue;
                }
                if let Some(pid) = line.split_whitespace().last() {
                    if pid.chars().all(|c| c.is_ascii_digit()) {
                        let _ = Command::new("taskkill")
                            .args(["/F", "/PID", pid])
                            .output();
                        log::info!("[server] Killed orphan process {} on port {}", pid, port);
                    }
                }
            }
        }
    }

    // Wait up to 2 seconds for the port to be released
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if !is_port_in_use(port) {
            log::info!("[server] Port {} released", port);
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    log::warn!("[server] Port {} still in use after kill attempt", port);
}

/// Best-effort cleanup for adapter sidecars left behind by a previous app
/// instance. Adapter sidecars don't hold a local TCP port, so port cleanup can't
/// find them; kill by executable/script name before starting the new owner.
fn kill_stale_adapter_sidecars() {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let patterns = ["adapter-sidecar", "desktop/sidecars/adapter-sidecar.ts"];
        for pattern in patterns {
            let _ = Command::new("pkill").args(["-f", pattern]).output();
        }
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "adapter-sidecar.exe"])
            .output();

        let script = r#"Get-CimInstance Win32_Process |
Where-Object { $_.Name -eq 'bun.exe' -and $_.CommandLine -like '*desktop/sidecars/adapter-sidecar.ts*' } |
ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"#;
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output();
    }
}

/// Read ~/.claude/adapters.json and return the flags needed to start the
/// adapter sidecar (--dingtalk, --feishu, --wechat, --telegram). Returns an
/// empty Vec if no adapters are configured with credentials.
fn build_adapter_flags() -> Vec<String> {
    let config_path = match dirs::home_dir() {
        Some(home) => home.join(".claude").join("adapters.json"),
        None => return vec![],
    };

    let raw = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let json: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let mut flags: Vec<String> = Vec::new();

    // DingTalk: needs clientId + clientSecret (from registration poll)
    if has_credential(&json, "dingtalk", "clientId") && has_credential(&json, "dingtalk", "clientSecret") {
        flags.push("--dingtalk".to_string());
    }

    // Feishu: needs appId + appSecret
    if has_credential(&json, "feishu", "appId") && has_credential(&json, "feishu", "appSecret") {
        flags.push("--feishu".to_string());
    }

    // WeChat: needs accountId + botToken (from QR binding)
    if has_credential(&json, "wechat", "accountId") && has_credential(&json, "wechat", "botToken") {
        flags.push("--wechat".to_string());
    }

    // Telegram: needs botToken
    if has_credential(&json, "telegram", "botToken") {
        flags.push("--telegram".to_string());
    }

    flags
}

fn has_credential(json: &serde_json::Value, platform: &str, key: &str) -> bool {
    json.get(platform)
        .and_then(|p| p.get(key))
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false)
}

pub struct ServerState {
    pub server_process: Mutex<Option<Child>>,
    pub adapter_process: Mutex<Option<Child>>,
    pub server_url: Arc<Mutex<Option<String>>>,
    starting: Mutex<bool>,
    // JobObject handles bind sidecar children to the main process lifetime on
    // Windows: when these are dropped (either via stop_server or because the
    // main process died), the kernel terminates every assigned child.
    // No-op on Unix — see commands/job_object.rs for the rationale.
    server_job: Mutex<Option<JobHandle>>,
    adapter_job: Mutex<Option<JobHandle>>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            server_process: Mutex::new(None),
            adapter_process: Mutex::new(None),
            server_url: Arc::new(Mutex::new(None)),
            starting: Mutex::new(false),
            server_job: Mutex::new(None),
            adapter_job: Mutex::new(None),
        }
    }
}

fn get_sidecar_path(app: &AppHandle, name: &str) -> String {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let binary_name = format!("{}{}", name, ext);

    // Tauri v2 places externalBin sidecars next to the main binary:
    //   macOS:   AppName.app/Contents/MacOS/
    //   Windows: same directory as the .exe
    //   Linux:   same directory as the binary
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join(&binary_name);
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    // Fallback: try resource_dir (works on Windows where resource_dir == exe dir)
    app.path()
        .resource_dir()
        .map(|dir| {
            dir.join(&binary_name)
                .to_string_lossy()
                .to_string()
        })
        .unwrap_or_else(|_| binary_name)
}

fn get_resource_dir(app: &AppHandle) -> String {
    app.path()
        .resource_dir()
        .map(|d| d.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Auto-start the server sidecar on app launch (blocking, call from spawn_blocking).
pub fn auto_start_sync(app: &AppHandle) -> Result<(), String> {
    start_server_inner(app)
}

#[tauri::command]
pub async fn start_server(app: AppHandle) -> Result<String, String> {
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || start_server_inner(&app_clone))
        .await
        .map_err(|e| format!("Server start task panicked: {}", e))??;
    let state = app.state::<ServerState>();
    let url = state.server_url.lock().unwrap().clone();
    Ok(url.unwrap_or_default())
}

fn start_server_inner(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ServerState>();

    // Already running?
    if state.server_url.lock().unwrap().is_some() {
        return Ok(());
    }

    // Prevent concurrent startup attempts
    {
        let mut starting = state.starting.lock().unwrap();
        if *starting {
            return Ok(());
        }
        *starting = true;
    }

    // Find an available port — the default 43124 may be blocked by Windows
    // Hyper-V/HNS port reservations (a known issue in WSL/Docker environments
    // where kernel-level port reservations don't appear in netstat but block
    // all TCP binds). If the default port is blocked, try consecutive ports
    // up to PORT_FALLBACK_RANGE.
    let port = find_available_port();

    // If the port is occupied, check whether it's a healthy AmbiCrew server we
    // can reuse (e.g. crash-recovery). If not, kill the orphan so the new
    // sidecar can bind successfully — otherwise users see "Server not ready"
    // on app reopen after a hard kill.
    //
    // Dev mode: never reuse — code changes between launches must take effect,
    // and a stale Bun process running yesterday's code would silently mask
    // edits to TypeScript files.
    if is_port_in_use(port) {
        #[cfg(not(debug_assertions))]
        if is_our_server_healthy(port) {
            let url = format!("http://127.0.0.1:{}", port);
            *state.server_url.lock().unwrap() = Some(url.clone());
            *state.starting.lock().unwrap() = false;
            log::info!("[tauri] Reusing existing healthy server at {}", url);
            return Ok(());
        }
        kill_existing_on_port(port);
    }

    let resource_dir = get_resource_dir(app);
    let sidecar_path = get_sidecar_path(app, "claude-sidecar");
    log::info!("[tauri] Sidecar path: {}", sidecar_path);

    let spawn_result = if cfg!(debug_assertions) {
        // Dev mode: CARGO_MANIFEST_DIR is always desktop/src-tauri at compile time
        let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors().nth(2).unwrap().to_path_buf();
        let env_file = repo_root.join(".env");
        let mut cmd = Command::new("bun");
        cmd.arg("run");
        if env_file.exists() {
            cmd.arg(format!("--env-file={}", env_file.to_string_lossy()));
        }
        cmd.arg("src/server/index.ts")
            .current_dir(&repo_root)
            .env("SERVER_PORT", port.to_string())
            .env("DESKTOP_MODE", "1")
            .env("CLAUDE_RUNTIME_DIR", repo_root.join("runtime").to_string_lossy().to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut cmd);
        cmd.spawn()
            .map_err(|e| format!("Failed to spawn bun server: {}", e))
    } else {
        // Packaged mode: use compiled sidecar
        let mut cmd = Command::new(&sidecar_path);
        cmd.args(["server", "--app-root", &resource_dir])
            .env("SERVER_PORT", port.to_string())
            .env("DESKTOP_MODE", "1")
            .env("CLAUDE_RUNTIME_DIR", format!("{}/runtime", resource_dir))
            .env("CLAUDE_APP_ROOT", &resource_dir)
            .env("AUTH_MODE", std::env::var("AUTH_MODE").unwrap_or_else(|_| "central".to_string()))
            .env("LLM_PROXY_BASE_URL", std::env::var("LLM_PROXY_BASE_URL").unwrap_or_else(|_| "https://crew.ambilight.com/woicrew/proxy".to_string()))
            .env("CREWCENTRAL_AUTH_LOGIN_URL", std::env::var("CREWCENTRAL_AUTH_LOGIN_URL").unwrap_or_else(|_| "https://crew.ambilight.com/woicrew/auth/login".to_string()))
            // Disable non-essential outbound traffic by default in packaged mode.
            // Without these the upstream CLI/SDK silently fires off telemetry,
            // MCP registry queries, Statsig flag fetches etc — on slow/cross-region
            // links those requests stall every turn and make the bundled app feel
            // markedly less responsive than the dev build (which loads them from .env).
            .env("DISABLE_TELEMETRY", std::env::var("DISABLE_TELEMETRY").unwrap_or_else(|_| "1".to_string()))
            .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", std::env::var("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC").unwrap_or_else(|_| "1".to_string()))
            // Auth helpers that dev mode also reads from .env; mirroring the
            // values here keeps the OAuth deep-link / api base derivation
            // consistent between dev and packaged runs.
            .env("AUTH_CALLBACK_SCHEME", std::env::var("AUTH_CALLBACK_SCHEME").unwrap_or_else(|_| "testcrew".to_string()))
            .env("AUTH_SERVER_BASE_URL", std::env::var("AUTH_SERVER_BASE_URL").unwrap_or_else(|_| "https://crew.ambilight.com/woicrew".to_string()))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Bundle the CrewProxy CA root certificate so Bun's TLS (BoringSSL)
        // trusts the proxy endpoint on systems where the CA is not in the
        // system trust store (e.g. macOS without the cert in Keychain).
        // The cert file lives in desktop/resources/certs/ and is packaged
        // into the .app via tauri.conf.json "resources".
        let ca_cert_path = format!("{}/certs/crew-proxy-ca.crt", resource_dir);
        if std::path::Path::new(&ca_cert_path).exists() {
            cmd.env("NODE_EXTRA_CA_CERTS", &ca_cert_path);
        }
        hide_console(&mut cmd);
        cmd.spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))
    };

    let mut child = match spawn_result {
        Ok(c) => c,
        Err(e) => {
            *state.starting.lock().unwrap() = false;
            return Err(e);
        }
    };

    // Bind the sidecar to a JobObject (Windows only — no-op on Unix) so it
    // dies with us no matter how the main process exits. Best-effort: if
    // job creation/assignment fails we log and continue, because losing
    // orphan-protection is strictly better than refusing to start.
    match JobHandle::new().and_then(|j| j.assign(child.id()).map(|_| j)) {
        Ok(job) => {
            *state.server_job.lock().unwrap() = Some(job);
        }
        Err(e) => {
            log::warn!("[tauri] Server JobObject setup failed: {} (sidecar may orphan if app is force-killed)", e);
        }
    }

    // Drain stderr in a background thread so startup errors are visible
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                log::error!("[server stderr] {}", line);
            }
        });
    }

    // Wait for server to be ready via stdout signal OR TCP polling (10s timeout)
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut found_signal = false;

    if let Some(stdout) = child.stdout.take() {
        // Read stdout in a background thread, signal via channel
        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        let server_url_clone = state.server_url.clone();
        let port_for_reader = port;
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        log::info!("[server] {}", text);
                        if text.contains("running at") {
                            let url = format!("http://127.0.0.1:{}", port_for_reader);
                            *server_url_clone.lock().unwrap() = Some(url.clone());
                            log::info!("[tauri] Server started at {}", url);
                            let _ = tx.send(true);
                            return;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = tx.send(false);
        });

        // Wait for stdout signal or timeout, with TCP fallback polling
        loop {
            if let Ok(result) = rx.try_recv() {
                found_signal = result;
                break;
            }
            if Instant::now() >= deadline {
                break;
            }
            // TCP fallback: check if port is already listening, AND verify it's
            // our healthy server (not an orphan from a previous run).
            //
            // We do NOT kill an unresponsive listener here, even though it looks
            // like a stale orphan: in the first 1-2 seconds after bind() our own
            // freshly-spawned sidecar will look exactly like one (port listening
            // but /health route not registered yet). Killing it triggers a
            // spawn → bind → self-kill → respawn loop that surfaces as terminal
            // windows flashing open and closed.
            //
            // Orphans from previous runs are already handled by the one-shot
            // kill_existing_on_port() call before spawn (see start_server_inner
            // above). If something binds the port mid-startup that isn't us,
            // we'll time out cleanly and the next launch will clean it up.
            if is_port_in_use(port) && is_our_server_healthy(port) {
                let url = format!("http://127.0.0.1:{}", port);
                *state.server_url.lock().unwrap() = Some(url.clone());
                log::info!("[tauri] Server detected via TCP+health at {}", url);
                found_signal = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }

    if !found_signal && state.server_url.lock().unwrap().is_none() {
        log::error!("[tauri] Server did not start within 10 seconds");
    }

    *state.server_process.lock().unwrap() = Some(child);
    *state.starting.lock().unwrap() = false;
    Ok(())
}

#[tauri::command]
pub fn get_server_url(state: tauri::State<'_, ServerState>) -> Option<String> {
    state.server_url.lock().unwrap().clone()
}

#[tauri::command]
pub fn stop_server(state: tauri::State<'_, ServerState>) {
    if let Some(mut child) = state.adapter_process.lock().unwrap().take() {
        graceful_kill(&mut child);
    }
    if let Some(mut child) = state.server_process.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    // Drop job handles AFTER killing children directly. Dropping the job alone
    // would also kill the children (KILL_ON_JOB_CLOSE), but going through the
    // existing Child::kill path first lets graceful_kill do SIGTERM on Unix
    // and keeps the orderly-shutdown semantics unchanged. The job drop here is
    // belt-and-suspenders for the Windows force-quit path.
    let _ = state.adapter_job.lock().unwrap().take();
    let _ = state.server_job.lock().unwrap().take();
    *state.server_url.lock().unwrap() = None;
}

#[tauri::command]
pub async fn restart_adapters(app: AppHandle) -> Result<(), String> {
    let state = app.state::<ServerState>();

    // Gracefully stop existing adapter sidecar
    if let Some(mut child) = state.adapter_process.lock().unwrap().take() {
        graceful_kill(&mut child);
    }
    // Drop the previous job handle so the kernel cleans up any stragglers that
    // didn't die in graceful_kill (Windows-only effect; no-op on Unix).
    let _ = state.adapter_job.lock().unwrap().take();
    kill_stale_adapter_sidecars();

    let resource_dir = get_resource_dir(&app);
    let sidecar_path = get_sidecar_path(&app, "adapter-sidecar");
    let server_url = state.server_url.lock().unwrap().clone()
        .unwrap_or_else(|| format!("http://127.0.0.1:{}", SERVER_PORT));

    // Read adapter config to decide which IM adapters to enable.
    // The adapter-sidecar requires explicit flags (--feishu, --telegram,
    // --wechat, --dingtalk) to know which adapters to start. Without them
    // it exits immediately with code 2 and no adapter runs.
    let adapter_flags = build_adapter_flags();
    log::info!("[tauri] Adapter flags: {:?}", adapter_flags);

    if adapter_flags.is_empty() {
        log::info!("[tauri] No adapters configured — skipping adapter sidecar");
        *state.adapter_process.lock().unwrap() = None;
        return Ok(());
    }

    let parent_pid = std::process::id().to_string();

    let mut child = if cfg!(debug_assertions) {
        // Dev mode: bun needs to run from the repo root so it can resolve
        // sidecars/adapter-sidecar.ts (Tauri's CWD is desktop/src-tauri/).
        let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors().nth(2).unwrap().to_path_buf();
        let mut cmd = Command::new("bun");
        cmd.args(["run", "desktop/sidecars/adapter-sidecar.ts", "--parent-pid", &parent_pid]);
        for flag in &adapter_flags {
            cmd.arg(flag);
        }
        cmd.current_dir(&repo_root)
            .env("ADAPTER_SERVER_URL", &server_url)
            .env("AMBICREW_PARENT_PID", &parent_pid)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut cmd);
        cmd.spawn()
            .map_err(|e| format!("Failed to spawn adapter sidecar: {}", e))?
    } else {
        let mut cmd = Command::new(&sidecar_path);
        cmd.args(["--parent-pid", &parent_pid]);
        for flag in &adapter_flags {
            cmd.arg(flag);
        }
        cmd.env("ADAPTER_SERVER_URL", &server_url)
            .env("CLAUDE_APP_ROOT", &resource_dir)
            .env("AMBICREW_PARENT_PID", &parent_pid)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut cmd);
        cmd.spawn()
            .map_err(|e| format!("Failed to spawn adapter sidecar: {}", e))?
    };

    // Bind the adapter sidecar to a JobObject so it dies with the main process
    // even on force-kill. See server_job above for the full rationale.
    // Best-effort: keep going if it fails.
    match JobHandle::new().and_then(|j| j.assign(child.id()).map(|_| j)) {
        Ok(job) => {
            *state.adapter_job.lock().unwrap() = Some(job);
        }
        Err(e) => {
            log::warn!("[tauri] Adapter JobObject setup failed: {} (sidecar may orphan if app is force-killed)", e);
        }
    }

    // Drain stdout/stderr in background threads so adapter logs are visible
    // and pipe buffers never fill up and block the child process.
    // stdout → info (normal output); stderr → warn (worth attention but not
    // necessarily an error — Node/Bun write a lot of diagnostics to stderr).
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                log::info!("[adapter] {}", line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                log::warn!("[adapter stderr] {}", line);
            }
        });
    }

    *state.adapter_process.lock().unwrap() = Some(child);
    Ok(())
}
