use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// Append-only logger shared by the shell and the server child process.
///
/// The Node server's stdout/stderr are redirected to the same file, so support
/// gets one timeline for "shell started", "server spawned", "server failed".
/// Rotation keeps one previous file (`desktop.log.1`); it is intentionally
/// simple because the log is a debugging aid, not durable storage.
pub struct Logger {
    path: PathBuf,
    file: Mutex<File>,
}

impl Logger {
    pub fn open(path: PathBuf) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        rotate_if_needed(&path)?;
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            path,
            file: Mutex::new(file),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn info(&self, message: &str) {
        self.write("INFO", message);
    }

    pub fn warn(&self, message: &str) {
        self.write("WARN", message);
    }

    pub fn error(&self, message: &str) {
        self.write("ERROR", message);
    }

    fn write(&self, level: &str, message: &str) {
        let stamp = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown-time".to_string());
        let line = format!("{stamp} {level:<5} {message}\n");
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
}

fn rotate_if_needed(path: &Path) -> io::Result<()> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() < MAX_LOG_BYTES {
        return Ok(());
    }

    let rotated = path.with_extension("log.1");
    let _ = fs::remove_file(&rotated);
    fs::rename(path, rotated)
}
