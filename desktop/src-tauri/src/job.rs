//! Keeps the RoleSpec server and database from outliving the desktop shell.
//!
//! The shell can be closed normally, but it can also crash (a Rust panic, a
//! forced end-task, a power event). Without a job object the Node server and
//! PostgreSQL keep running: the next launch then finds port 3100 and the
//! cluster in use, and a stale server serves an old build.
//!
//! A Windows job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` owns both
//! processes for the shell's whole lifetime. Closing the last job handle —
//! including when the process dies — terminates everything assigned to it,
//! and children they create (provider CLI subprocesses, PostgreSQL backends)
//! join the same job automatically.
//!
//! On other platforms this is a no-op; Unix process groups are a separate
//! decision that the desktop line does not need yet.

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::io;
    use std::mem::size_of;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// Owns a kill-on-close job object. Keep it alive for the shell's lifetime.
    pub struct ProcessJob {
        handle: HANDLE,
    }

    // SAFETY: `handle` is an owned kernel handle. Windows handles are usable
    // from any thread, and this type never exposes the handle, so sharing it
    // only lets callers assign additional processes to the same job.
    unsafe impl Send for ProcessJob {}
    unsafe impl Sync for ProcessJob {}

    impl ProcessJob {
        pub fn create() -> io::Result<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(io::Error::last_os_error());
                }

                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let configured = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const c_void,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if configured == 0 {
                    let error = io::Error::last_os_error();
                    CloseHandle(handle);
                    return Err(error);
                }

                Ok(Self { handle })
            }
        }

        /// Adds an existing process to the job. Children it creates later join
        /// the job too, so the PostgreSQL postmaster covers its backends.
        pub fn assign(&self, pid: u32) -> io::Result<()> {
            unsafe {
                let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if process.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let assigned = AssignProcessToJobObject(self.handle, process);
                let error = io::Error::last_os_error();
                CloseHandle(process);
                if assigned == 0 {
                    return Err(error);
                }
                Ok(())
            }
        }
    }

    impl Drop for ProcessJob {
        fn drop(&mut self) {
            // This is also the kill switch: closing the last handle terminates
            // every process still assigned to the job.
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::io;

    pub struct ProcessJob;

    impl ProcessJob {
        pub fn create() -> io::Result<Self> {
            Ok(Self)
        }

        pub fn assign(&self, _pid: u32) -> io::Result<()> {
            Ok(())
        }
    }
}

pub use platform::ProcessJob;

#[cfg(all(test, windows))]
mod tests {
    use super::ProcessJob;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn wait_for_exit(child: &mut std::process::Child, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn closing_the_job_terminates_an_assigned_process() {
        let job = ProcessJob::create().expect("create job object");
        let mut child = Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn a long-running test child");

        job.assign(child.id()).expect("assign child to job");

        // Dropping the only handle is what a shell crash does: the process
        // must not be able to keep running.
        drop(job);

        let exited = wait_for_exit(&mut child, Duration::from_secs(10));
        if !exited {
            let _ = child.kill();
            let _ = child.wait();
            panic!("the child survived the job object closing");
        }
    }

    #[test]
    fn assigning_an_unknown_process_is_an_error() {
        let job = ProcessJob::create().expect("create job object");
        assert!(job.assign(u32::MAX).is_err());
    }
}
