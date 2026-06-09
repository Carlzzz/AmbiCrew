//! Windows JobObject wrapper used to guarantee sidecar children die with the
//! main app process.
//!
//! Without this, the sequence is:
//!   1. User force-kills AmbiCrew via Task Manager (or the app deadlocks and
//!      they kill it from PowerShell).
//!   2. The `WindowEvent::Destroyed` cleanup in lib.rs never runs, so
//!      `child.kill()` is never called on `claude-sidecar.exe` /
//!      `adapter-sidecar.exe`.
//!   3. Those processes orphan, keep listening on port 43124, and the next
//!      launch sees the port occupied → "Server failed to start within 20s".
//!   4. Users who don't know the orphan process name can't easily kill it, so
//!      they reboot.
//!
//! With a JobObject + KILL_ON_JOB_CLOSE, the kernel terminates every assigned
//! child the moment the last handle to the job closes — which happens
//! automatically when the main process dies, by any means. No cooperation
//! from the main process required.
//!
//! On non-Windows platforms this module compiles to a no-op stub so call sites
//! don't need `#[cfg(windows)]` everywhere.

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// Owns a Windows JobObject handle. When dropped, the kernel kills every
    /// process that was assigned to the job (because we set KILL_ON_JOB_CLOSE).
    pub struct JobHandle {
        handle: HANDLE,
    }

    // Windows HANDLE wraps a raw pointer, which auto-derives !Send + !Sync.
    // But kernel handles are process-global references — they are explicitly
    // safe to use from any thread (the kernel does its own synchronization).
    // We need this because ServerState lives inside Tauri's State<T>, which
    // requires Send + Sync.
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    impl JobHandle {
        /// Create an unnamed JobObject configured to kill all assigned children
        /// when the last handle to the job is closed.
        pub fn new() -> Result<Self, String> {
            // SAFETY: CreateJobObjectW with null name + null security attributes
            // is a documented, parameter-free call. The returned handle is owned
            // and freed in Drop.
            let handle = unsafe { CreateJobObjectW(None, None) }
                .map_err(|e| format!("CreateJobObjectW failed: {}", e))?;

            // Configure KILL_ON_JOB_CLOSE. Without this the job is created but
            // closing its handle does nothing — children would still orphan.
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            // SAFETY: `info` is a stack-allocated struct of the correct type for
            // the requested information class. Size is taken from the struct
            // itself so it can't drift.
            let result = unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if let Err(e) = result {
                // Best effort: close the handle we just created so we don't leak
                // it before propagating the error.
                let _ = unsafe { CloseHandle(handle) };
                return Err(format!("SetInformationJobObject failed: {}", e));
            }

            Ok(Self { handle })
        }

        /// Assign a process (by PID) to this job. From this point on, the
        /// process will be terminated when the job handle is closed.
        ///
        /// The process must not already belong to another job that disallows
        /// breakaway. Freshly-spawned child processes from std::process::Command
        /// are not in any job, so this works for our sidecars.
        pub fn assign(&self, pid: u32) -> Result<(), String> {
            // PROCESS_SET_QUOTA + PROCESS_TERMINATE are the minimum rights
            // required by AssignProcessToJobObject.
            // SAFETY: OpenProcess with these rights against our own child PID is
            // well-defined. The returned handle is closed before this function
            // returns.
            let process = unsafe {
                OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
            }
            .map_err(|e| format!("OpenProcess({}) failed: {}", pid, e))?;

            // SAFETY: both handles are valid and owned for the duration of this
            // call.
            let result = unsafe { AssignProcessToJobObject(self.handle, process) };

            // Always close the process handle we opened — the job retains its
            // own reference to the process internally.
            let _ = unsafe { CloseHandle(process) };

            result.map_err(|e| format!("AssignProcessToJobObject({}) failed: {}", pid, e))
        }
    }

    impl Drop for JobHandle {
        fn drop(&mut self) {
            // Closing the last handle to a job with KILL_ON_JOB_CLOSE set
            // terminates every assigned process immediately. This is the whole
            // point of the wrapper.
            // SAFETY: handle was created in new() and not closed elsewhere.
            let _ = unsafe { CloseHandle(self.handle) };
        }
    }
}

#[cfg(not(windows))]
mod imp {
    /// No-op stub for platforms that don't need (or have) JobObjects.
    /// Unix relies on the existing graceful_kill / WindowEvent::Destroyed path,
    /// which works because Unix process trees don't have the same orphaning
    /// problem when the parent is force-killed (children get reparented to
    /// init/launchd, which is fine for our short-lived sidecars).
    pub struct JobHandle;

    impl JobHandle {
        pub fn new() -> Result<Self, String> {
            Ok(Self)
        }
        pub fn assign(&self, _pid: u32) -> Result<(), String> {
            Ok(())
        }
    }
}

pub use imp::JobHandle;
