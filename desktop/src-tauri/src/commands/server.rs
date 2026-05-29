use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const SERVER_PORT: u16 = 43124;

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
    app.path()
        .resource_dir()
        .map(|dir| {
            let ext = if cfg!(windows) { ".exe" } else { "" };
            dir.join(format!("{}{}", name, ext))
                .to_string_lossy()
                .to_string()
        })
        .unwrap_or_else(|_| name.to_string())
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

    let resource_dir = get_resource_dir(app);
    let sidecar_path = get_sidecar_path(app, "claude-sidecar");

    let spawn_result = if cfg!(debug_assertions) {
        // Dev mode: CARGO_MANIFEST_DIR is always desktop/src-tauri at compile time
        let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors().nth(2).unwrap().to_path_buf();
        Command::new("bun")
            .args(["run", "src/server/index.ts"])
            .current_dir(&repo_root)
            .env("SERVER_PORT", SERVER_PORT.to_string())
            .env("DESKTOP_MODE", "1")
            .env("CLAUDE_RUNTIME_DIR", repo_root.join("runtime").to_string_lossy().to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn bun server: {}", e))
    } else {
        // Packaged mode: use compiled sidecar
        Command::new(&sidecar_path)
            .args(["server", "--app-root", &resource_dir])
            .env("SERVER_PORT", SERVER_PORT.to_string())
            .env("DESKTOP_MODE", "1")
            .env("CLAUDE_RUNTIME_DIR", format!("{}/runtime", resource_dir))
            .env("CLAUDE_APP_ROOT", &resource_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
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
            // TCP fallback: check if port is already listening
            if std::net::TcpStream::connect_timeout(
                &format!("127.0.0.1:{}", SERVER_PORT).parse().unwrap(),
                Duration::from_millis(100),
            ).is_ok() {
                let url = format!("http://127.0.0.1:{}", SERVER_PORT);
                *state.server_url.lock().unwrap() = Some(url.clone());
                log::info!("[tauri] Server detected via TCP at {}", url);
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
        Command::new("bun")
            .args(["run", "sidecars/adapter-sidecar.ts"])
            .env("SERVER_URL", &server_url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn adapter sidecar: {}", e))?
    } else {
        Command::new(&sidecar_path)
            .env("SERVER_URL", &server_url)
            .env("CLAUDE_APP_ROOT", &resource_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn adapter sidecar: {}", e))?
    };

    *state.adapter_process.lock().unwrap() = Some(child);
    Ok(())
}
