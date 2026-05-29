use serde::Serialize;

#[derive(Serialize)]
pub struct MacPermissions {
    pub accessibility: bool,
    pub screen_recording: bool,
}

#[tauri::command]
pub fn check_mac_permissions() -> MacPermissions {
    #[cfg(target_os = "macos")]
    {
        let accessibility = check_accessibility();
        let screen_recording = check_screen_recording();
        MacPermissions {
            accessibility,
            screen_recording,
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        MacPermissions {
            accessibility: true,
            screen_recording: true,
        }
    }
}

#[cfg(target_os = "macos")]
fn check_accessibility() -> bool {
    // AXIsProcessTrusted() — checks if THIS process (the Tauri app bundle) is trusted.
    // Unlike the Electron approach where Python subprocess couldn't detect permissions,
    // Tauri's main process IS the app bundle executable, so this is accurate.
    unsafe {
        type AXIsProcessTrustedFn = unsafe extern "C" fn() -> bool;
        let lib = libloading::Library::new(
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
        );
        match lib {
            Ok(lib) => {
                let func: Result<libloading::Symbol<AXIsProcessTrustedFn>, _> =
                    lib.get(b"AXIsProcessTrusted");
                match func {
                    Ok(f) => f(),
                    Err(_) => false,
                }
            }
            Err(_) => false,
        }
    }
}

#[cfg(target_os = "macos")]
fn check_screen_recording() -> bool {
    // CGPreflightScreenCaptureAccess() — available since macOS 10.15
    unsafe {
        type CGPreflightFn = unsafe extern "C" fn() -> bool;
        let lib = libloading::Library::new(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
        );
        match lib {
            Ok(lib) => {
                let func: Result<libloading::Symbol<CGPreflightFn>, _> =
                    lib.get(b"CGPreflightScreenCaptureAccess");
                match func {
                    Ok(f) => f(),
                    Err(_) => false,
                }
            }
            Err(_) => false,
        }
    }
}
