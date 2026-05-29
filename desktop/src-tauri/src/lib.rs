mod commands;

use tauri::Manager;

pub fn run() {
    // Load .env from repo root in dev mode (CARGO_MANIFEST_DIR = desktop/src-tauri)
    if cfg!(debug_assertions) {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        if let Some(repo_root) = manifest_dir.ancestors().nth(2) {
            let _ = dotenvy::from_path(repo_root.join(".env"));
        }
    }

    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Focus existing window on second instance
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            // Handle deep link from second instance argv
            commands::auth::handle_deep_link_argv(app, &args);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(commands::terminal::PtyState::default())
        .manage(commands::server::ServerState::default())
        .manage(commands::auth::AuthState::default())
        .invoke_handler(tauri::generate_handler![
            // Server / sidecar management
            commands::server::start_server,
            commands::server::stop_server,
            commands::server::get_server_url,
            commands::server::restart_adapters,
            // Terminal PTY
            commands::terminal::spawn_pty,
            commands::terminal::write_pty,
            commands::terminal::resize_pty,
            commands::terminal::kill_pty,
            // Auth
            commands::auth::get_auth_status,
            commands::auth::login,
            commands::auth::logout,
            commands::auth::start_heartbeat,
            commands::auth::stop_heartbeat,
            // Permissions (macOS)
            commands::permissions::check_mac_permissions,
        ])
        .setup(|app| {
            log::info!("[tauri] AmbiCrew starting...");

            // Register deep link protocol in dev mode (NSIS installer handles this in production)
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    log::warn!("[tauri] Failed to register deep link schemes: {}", e);
                }
            }

            // Listen for deep link open events (macOS always, Windows first-launch)
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                    // Focus existing window when deep link arrives
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    commands::auth::handle_deep_link_argv(&app_handle, &urls);
                });
            }

            // Start the bun server sidecar (on a blocking thread to avoid starving Tokio)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = tauri::async_runtime::spawn_blocking(move || {
                    commands::server::auto_start_sync(&app_handle)
                }).await;
                match result {
                    Ok(Err(e)) => log::error!("[tauri] Server auto-start failed: {}", e),
                    Err(e) => log::error!("[tauri] Server auto-start task panicked: {}", e),
                    _ => {}
                }
            });

            // Initialize auth (restore session)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                commands::auth::initialize(&app_handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AmbiCrew");
}
