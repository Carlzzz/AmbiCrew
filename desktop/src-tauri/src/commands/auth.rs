use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

// ─── Token Storage ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredTokens {
    v: u8,
    access_token: String,
    refresh_token: String,
    display_name: Option<String>,
}

fn token_file_path() -> PathBuf {
    let config_dir = std::env::var("CLAUDE_CONFIG_DIR")
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_default()
                .join(".claude")
                .to_string_lossy()
                .to_string()
        });
    PathBuf::from(config_dir).join("central-auth.json")
}

fn load_tokens() -> Option<StoredTokens> {
    let path = token_file_path();
    let raw = fs::read_to_string(&path).ok()?;
    let parsed: StoredTokens = serde_json::from_str(&raw).ok()?;
    if parsed.v == 1 && !parsed.access_token.is_empty() {
        Some(parsed)
    } else {
        None
    }
}

fn save_tokens(tokens: &StoredTokens) -> Result<(), String> {
    let path = token_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(tokens).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&path, json).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn clear_tokens() {
    let path = token_file_path();
    let _ = fs::remove_file(path);
}

// ─── Auth State ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct AuthStatus {
    pub logged_in: bool,
    pub display_name: Option<String>,
}

pub struct AuthState {
    status: Mutex<AuthStatus>,
}

impl Default for AuthState {
    fn default() -> Self {
        Self {
            status: Mutex::new(AuthStatus {
                logged_in: false,
                display_name: None,
            }),
        }
    }
}

fn derive_api_base() -> String {
    if let Ok(base) = std::env::var("AUTH_SERVER_BASE_URL") {
        return base.trim_end_matches('/').to_string();
    }
    let login_url = std::env::var("CREWCENTRAL_AUTH_LOGIN_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:1420/woicrew/auth/login".to_string());
    if let Ok(url) = url::Url::parse(&login_url) {
        let path = url.path();
        if let Some(idx) = path.find("/auth/") {
            return format!("{}{}",url.origin().ascii_serialization(), &path[..idx]);
        }
        return url.origin().ascii_serialization();
    }
    "http://127.0.0.1:1420/woicrew".to_string()
}

// ─── Deep Link Handling ──────────────────────────────────────────────────────

/// Handle deep link from second-instance argv or protocol handler.
/// URL format: testcrew://auth?access_token=...&refresh_token=...&display_name=...
pub fn handle_deep_link_argv(app: &AppHandle, args: &[String]) {
    for arg in args {
        if arg.starts_with("testcrew://") {
            log::info!("[auth] Deep link received: {}...", &arg[..arg.len().min(50)]);
            if let Ok(url) = url::Url::parse(arg) {
                let access_token = url.query_pairs()
                    .find(|(k, _)| k == "access_token")
                    .map(|(_, v)| v.to_string());
                let refresh_token = url.query_pairs()
                    .find(|(k, _)| k == "refresh_token")
                    .map(|(_, v)| v.to_string());
                let display_name = url.query_pairs()
                    .find(|(k, _)| k == "display_name")
                    .map(|(_, v)| v.to_string());

                if let (Some(at), Some(rt)) = (access_token, refresh_token) {
                    let tokens = StoredTokens {
                        v: 1,
                        access_token: at,
                        refresh_token: rt,
                        display_name: display_name.clone(),
                    };
                    if save_tokens(&tokens).is_ok() {
                        let state = app.state::<AuthState>();
                        let mut status = state.status.lock().unwrap();
                        status.logged_in = true;
                        status.display_name = display_name;
                        let _ = app.emit("auth:statusChanged", status.clone());
                        log::info!("[auth] Login completed via deep link");
                    }
                }
            }
        }
    }
}

// ─── Initialization ──────────────────────────────────────────────────────────

/// Restore auth session on startup by validating stored token.
pub async fn initialize(app: &AppHandle) {
    let tokens = match load_tokens() {
        Some(t) => t,
        None => {
            log::info!("[auth] No stored tokens found");
            return;
        }
    };

    let base = derive_api_base();
    let url = format!("{}/api/v1/users/me", base);

    let client = reqwest::Client::new();
    match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", tokens.access_token))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let display_name = tokens.display_name.clone();
            let state = app.state::<AuthState>();
            let mut status = state.status.lock().unwrap();
            status.logged_in = true;
            status.display_name = display_name;
            let _ = app.emit("auth:statusChanged", status.clone());
            log::info!("[auth] Session restored successfully");
        }
        _ => {
            log::info!("[auth] Stored token invalid, user needs to re-login");
        }
    }
}

// ─── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_auth_status(state: tauri::State<'_, AuthState>) -> AuthStatus {
    state.status.lock().unwrap().clone()
}

#[tauri::command]
pub async fn login(app: AppHandle) -> Result<(), String> {
    let scheme = std::env::var("AUTH_CALLBACK_SCHEME").unwrap_or_else(|_| "testcrew".to_string());
    let login_url = std::env::var("CREWCENTRAL_AUTH_LOGIN_URL")
        .unwrap_or_else(|_| {
            let base = derive_api_base();
            format!("{}/auth/login?client_label=AmbiCrew&device_label={}", base, std::env::consts::OS)
        });

    let mut url = url::Url::parse(&login_url).map_err(|e| e.to_string())?;
    if url.query_pairs().find(|(k, _)| k == "redirect_scheme").is_none() {
        url.query_pairs_mut().append_pair("redirect_scheme", &scheme);
    }

    // Open browser for login
    let shell = app.shell();
    shell.open(url.as_str(), None).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn logout(app: AppHandle) -> Result<(), String> {
    clear_tokens();
    let state = app.state::<AuthState>();
    let mut status = state.status.lock().unwrap();
    status.logged_in = false;
    status.display_name = None;
    let _ = app.emit("auth:statusChanged", status.clone());
    Ok(())
}

#[tauri::command]
pub async fn start_heartbeat() -> Result<(), String> {
    // Heartbeat is handled by the bun server sidecar (deviceManager in conversationService).
    // The Tauri layer doesn't need its own heartbeat — the server process manages it.
    Ok(())
}

#[tauri::command]
pub async fn stop_heartbeat() -> Result<(), String> {
    Ok(())
}
