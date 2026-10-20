use std::env;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::time::{Duration, Instant};

use crate::job::ProcessJob;
use crate::logging::Logger;
use crate::process::quiet;

const POLL_INTERVAL: Duration = Duration::from_millis(400);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(500);
const READ_TIMEOUT: Duration = Duration::from_secs(2);

/// Where the shell finds the server bundle and the Node runtime.
#[derive(Debug)]
pub struct DesktopPaths {
    pub app_dir: PathBuf,
    pub node: PathBuf,
    pub data_dir: PathBuf,
}

/// Per-user data root. Kept outside the install directory so uninstall and
/// updates cannot delete the database, exports or managed secrets.
///
/// The name must not be `RoleSpec`: Tauri's per-user NSIS installs the app to
/// `%LOCALAPPDATA%\RoleSpec`, so the same path would put user data inside the
/// install directory and let uninstall remove it.
pub fn app_data_root() -> PathBuf {
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local).join("RoleSpecData");
    }
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("RoleSpecData");
    }
    env::temp_dir().join("RoleSpecData")
}

pub fn node_binary_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

/// Windows resource paths arrive as verbatim paths (`\\?\C:\...`). Node
/// accepts them, but `initdb`/`pg_ctl` invoke `postgres -V` and fail on the
/// prefix (observed: "program postgres is needed by initdb but was not found"
/// with `//?/C:/...`). Normalize every path handed to a child process.
pub fn native_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let simplified = dunce::simplified(&path).to_path_buf();
        // `dunce` leaves verbatim UNC paths alone because it cannot prove the
        // legacy form is equivalent. For our own process paths it is: strip
        // `\\?\UNC\` down to `\\server\share`.
        if let Some(text) = simplified.to_str() {
            if text.len() >= 8 && text[..8].eq_ignore_ascii_case(r"\\?\UNC\") {
                return PathBuf::from(format!(r"\\{}", &text[8..]));
            }
        }
        simplified
    }
    #[cfg(not(windows))]
    {
        path
    }
}

/// Root that contains the staged runtime inside a package.
///
/// `bundle.resources` keeps the configured prefix, so an NSIS install has
/// `<install>\resources\app`, `<install>\resources\node`, … while
/// `resource_dir()` returns `<install>`. Falling back to the directory itself
/// keeps a flattened/custom layout working.
pub fn bundled_root(resource_dir: &Path) -> PathBuf {
    let nested = resource_dir.join("resources");
    if nested.is_dir() {
        nested
    } else {
        resource_dir.to_path_buf()
    }
}

/// Resolves the server bundle and Node binary.
///
/// Development uses the repository's standalone build and a staged Node binary
/// when present, otherwise Node on PATH. Packaged builds only use resources next
/// to the executable: no user-installed Node, no working-directory guess.
pub fn resolve_paths(resource_dir: Option<&Path>, is_dev: bool) -> Result<DesktopPaths, String> {
    let data_root = app_data_root();

    let app_dir = if let Some(override_dir) = env::var_os("ROLESPEC_APP_DIR") {
        PathBuf::from(override_dir)
    } else if is_dev {
        // Use the staged artifact in development too. Running the raw
        // standalone tree tested a different layout from the installer and
        // missed the static assets that `desktop:stage` assembles.
        repo_root()
            .join("desktop")
            .join("src-tauri")
            .join("resources")
            .join("app")
    } else {
        let root = resource_dir.ok_or("Could not locate the RoleSpec application resources.")?;
        bundled_root(root).join("app")
    };

    let node = if let Some(override_node) = env::var_os("ROLESPEC_NODE") {
        PathBuf::from(override_node)
    } else if is_dev {
        let staged = repo_root()
            .join("desktop")
            .join("src-tauri")
            .join("resources")
            .join("node")
            .join(node_binary_name());
        if staged.exists() {
            staged
        } else {
            PathBuf::from(node_binary_name())
        }
    } else {
        let root = resource_dir.ok_or("Could not locate the RoleSpec runtime resources.")?;
        bundled_root(root).join("node").join(node_binary_name())
    };

    let server = app_dir.join("server.js");
    if !server.exists() {
        return Err(format!(
            "The RoleSpec server bundle was not found at {}.\n\nRun `npm run desktop:stage` from the repository root, then try again.",
            server.display()
        ));
    }

    if node.is_absolute() && !node.exists() {
        return Err(format!(
            "The bundled Node runtime was not found at {}.\n\nRun `npm run desktop:stage` from the repository root, then try again.",
            node.display()
        ));
    }

    Ok(DesktopPaths {
        app_dir: native_path(app_dir),
        node: native_path(node),
        data_dir: data_root.join("data"),
    })
}

/// Default origin. 3100 matches `npm run dev` and the value baked into
/// `NEXT_PUBLIC_APP_URL`; changing it may make absolute links in outbound email
/// point at the wrong origin, so it is only a fallback preference.
pub fn preferred_port() -> u16 {
    env::var("ROLESPEC_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port >= 1024)
        .unwrap_or(3100)
}

/// Binds the preferred port, falling back to an OS-assigned loopback port when
/// it is occupied. The listener is released before the server starts.
pub fn choose_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }

    TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|address| address.port())
        .unwrap_or(preferred)
}

/// True only for a 200 status line. Any other status, an empty response or a
/// connection error means "not ready yet".
pub fn is_healthy_response(response: &[u8]) -> bool {
    let text = String::from_utf8_lossy(response);
    text.starts_with("HTTP/1.1 200") || text.starts_with("HTTP/1.0 200")
}

pub fn health_ok(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));

    let request = "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buffer = [0u8; 64];
    match stream.read(&mut buffer) {
        Ok(read) if read > 0 => is_healthy_response(&buffer[..read]),
        _ => false,
    }
}

/// Values the shell injects into the app server process. Secrets are written
/// to the child environment only: never to the log, the webview or a file in
/// the install directory.
pub struct ServerEnv {
    pub database_url: String,
    pub auth_secret: String,
    pub encryption_key: Option<String>,
}

pub struct ServerProcess {
    child: Child,
    port: u16,
}

impl ServerProcess {
    /// Starts `node server.js` with the port, writable paths and database
    /// configuration injected. Provider settings still come from the user's
    /// saved settings, not from the environment.
    pub fn spawn(
        paths: &DesktopPaths,
        port: u16,
        logger: &Logger,
        env: &ServerEnv,
        job: Option<&ProcessJob>,
    ) -> Result<Self, String> {
        fs::create_dir_all(paths.data_dir.join("exports"))
            .map_err(|error| format!("Could not create the RoleSpec data directory: {error}"))?;

        let stdout = OpenOptions::new()
            .create(true)
            .append(true)
            .open(logger.path())
            .map_err(|error| format!("Could not open the RoleSpec log file: {error}"))?;
        let stderr = stdout
            .try_clone()
            .map_err(|error| format!("Could not duplicate the RoleSpec log handle: {error}"))?;

        let mut command = quiet(&paths.node);
        command
            .arg("server.js")
            .current_dir(&paths.app_dir)
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("NODE_ENV", "production")
            .env("NEXT_TELEMETRY_DISABLED", "1")
            .env("DATABASE_URL", &env.database_url)
            .env("AUTH_SECRET", &env.auth_secret)
            .env("ROLESPEC_DESKTOP", "1")
            .env(
                "EXPORT_STORAGE_DIR",
                paths.data_dir.join("exports").as_os_str(),
            );
        if let Some(encryption_key) = &env.encryption_key {
            command.env("ENCRYPTION_KEY", encryption_key);
        }

        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| {
                format!(
                    "Could not start the RoleSpec server with {}: {error}",
                    paths.node.display()
                )
            })?;

        // Assign immediately: everything the server spawns later (provider
        // CLIs, PDF workers) must be contained by the same job.
        if let Some(job) = job {
            if let Err(error) = job.assign(child.id()) {
                logger.warn(&format!(
                    "Could not attach the RoleSpec server to the process job: {error}"
                ));
            }
        }

        Ok(Self { child, port })
    }

    /// Polls the existing `/api/health` route, which checks the database. This
    /// means "the port opened" is not enough: the application must be usable.
    pub fn wait_until_healthy(&mut self, timeout: Duration) -> Result<(), String> {
        let started = Instant::now();
        loop {
            if let Ok(Some(status)) = self.child.try_wait() {
                return Err(format!(
                    "The RoleSpec server exited during startup ({status})."
                ));
            }
            if health_ok(self.port) {
                return Ok(());
            }
            if started.elapsed() >= timeout {
                return Err(format!(
                    "RoleSpec did not become ready within {} seconds.",
                    timeout.as_secs()
                ));
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }

    /// Graceful first, forceful second. On Windows `taskkill` without `/F`
    /// requests a normal close for the whole child tree; Node usually exits on
    /// its own. A stuck process is force-killed so the port is never orphaned.
    pub fn stop(&mut self) {
        if matches!(self.child.try_wait(), Ok(Some(_))) {
            return;
        }

        #[cfg(windows)]
        {
            let pid = self.child.id().to_string();
            let _ = quiet("taskkill")
                .args(["/PID", &pid, "/T"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();

            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if matches!(self.child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(150));
            }

            let _ = quiet("taskkill")
                .args(["/PID", &pid, "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }

        #[cfg(not(windows))]
        {
            let _ = self.child.kill();
        }

        let _ = self.child.wait();
    }
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_200_health_responses() {
        assert!(is_healthy_response(b"HTTP/1.1 200 OK\r\n"));
        assert!(is_healthy_response(b"HTTP/1.0 200 OK\r\n"));
        assert!(!is_healthy_response(
            b"HTTP/1.1 503 Service Unavailable\r\n"
        ));
        assert!(!is_healthy_response(b""));
    }

    #[test]
    fn health_check_reads_a_real_200_response() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind test listener");
        let port = listener.local_addr().expect("listener address").port();

        let server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0u8; 256];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            }
        });

        assert!(health_ok(port));
        server.join().expect("health test server");
    }

    #[test]
    fn chooses_the_preferred_port_when_it_is_free() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind free port");
        let port = listener.local_addr().expect("address").port();
        drop(listener);

        assert_eq!(choose_port(port), port);
    }

    #[test]
    fn falls_back_when_the_preferred_port_is_taken() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind held port");
        let port = listener.local_addr().expect("address").port();

        let chosen = choose_port(port);

        assert_ne!(chosen, port);
        assert!(chosen > 0);
    }

    #[test]
    fn bundled_node_name_matches_the_platform() {
        if cfg!(windows) {
            assert_eq!(node_binary_name(), "node.exe");
        } else {
            assert_eq!(node_binary_name(), "node");
        }
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_paths_are_simplified_before_use() {
        assert_eq!(
            native_path(PathBuf::from(r"\\?\C:\RoleSpec\resources\app")),
            PathBuf::from(r"C:\RoleSpec\resources\app")
        );
        assert_eq!(
            native_path(PathBuf::from(r"\\?\UNC\server\share\RoleSpec")),
            PathBuf::from(r"\\server\share\RoleSpec")
        );
        assert_eq!(
            native_path(PathBuf::from(r"C:\RoleSpec")),
            PathBuf::from(r"C:\RoleSpec")
        );
    }

    #[test]
    fn data_root_is_separate_from_the_per_user_install_directory() {
        let root = app_data_root();
        assert_eq!(
            root.file_name().and_then(|name| name.to_str()),
            Some("RoleSpecData")
        );
    }

    #[test]
    fn packaged_resources_keep_their_resources_prefix() {
        let root =
            std::env::temp_dir().join(format!("rolespec-bundled-root-test-{}", std::process::id()));
        let nested = root.join("resources");
        std::fs::create_dir_all(nested.join("app")).expect("create nested resources");

        assert_eq!(bundled_root(&root), nested);

        std::fs::remove_dir_all(&root).expect("clean up nested resources");
        assert_eq!(bundled_root(&root), root);
    }

    #[test]
    fn missing_server_bundle_is_named_in_the_error() {
        let error = resolve_paths(None, false).expect_err("no resources in this test");
        assert!(error.contains("server bundle") || error.contains("resources"));
    }
}
