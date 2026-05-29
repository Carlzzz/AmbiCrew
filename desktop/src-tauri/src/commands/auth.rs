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

/// Try to refresh the access token using the stored refresh token.
/// Returns updated StoredTokens on success.
async fn try_refresh_token(base: &str, refresh_token: &str, existing_display_name: Option<&str>) -> Option<StoredTokens> {
    let url = format!("{}/api/v1/auth/refresh", base);
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let body: serde_json::Value = resp.json().await.ok()?;
    if body.get("rc").and_then(|v| v.as_i64()) != Some(0) {
        return None;
    }

    let data = body.get("data")?;
    let new_access = data.get("access_token")?.as_str()?.to_string();
    let new_refresh = data
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or(refresh_token)
        .to_string();
    let display_name = data.get("display_name").and_then(|v| v.as_str())
        .or_else(|| data.get("displayName").and_then(|v| v.as_str()))
        .or_else(|| data.get("email").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .or_else(|| existing_display_name.map(|s| s.to_string()));

    Some(StoredTokens {
        v: 1,
        access_token: new_access,
        refresh_token: new_refresh,
        display_name,
    })
}

/// Restore auth session on startup by validating stored token.
/// If the access token is expired, attempts a refresh before giving up.
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
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", tokens.access_token))
        .send()
        .await;

    let valid = match &resp {
        Ok(r) if r.status().is_success() => true,
        _ => false,
    };

    if valid {
        let api_display_name = match resp {
            Ok(r) => r.json::<serde_json::Value>().await.ok()
                .and_then(|body| {
                    let d = body.get("data")?;
                    d.get("display_name").and_then(|v| v.as_str())
                        .or_else(|| d.get("displayName").and_then(|v| v.as_str()))
                        .or_else(|| d.get("email").and_then(|v| v.as_str()))
                        .map(|s| s.to_string())
                }),
            _ => None,
        };
        let display_name = api_display_name.or(tokens.display_name.clone());

        if display_name != tokens.display_name {
            let updated = StoredTokens { display_name: display_name.clone(), ..tokens.clone() };
            let _ = save_tokens(&updated);
        }

        let state = app.state::<AuthState>();
        let mut status = state.status.lock().unwrap();
        status.logged_in = true;
        status.display_name = display_name;
        let _ = app.emit("auth:statusChanged", status.clone());
        log::info!("[auth] Session restored successfully");
        return;
    }

    // Access token invalid or network error — attempt refresh
    log::info!("[auth] Access token invalid, attempting refresh...");
    match try_refresh_token(&base, &tokens.refresh_token, tokens.display_name.as_deref()).await {
        Some(new_tokens) => {
            let display_name = new_tokens.display_name.clone();
            if let Err(e) = save_tokens(&new_tokens) {
                log::error!("[auth] Failed to save refreshed tokens: {}", e);
                return;
            }
            let state = app.state::<AuthState>();
            let mut status = state.status.lock().unwrap();
            status.logged_in = true;
            status.display_name = display_name;
            let _ = app.emit("auth:statusChanged", status.clone());
            log::info!("[auth] Session restored via token refresh");
        }
        None => {
            log::info!("[auth] Token refresh failed, user needs to re-login");
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
