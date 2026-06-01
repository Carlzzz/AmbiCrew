use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const SERVER_PORT: u16 = 43124;
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

/// Check if the given TCP port is currently accepting connections on 127.0.0.1.
fn is_port_in_use(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    if let Ok(socket_addr) = addr.parse() {
        std::net::TcpStream::connect_timeout(&socket_addr, Duration::from_millis(200)).is_ok()
    } else {
        false
    }
}

/// Verify that the server listening on the port is actually responding to
/// /health. Returns true if it's our (healthy) server, false if it's an
/// orphan/stale process that should be killed.
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
        Ok(resp) => resp.status().is_success(),
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

pub struct ServerState {
    pub server_process: Mutex<Option<Child>>,
    pub adapter_process: Mutex<Option<Child>>,
    pub server_url: Arc<Mutex<Option<String>>>,
    starting: Mutex<bool>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            server_process: Mutex::new(None),
            adapter_process: Mutex::new(None),
            server_url: Arc::new(Mutex::new(None)),
            starting: Mutex::new(false),
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

    // If the port is occupied, check whether it's a healthy AmbiCrew server we
    // can reuse (e.g. crash-recovery). If not, kill the orphan so the new
    // sidecar can bind successfully — otherwise users see "Server not ready"
    // on app reopen after a hard kill.
    //
    // Dev mode: never reuse — code changes between launches must take effect,
    // and a stale Bun process running yesterday's code would silently mask
    // edits to TypeScript files.
    if is_port_in_use(SERVER_PORT) {
        #[cfg(not(debug_assertions))]
        if is_our_server_healthy(SERVER_PORT) {
            let url = format!("http://127.0.0.1:{}", SERVER_PORT);
            *state.server_url.lock().unwrap() = Some(url.clone());
            *state.starting.lock().unwrap() = false;
            log::info!("[tauri] Reusing existing healthy server at {}", url);
            return Ok(());
        }
        kill_existing_on_port(SERVER_PORT);
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
            .env("SERVER_PORT", SERVER_PORT.to_string())
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
            .env("SERVER_PORT", SERVER_PORT.to_string())
            .env("DESKTOP_MODE", "1")
            .env("CLAUDE_RUNTIME_DIR", format!("{}/runtime", resource_dir))
            .env("CLAUDE_APP_ROOT", &resource_dir)
            .env("AUTH_MODE", std::env::var("AUTH_MODE").unwrap_or_else(|_| "central".to_string()))
            .env("LLM_PROXY_BASE_URL", std::env::var("LLM_PROXY_BASE_URL").unwrap_or_else(|_| "https://crew.ambilight.com/woicrew/proxy".to_string()))
            .env("CREWCENTRAL_AUTH_LOGIN_URL", std::env::var("CREWCENTRAL_AUTH_LOGIN_URL").unwrap_or_else(|_| "https://crew.ambilight.com/woicrew/auth/login".to_string()))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
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
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        log::info!("[server] {}", text);
                        if text.contains("running at") {
                            let url = format!("http://127.0.0.1:{}", SERVER_PORT);
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
            // TCP fallback: check if port is already listening, but verify it's
            // our healthy server (not an orphan from a previous run).
            if is_port_in_use(SERVER_PORT) {
                if is_our_server_healthy(SERVER_PORT) {
                    let url = format!("http://127.0.0.1:{}", SERVER_PORT);
                    *state.server_url.lock().unwrap() = Some(url.clone());
                    log::info!("[tauri] Server detected via TCP+health at {}", url);
                    found_signal = true;
                    break;
                }
                // Port is occupied by something that doesn't respond to /health.
                // This is likely a stale process. Kill it and let our sidecar retry.
                log::warn!("[tauri] Port {} occupied but /health failed — killing orphan", SERVER_PORT);
                kill_existing_on_port(SERVER_PORT);
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
    if let Some(mut child) = state.server_process.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.server_url.lock().unwrap() = None;
}

#[tauri::command]
pub async fn restart_adapters(app: AppHandle) -> Result<(), String> {
    let state = app.state::<ServerState>();

    // Kill existing
    if let Some(mut child) = state.adapter_process.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    let resource_dir = get_resource_dir(&app);
    let sidecar_path = get_sidecar_path(&app, "adapter-sidecar");
    let server_url = state.server_url.lock().unwrap().clone()
        .unwrap_or_else(|| format!("http://127.0.0.1:{}", SERVER_PORT));

    // TODO: read adapter config from ~/.claude/adapters.json to build flags
    let child = if cfg!(debug_assertions) {
        let mut cmd = Command::new("bun");
        cmd.args(["run", "sidecars/adapter-sidecar.ts"])
            .env("SERVER_URL", &server_url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut cmd);
        cmd.spawn()
            .map_err(|e| format!("Failed to spawn adapter sidecar: {}", e))?
    } else {
        let mut cmd = Command::new(&sidecar_path);
        cmd.env("SERVER_URL", &server_url)
            .env("CLAUDE_APP_ROOT", &resource_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut cmd);
        cmd.spawn()
            .map_err(|e| format!("Failed to spawn adapter sidecar: {}", e))?
    };

    *state.adapter_process.lock().unwrap() = Some(child);
    Ok(())
}
