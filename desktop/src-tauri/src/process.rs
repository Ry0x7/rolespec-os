//! Child-process creation shared by the shell.
//!
//! The shell is built as a `windows`-subsystem binary, so it owns no console.
//! Windows allocates a fresh console window for every console-subsystem child
//! started without an explicit flag, which is why `initdb`, `pg_ctl`, `psql`,
//! `taskkill` and the Node server each flashed a black window during startup
//! and shutdown. `CREATE_NO_WINDOW` makes the child inherit "no console"
//! instead; output still works because every child writes to a log or a pipe.

use std::ffi::OsStr;
use std::process::Command;

/// `CREATE_NO_WINDOW` from the `CreateProcess` flag set.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `Command::new` with no console window on Windows.
pub fn quiet(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::quiet;
    use std::process::Stdio;

    /// The child runs, produces output and exits without a console. This is a
    /// behavioural check, not an inspection of the flag: a hidden process
    /// cannot allocate a console, and on a machine without one the same spawn
    /// would still work.
    #[test]
    fn quiet_spawns_a_working_child() {
        #[cfg(windows)]
        let mut command = {
            let mut command = quiet("cmd");
            command.args(["/C", "echo quiet-ok"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = quiet("sh");
            command.args(["-c", "echo quiet-ok"]);
            command
        };

        let output = command
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .expect("spawn a child");
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "quiet-ok");
    }
}
