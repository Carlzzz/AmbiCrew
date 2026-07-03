use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter};
use sha2::{Sha256, Digest};

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Hide the console window when spawning a process on Windows.
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

/// Emit progress updates to the frontend as the download proceeds.
fn emit_progress(app: &AppHandle, percent: u32, downloaded_bytes: u64, total_bytes: u64) {
    let _ = app.emit("update-download-progress", serde_json::json!({
        "percent": percent,
        "downloaded_bytes": downloaded_bytes,
        "total_bytes": total_bytes,
    }));
}

/// Download an installer from the given URL, verify its SHA256 hash, and save
/// it to a temp file. Returns the path to the downloaded file. Emits
/// `update-download-progress` events so the frontend can show a progress bar.
#[tauri::command]
pub fn download_update(
    app: AppHandle,
    url: String,
    expected_sha256: String,
) -> Result<serde_json::Value, String> {
    let expected = expected_sha256.to_lowercase();

    // Start the request — use blocking client so we can stream the body
    let resp = reqwest::blocking::get(&url)
        .map_err(|e| format!("Failed to connect to download server: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download server returned HTTP {}", resp.status()));
    }

    let total_bytes = resp
        .content_length()
        .unwrap_or(0);

    // Determine temp file path
    let content_disposition = resp
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let filename = extract_filename(content_disposition)
        .unwrap_or_else(|| {
            // Fall back to extracting from URL path
            url.split('/').next_back().unwrap_or("AmbiCrew-Update.exe").to_string()
        });
    let filename = sanitize_filename(&filename);
    let temp_path = std::env::temp_dir().join(&filename);

    // Open the temp file for writing
    let mut file = File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file {}: {}", temp_path.display(), e))?;

    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut reader = resp;

    // 64 KiB buffer — heap-allocated. A large stack array in a synchronous
    // Tauri command would eat into the main thread's limited stack.
    let mut buf = vec![0u8; 64 * 1024];

    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Download read error: {}", e))?;
        if n == 0 {
            break;
        }

        hasher.update(&buf[..n]);
        file
            .write_all(&buf[..n])
            .map_err(|e| format!("Write error: {}", e))?;

        downloaded += n as u64;

        if total_bytes > 0 {
            let pct = ((downloaded * 100) / total_bytes) as u32;
            // Emit every 5% to avoid flooding the event channel
            if pct % 5 == 0 {
                emit_progress(&app, pct, downloaded, total_bytes);
            }
        }
    }

    // Final progress
    if total_bytes > 0 {
        emit_progress(&app, 100, downloaded, total_bytes);
    }

    // Flush OS buffers
    file.flush().map_err(|e| format!("Flush error: {}", e))?;
    drop(file);

    // Verify SHA256
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        // Clean up the bad file
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "SHA256 mismatch.\nExpected: {}\nGot:      {}",
            expected, actual
        ));
    }

    log::info!(
        "[update] Downloaded {} ({:.1} MB), SHA256 verified",
        temp_path.display(),
        downloaded as f64 / (1024.0 * 1024.0),
    );

    Ok(serde_json::json!({
        "temp_path": temp_path.to_string_lossy(),
        "file_size_bytes": downloaded,
    }))
}

/// Launch the downloaded NSIS installer with /UPDATE (preserve user data) and
/// /P (passive — auto-close). Then exit the current process so the installer can
/// replace the running binary.
#[tauri::command]
pub fn install_update(installer_path: String) -> Result<(), String> {
    let path = PathBuf::from(&installer_path);
    if !path.exists() {
        return Err(format!("Installer not found: {}", installer_path));
    }

    log::info!("[update] Launching installer: {} /UPDATE /P", installer_path);

    let mut cmd = Command::new(&installer_path);
    cmd.args(["/UPDATE", "/P"]);
    hide_console(&mut cmd);

    // Detach the child so it outlives us
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch installer: {}", e))?;

    log::info!(
        "[update] Installer launched (pid {}), exiting current process",
        child.id()
    );

    // Give the OS a moment to start the process, then exit
    std::thread::sleep(std::time::Duration::from_millis(500));
    std::process::exit(0);
}

/// Return the CrewCentral API base URL (e.g. https://crew.ambilight.com/woicrew).
/// Reads AUTH_SERVER_BASE_URL from the environment; falls back to the production
/// default. This is the same derivation logic used by the server sidecar.
fn api_base_url() -> String {
    std::env::var("AUTH_SERVER_BASE_URL")
        .unwrap_or_else(|_| "https://crew.ambilight.com/woicrew".to_string())
        .trim_end_matches('/')
        .to_string()
}

/// Check for updates by querying the CrewCentral releases endpoint.
///
/// This runs from Rust (not the webview) to bypass browser CORS restrictions —
/// the dev webview origin (http://127.0.0.1:1420) is not in CrewCentral's
/// CORS allowlist, so a frontend `fetch()` fails with "Failed to fetch". The
/// Bun sidecar already fetches CrewCentral freely because Node isn't bound by
/// CORS; this command gives the frontend the same capability.
///
/// Returns the parsed JSON body (the `{ rc, message, data }` envelope) as a
/// serde_json::Value so the frontend can read it directly.
#[tauri::command]
pub fn check_for_updates(current_version: String) -> Result<serde_json::Value, String> {
    let base = api_base_url();
    let url = format!(
        "{}/api/v1/releases/latest?current_version={}",
        base,
        url::form_urlencoded::byte_serialize(current_version.as_bytes())
            .collect::<String>()
    );

    log::info!("[update] Checking for updates at {}", url);

    let resp = reqwest::blocking::get(&url)
        .map_err(|e| format!("Failed to reach update server: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Update server returned HTTP {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .map_err(|e| format!("Failed to parse update response: {}", e))?;

    Ok(json)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Extract a filename from a Content-Disposition header value.
///
/// Handles both `attachment; filename="name"` and
/// `attachment; filename*=UTF-8''name`.
fn extract_filename(header: &str) -> Option<String> {
    // Prefer filename*= (RFC 5987)
    for part in header.split(';') {
        let trimmed = part.trim();
        if let Some(rest) = trimmed.strip_prefix("filename*=") {
            // e.g. UTF-8''name%20here
            let val = rest.trim_matches('"');
            if let Some(idx) = val.find("''") {
                let encoded = &val[idx + 2..];
                if let Ok(decoded) = urlencoding(encoded) {
                    return Some(decoded);
                }
            }
            return Some(val.to_string());
        }
    }
    // Fall back to plain filename=
    for part in header.split(';') {
        let trimmed = part.trim();
        if let Some(rest) = trimmed.strip_prefix("filename=") {
            return Some(rest.trim_matches('"').to_string());
        }
    }
    None
}

/// Minimal percent-decoding for Content-Disposition filename*= values.
fn urlencoding(raw: &str) -> Result<String, ()> {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let h = chars.next().ok_or(())?;
            let l = chars.next().ok_or(())?;
            let byte = u8::from_str_radix(&format!("{h}{l}"), 16).map_err(|_| ())?;
            out.push(byte as char);
        } else if c == '+' {
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    Ok(out)
}

/// Prevent path traversal and remove dangerous characters from filenames.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .replace('\\', "_")
        .replace('/', "_")
        .replace("..", "_")
        .chars()
        .filter(|c| {
            c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_' || *c == ' '
        })
        .take(200)
        .collect();
    if cleaned.is_empty() { "AmbiCrew-Update.exe".into() } else { cleaned.trim().to_string() }
}
