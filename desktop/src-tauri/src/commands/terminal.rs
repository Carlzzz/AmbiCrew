use std::collections::HashMap;
use std::io::{Read, Write as IoWrite};
use std::sync::Mutex;
use std::thread;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static NEXT_SESSION_ID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

struct PtySession {
    writer: Box<dyn IoWrite + Send>,
    master: Box<dyn MasterPty + Send>,
}

pub struct PtyState {
    sessions: Mutex<HashMap<u32, PtySession>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
struct PtyOutputEvent {
    session_id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExitEvent {
    session_id: u32,
    code: Option<u32>,
}

#[derive(Serialize)]
pub struct SpawnResult {
    session_id: u32,
    shell: String,
    cwd: String,
}

fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

#[tauri::command]
pub fn spawn_pty(
    app: AppHandle,
    state: tauri::State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<SpawnResult, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell_path = shell.unwrap_or_else(default_shell);
    let working_dir = cwd.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.cwd(&working_dir);

    if let Some(home) = dirs::home_dir() {
        let local_bin = home.join(".local").join("bin");
        if let Ok(current_path) = std::env::var("PATH") {
            let sep = if cfg!(windows) { ";" } else { ":" };
            cmd.env("PATH", format!("{}{}{}", local_bin.display(), sep, current_path));
        }
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let session_id = NEXT_SESSION_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    let app_clone = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit("terminal:output", PtyOutputEvent {
                        session_id,
                        data,
                    });
                }
                Err(_) => break,
            }
        }

        let code = child.wait().ok().map(|s| s.exit_code());
        let _ = app_clone.emit("terminal:exit", PtyExitEvent { session_id, code });
    });

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    state.sessions.lock().unwrap().insert(session_id, PtySession {
        writer,
        master: pair.master,
    });

    Ok(SpawnResult {
        session_id,
        shell: shell_path,
        cwd: working_dir,
    })
}

#[tauri::command]
pub fn write_pty(
    state: tauri::State<'_, PtyState>,
    session_id: u32,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("PTY session {} not found", session_id))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    state: tauri::State<'_, PtyState>,
    session_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("PTY session {} not found", session_id))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn kill_pty(
    state: tauri::State<'_, PtyState>,
    session_id: u32,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if sessions.remove(&session_id).is_some() {
        Ok(())
    } else {
        Err(format!("PTY session {} not found", session_id))
    }
}
