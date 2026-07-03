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

    // env_logger defaults to OFF / error — too strict for dev where we want to
    // see [tauri] / [adapter] / [server stderr] info-level lines. Use RUST_LOG
    // if set, otherwise default to "info" so normal subprocess output surfaces
    // without misleadingly being tagged ERROR.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();

    tauri::Builder::default()
        // single-instance MUST be first plugin (per Tauri docs)
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Focus existing window when second instance is detected
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            // Handle deep link from second instance argv (Windows/Linux)
            commands::auth::handle_deep_link_argv(app, &args);
        }))
        .plugin(tauri_plugin_deep_link::init())
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
            // Updates
            commands::update::check_for_updates,
            commands::update::download_update,
            commands::update::install_update,
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
            // Also check get_current() for URLs that arrived before this listener
            // was registered (cold-start via deep link on macOS).
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                // Check buffered URLs first (cold-start scenario)
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let url_strings: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
                    if !url_strings.is_empty() {
                        log::info!("[tauri] Processing buffered deep link from cold start");
                        let app_handle = app.handle().clone();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        commands::auth::handle_deep_link_argv(&app_handle, &url_strings);
                    }
                }

                // Register listener for URLs arriving after setup (warm-start)
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
                let server_app = app_handle.clone();
                let result = tauri::async_runtime::spawn_blocking(move || {
                    commands::server::auto_start_sync(&server_app)
                }).await;
                match result {
                    Ok(Err(e)) => {
                        log::error!("[tauri] Server auto-start failed: {}", e);
                        return;
                    }
                    Err(e) => {
                        log::error!("[tauri] Server auto-start task panicked: {}", e);
                        return;
                    }
                    _ => {}
                }

                // Server is up — auto-start any configured adapters so users
                // don't have to manually trigger a config save to get them running.
                // Without this, IM bots are silently dead until the user happens
                // to open Settings and re-save something.
                if let Err(e) = commands::server::restart_adapters(app_handle).await {
                    log::error!("[tauri] Adapter auto-start failed: {}", e);
                }
            });

            // Initialize auth (restore session)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                commands::auth::initialize(&app_handle).await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<commands::server::ServerState>();
                let adapter = state.adapter_process.lock().unwrap().take();
                let server = state.server_process.lock().unwrap().take();
                if let Some(mut child) = adapter {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                if let Some(mut child) = server {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running AmbiCrew");
}
