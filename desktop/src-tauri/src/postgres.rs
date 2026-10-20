use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::job::ProcessJob;
use crate::logging::Logger;
use crate::process::quiet;
use crate::supervisor::{app_data_root, bundled_root, native_path};

const DATABASE_NAME: &str = "rolespec";
const DATABASE_USER: &str = "rolespec";
const PREFERRED_PORT: u16 = 54329;
const START_TIMEOUT_SECONDS: u64 = 60;

/// Where the managed database and its migration tooling live.
#[derive(Debug)]
pub struct PostgresPaths {
    pub bin: PathBuf,
    pub prisma: PathBuf,
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

fn binary(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn resolve_pg_root(resource_dir: Option<&Path>, is_dev: bool) -> Result<PathBuf, String> {
    let candidate = if let Some(override_dir) = env::var_os("ROLESPEC_PG_DIR") {
        let dir = PathBuf::from(override_dir);
        if dir.join("bin").join(binary("pg_ctl")).exists() {
            dir
        } else if dir.join(binary("pg_ctl")).exists() {
            dir.parent().unwrap_or(&dir).to_path_buf()
        } else {
            return Err(format!(
                "ROLESPEC_PG_DIR points at {}, but no pg_ctl was found there.",
                dir.display()
            ));
        }
    } else if is_dev {
        repo_root()
            .join("desktop")
            .join("src-tauri")
            .join("resources")
            .join("postgres")
    } else {
        let root = resource_dir.ok_or("Could not locate the RoleSpec database resources.")?;
        bundled_root(root).join("postgres")
    };

    let pg_ctl = candidate.join("bin").join(binary("pg_ctl"));
    if !pg_ctl.exists() {
        return Err(format!(
            "The bundled PostgreSQL runtime was not found at {}.\n\nRun `npm run desktop:postgres` once, then `npm run desktop:stage`, or set ROLESPEC_PG_DIR to an existing PostgreSQL 17 installation.",
            pg_ctl.display()
        ));
    }

    Ok(candidate)
}

fn resolve_prisma_root(resource_dir: Option<&Path>, is_dev: bool) -> Result<PathBuf, String> {
    let candidate = if let Some(override_dir) = env::var_os("ROLESPEC_PRISMA_DIR") {
        PathBuf::from(override_dir)
    } else if is_dev {
        repo_root()
            .join("desktop")
            .join("src-tauri")
            .join("resources")
            .join("prisma")
    } else {
        let root = resource_dir.ok_or("Could not locate the RoleSpec migration resources.")?;
        bundled_root(root).join("prisma")
    };

    let cli = candidate
        .join("node_modules")
        .join("prisma")
        .join("build")
        .join("index.js");
    if !cli.exists() {
        return Err(format!(
            "The bundled Prisma CLI was not found at {}.\n\nRun `npm run desktop:stage` from the repository root.",
            cli.display()
        ));
    }

    Ok(candidate)
}

pub fn resolve_paths(resource_dir: Option<&Path>, is_dev: bool) -> Result<PostgresPaths, String> {
    Ok(PostgresPaths {
        bin: native_path(resolve_pg_root(resource_dir, is_dev)?),
        prisma: native_path(resolve_prisma_root(resource_dir, is_dev)?),
    })
}

fn tail(path: &Path, lines: usize) -> String {
    let Ok(contents) = fs::read_to_string(path) else {
        return String::new();
    };
    let all: Vec<&str> = contents.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

fn output_text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    format!("{}{}", stdout.trim(), stderr.trim())
        .trim()
        .to_string()
}

fn port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn accepting_connections(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(500),
    )
    .is_ok()
}

fn pick_port() -> u16 {
    if port_available(PREFERRED_PORT) {
        return PREFERRED_PORT;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|address| address.port())
        .unwrap_or(PREFERRED_PORT)
}

/// A PostgreSQL 17 cluster owned by this installation.
///
/// Data lives outside the install directory so updates and uninstall cannot
/// delete it. The cluster is started on loopback only and uses `trust` auth:
/// the database is not reachable from the network, and the process account is
/// the only account that can read the data directory.
pub struct LocalPostgres {
    bin: PathBuf,
    cluster: PathBuf,
    log_path: PathBuf,
    port: u16,
    running: bool,
    logger: Arc<Logger>,
}

impl LocalPostgres {
    pub fn start(
        paths: &PostgresPaths,
        node: &Path,
        logger: &Arc<Logger>,
        job: Option<&ProcessJob>,
    ) -> Result<Self, String> {
        let data_root = app_data_root().join("data");
        let cluster = data_root.join("pg");
        let log_path = app_data_root().join("logs").join("postgres.log");
        if let Some(parent) = log_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create the RoleSpec log directory: {error}"))?;
        }

        let pg_ctl = paths.bin.join("bin").join(binary("pg_ctl"));
        let status = quiet(&pg_ctl)
            .args([
                "-D",
                cluster.as_os_str().to_string_lossy().as_ref(),
                "status",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        let already_running = matches!(status, Ok(result) if result.success());
        if !cluster.join("PG_VERSION").exists() {
            init_cluster(paths, &cluster, logger)?;
        }

        let port = if already_running {
            running_port(&cluster)?
        } else {
            let _ = fs::remove_file(cluster.join("postmaster.pid"));
            pick_port()
        };

        if !already_running {
            start_cluster(&pg_ctl, &cluster, port, &log_path, logger)?;
        } else {
            logger.info(&format!(
                "Reusing the running RoleSpec PostgreSQL cluster on port {port}"
            ));
        }

        // `initdb` and `pg_ctl` are short-lived and not worth containing; the
        // postmaster is the process that must die with the shell. Its backends
        // and background workers join the same job as its children.
        if let Some(job) = job {
            match postmaster_pid(&cluster) {
                Some(pid) => {
                    if let Err(error) = job.assign(pid) {
                        logger.warn(&format!(
                            "Could not attach PostgreSQL ({pid}) to the process job: {error}"
                        ));
                    }
                }
                None => logger.warn(
                    "Could not read the PostgreSQL process id; a shell crash may leave it running.",
                ),
            }
        }

        let mut postgres = Self {
            bin: paths.bin.clone(),
            cluster,
            log_path,
            port,
            running: true,
            logger: logger.clone(),
        };

        // A failed migration drops `postgres`, which stops the server if this
        // was our first start, so it never leaves an orphaned cluster behind.
        postgres.prepare(node, &paths.prisma)?;

        Ok(postgres)
    }

    fn prepare(&mut self, node: &Path, prisma: &Path) -> Result<(), String> {
        self.logger.info(&format!(
            "PostgreSQL 17 is ready on 127.0.0.1:{} (data: {})",
            self.port,
            self.cluster.display()
        ));

        self.ensure_database()?;
        self.guard_schema(prisma)?;
        self.apply_migrations(node, prisma)?;
        Ok(())
    }

    /// One-way guard against downgrades.
    ///
    /// Prisma only migrates forward. If the database has a migration this
    /// build does not ship, the data was written by a newer RoleSpec and
    /// starting anyway would run old code against a newer schema — usually a
    /// silent column/type mismatch instead of a clean failure. The
    /// authoritative record is `_prisma_migrations`, which Prisma maintains,
    /// so no side table or marker file is needed and a restored backup that
    /// predates the guard still works.
    fn guard_schema(&self, prisma: &Path) -> Result<(), String> {
        let has_table = self.query_scalar(
            "SELECT 1 FROM information_schema.tables \
             WHERE table_schema = 'public' AND table_name = '_prisma_migrations'",
        )?;
        if has_table.trim() != "1" {
            return Ok(());
        }

        let applied = self.query_scalar(
            "SELECT COALESCE(string_agg(migration_name, chr(10) ORDER BY migration_name), '') \
             FROM _prisma_migrations \
             WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
        )?;
        let applied: Vec<String> = applied
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect();
        if applied.is_empty() {
            return Ok(());
        }

        let available = available_migrations(&prisma.join("migrations"));
        if available.is_empty() {
            // A missing or unreadable migrations directory is a packaging
            // problem that `apply_migrations` reports properly; refusing to
            // start here would only mask it.
            self.logger
                .warn("Could not read the bundled migrations; skipping the schema version guard.");
            return Ok(());
        }

        let unknown = unknown_migrations(&applied, &available);
        if unknown.is_empty() {
            return Ok(());
        }

        Err(format!(
            "This RoleSpec data was created by a newer version of RoleSpec.\n\n\
             Database migrations this build does not have:\n  {}\n\n\
             Install the newest RoleSpec to open this data. Deleting\n  {}\n\
             would start over and lose the database, the exports and the stored AI keys.",
            unknown.join("\n  "),
            app_data_root().display()
        ))
    }

    /// Runs a one-value query as the RoleSpec user against the RoleSpec database.
    fn query_scalar(&self, sql: &str) -> Result<String, String> {
        let psql = self.bin.join("bin").join(binary("psql"));
        let output = quiet(&psql)
            .args([
                "-h",
                "127.0.0.1",
                "-p",
                &self.port.to_string(),
                "-U",
                DATABASE_USER,
                "-d",
                DATABASE_NAME,
                "-tAc",
                sql,
            ])
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("Could not run psql: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "The database schema version could not be read.\n\n{}\n\nLog: {}",
                output_text(&output),
                self.log_path.display()
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn ensure_database(&self) -> Result<(), String> {
        let psql = self.bin.join("bin").join(binary("psql"));
        let query = format!("SELECT 1 FROM pg_database WHERE datname = '{DATABASE_NAME}'");
        let output = quiet(&psql)
            .args([
                "-h",
                "127.0.0.1",
                "-p",
                &self.port.to_string(),
                "-U",
                DATABASE_USER,
                "-d",
                "postgres",
                "-tAc",
                &query,
            ])
            .output()
            .map_err(|error| format!("Could not run psql: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "PostgreSQL started, but the database check failed.\n\n{}\n\nLog: {}",
                output_text(&output),
                self.log_path.display()
            ));
        }

        if String::from_utf8_lossy(&output.stdout).trim() == "1" {
            return Ok(());
        }

        let createdb = self.bin.join("bin").join(binary("createdb"));
        let output = quiet(&createdb)
            .args([
                "-h",
                "127.0.0.1",
                "-p",
                &self.port.to_string(),
                "-U",
                DATABASE_USER,
                DATABASE_NAME,
            ])
            .output()
            .map_err(|error| format!("Could not run createdb: {error}"))?;

        if output.status.success() {
            self.logger.info("Created the RoleSpec database");
            Ok(())
        } else {
            Err(format!(
                "The RoleSpec database could not be created.\n\n{}\n\nLog: {}",
                output_text(&output),
                self.log_path.display()
            ))
        }
    }

    fn apply_migrations(&self, node: &Path, prisma: &Path) -> Result<(), String> {
        let cli = prisma
            .join("node_modules")
            .join("prisma")
            .join("build")
            .join("index.js");
        let config = prisma.join("prisma.config.mjs");

        self.logger.info("Applying database migrations...");
        let output = quiet(node)
            .arg(&cli)
            .args(["migrate", "deploy", "--config"])
            .arg(&config)
            .current_dir(prisma)
            .env("DATABASE_URL", self.database_url())
            .env("NODE_ENV", "production")
            .env("CHECKPOINT_DISABLE", "1")
            .env("PRISMA_HIDE_UPDATE_MESSAGE", "1")
            .env("PRISMA_TELEMETRY_DISABLED", "1")
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("Could not run the bundled Prisma CLI: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "The database schema could not be updated.\n\n{}\n\nPostgreSQL log: {}",
                output_text(&output),
                self.log_path.display()
            ));
        }

        self.logger.info("Database schema is up to date");
        Ok(())
    }

    pub fn database_url(&self) -> String {
        format!(
            "postgresql://{DATABASE_USER}@127.0.0.1:{}/{DATABASE_NAME}?schema=public&sslmode=disable&connect_timeout=10",
            self.port
        )
    }

    pub fn stop(&mut self) {
        if !self.running {
            return;
        }
        self.running = false;

        let pg_ctl = self.bin.join("bin").join(binary("pg_ctl"));
        self.logger.info("Stopping the RoleSpec PostgreSQL cluster");
        let output = quiet(&pg_ctl)
            .args([
                "-D",
                self.cluster.as_os_str().to_string_lossy().as_ref(),
                "-m",
                "fast",
                "-w",
                "-t",
                "30",
                "stop",
            ])
            .stdin(Stdio::null())
            .output();

        match output {
            Ok(result) if result.status.success() => {
                self.logger.info("PostgreSQL stopped");
            }
            Ok(result) => {
                self.logger.warn(&format!(
                    "PostgreSQL did not stop cleanly: {}",
                    output_text(&result)
                ));
            }
            Err(error) => self
                .logger
                .warn(&format!("Could not stop PostgreSQL: {error}")),
        }
    }
}

impl Drop for LocalPostgres {
    fn drop(&mut self) {
        self.stop();
    }
}

fn postmaster_pid(cluster: &Path) -> Option<u32> {
    fs::read_to_string(cluster.join("postmaster.pid"))
        .ok()?
        .lines()
        .next()?
        .trim()
        .parse()
        .ok()
}

fn running_port(cluster: &Path) -> Result<u16, String> {
    let contents = fs::read_to_string(cluster.join("postmaster.pid")).map_err(|error| {
        format!(
            "PostgreSQL reports that it is running, but its port file could not be read: {error}"
        )
    })?;
    contents
        .lines()
        .nth(3)
        .and_then(|line| line.trim().parse::<u16>().ok())
        .ok_or_else(|| {
            "PostgreSQL reports that it is running, but its port could not be determined."
                .to_string()
        })
}

fn init_cluster(paths: &PostgresPaths, cluster: &Path, logger: &Arc<Logger>) -> Result<(), String> {
    if cluster.exists() {
        let empty = fs::read_dir(cluster)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if !empty {
            return Err(format!(
                "{} exists but is not a valid PostgreSQL cluster. Move it aside, then start RoleSpec again.\n\nLog: {}",
                cluster.display(),
                app_data_root().join("logs").join("postgres.log").display()
            ));
        }
    }

    let temporary = cluster.with_extension("init");
    let _ = fs::remove_dir_all(&temporary);
    if let Some(parent) = cluster.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the RoleSpec data directory: {error}"))?;
    }

    logger.info("Initializing the RoleSpec PostgreSQL cluster...");
    let initdb = paths.bin.join("bin").join(binary("initdb"));
    let output = quiet(&initdb)
        .args([
            "-D",
            temporary.as_os_str().to_string_lossy().as_ref(),
            "-U",
            DATABASE_USER,
            "-A",
            "trust",
            "-E",
            "UTF8",
            "--locale=C",
            "--no-instructions",
        ])
        .output()
        .map_err(|error| format!("Could not run initdb: {error}"))?;

    if !output.status.success() {
        let _ = fs::remove_dir_all(&temporary);
        return Err(format!(
            "The local database could not be initialized.\n\n{}",
            output_text(&output)
        ));
    }

    if cluster.exists() {
        let _ = fs::remove_dir(cluster);
    }
    fs::rename(&temporary, cluster).map_err(|error| {
        let _ = fs::remove_dir_all(&temporary);
        format!("The local database was created but could not be moved into place: {error}")
    })?;

    logger.info("PostgreSQL cluster initialized");
    Ok(())
}

fn start_cluster(
    pg_ctl: &Path,
    cluster: &Path,
    port: u16,
    log_path: &Path,
    logger: &Arc<Logger>,
) -> Result<(), String> {
    logger.info(&format!(
        "Starting PostgreSQL on 127.0.0.1:{port} (log: {})",
        log_path.display()
    ));

    let options = format!("-p {port} -h 127.0.0.1");
    // `pg_ctl start` launches the postmaster and exits, but the postmaster
    // inherits its standard handles. `Command::output()` would therefore wait
    // for the database to stop, not for pg_ctl to finish. The server's own
    // output goes to `-l`, so discard the inherited handles and wait on the
    // pg_ctl exit status only.
    let status = quiet(pg_ctl)
        .args([
            "-D",
            cluster.as_os_str().to_string_lossy().as_ref(),
            "-l",
            log_path.as_os_str().to_string_lossy().as_ref(),
            "-o",
            &options,
            "-w",
            "-t",
            &START_TIMEOUT_SECONDS.to_string(),
            "start",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("Could not run pg_ctl: {error}"))?;

    if !status.success() {
        let details = tail(log_path, 15);
        return Err(format!(
            "PostgreSQL did not start (pg_ctl exited with {status}).\n\nPostgreSQL log:\n{}",
            if details.is_empty() {
                "(empty)".to_string()
            } else {
                details
            }
        ));
    }

    // pg_ctl -w returned success, but a second connection check keeps a stale
    // pid file or a half-started cluster from reaching the app server.
    let deadline = Instant::now() + Duration::from_secs(START_TIMEOUT_SECONDS);
    while Instant::now() < deadline {
        if accepting_connections(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    Err(format!(
        "PostgreSQL reported that it started, but 127.0.0.1:{port} never accepted connections.\n\nPostgreSQL log:\n{}",
        tail(log_path, 15)
    ))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretFile {
    auth_secret: String,
    encryption_key: String,
}

pub struct DesktopSecrets {
    pub auth_secret: String,
    pub encryption_key: String,
}

fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buffer);
    buffer.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Loads the stable desktop secrets, or creates them on first launch.
///
/// They are stored outside the install directory because rotating them on an
/// update would make every encrypted AI key unreadable. A corrupt file is an
/// error, not a reason to silently generate new values.
pub fn load_or_create_secrets(logger: &Arc<Logger>) -> Result<DesktopSecrets, String> {
    let directory = app_data_root().join("config");
    let path = directory.join("secrets.json");

    if path.exists() {
        let contents = fs::read_to_string(&path)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        let parsed: SecretFile = serde_json::from_str(&contents).map_err(|error| {
            format!(
                "{} is not readable. Restore it from a backup instead of deleting it: stored AI keys are encrypted with these values. ({error})",
                path.display()
            )
        })?;
        if parsed.auth_secret.trim().is_empty() || parsed.encryption_key.trim().is_empty() {
            return Err(format!(
                "{} is missing a secret. Restore it from a backup instead of deleting it.",
                path.display()
            ));
        }
        return Ok(DesktopSecrets {
            auth_secret: parsed.auth_secret,
            encryption_key: parsed.encryption_key,
        });
    }

    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create {}: {error}", directory.display()))?;

    let generated = SecretFile {
        auth_secret: random_hex(32),
        encryption_key: random_hex(32),
    };
    let serialized = serde_json::to_vec_pretty(&generated)
        .map_err(|error| format!("Could not serialize the desktop secrets: {error}"))?;

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|error| format!("Could not create {}: {error}", path.display()))?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    drop(file);

    #[cfg(windows)]
    restrict_windows_acl(&path, logger);

    logger.info(&format!("Created desktop secrets at {}", path.display()));

    Ok(DesktopSecrets {
        auth_secret: generated.auth_secret,
        encryption_key: generated.encryption_key,
    })
}

#[cfg(windows)]
fn restrict_windows_acl(path: &Path, logger: &Arc<Logger>) {
    // %LOCALAPPDATA% is already per-user, but removing inherited ACEs keeps
    // administrators from being able to read stored AI credentials by default.
    let Some(user) = env::var("USERNAME")
        .ok()
        .filter(|name| !name.trim().is_empty())
    else {
        logger.warn("Could not determine the Windows user; leaving the secrets file with inherited permissions.");
        return;
    };
    let status = quiet("icacls")
        .arg(path)
        .args(["/inheritance:r", "/grant:r"])
        .arg(format!("{user}:F"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(result) if result.success() => {}
        Ok(result) => logger.warn(&format!(
            "icacls could not restrict the secrets file (exit {result}). It remains protected by the per-user %LOCALAPPDATA% directory."
        )),
        Err(error) => logger.warn(&format!(
            "Could not run icacls for the secrets file: {error}. It remains protected by the per-user %LOCALAPPDATA% directory."
        )),
    }
}

/// Migration directories shipped with this build, sorted for stable messages.
fn available_migrations(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .collect();
    names.sort();
    names
}

/// Applied migrations this build cannot honour, in database order.
fn unknown_migrations(applied: &[String], available: &[String]) -> Vec<String> {
    applied
        .iter()
        .filter(|name| !available.contains(name))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_url_is_loopback_only() {
        let postgres = LocalPostgres {
            bin: PathBuf::from("C:\\pg"),
            cluster: PathBuf::from("C:\\data"),
            log_path: PathBuf::from("C:\\data\\postgres.log"),
            port: 54329,
            running: false,
            logger: Arc::new(Logger::open(env::temp_dir().join("rolespec-pg-unit.log")).unwrap()),
        };
        let url = postgres.database_url();
        assert!(url.starts_with("postgresql://rolespec@127.0.0.1:54329/rolespec"));
        assert!(!url.contains("0.0.0.0"));
    }

    #[test]
    fn downgrade_is_detected_when_the_database_is_ahead() {
        let applied = ["20260101_a".to_string(), "20260202_b".to_string()];
        let available = ["20260101_a".to_string()];
        assert_eq!(
            unknown_migrations(&applied, &available),
            vec!["20260202_b".to_string()]
        );
    }

    #[test]
    fn equal_or_older_database_is_allowed() {
        let applied = ["20260101_a".to_string()];
        let available = ["20260101_a".to_string(), "20260202_b".to_string()];
        assert!(unknown_migrations(&applied, &available).is_empty());
    }

    #[test]
    fn available_migrations_reads_only_directories() {
        let root = env::temp_dir().join(format!("rolespec-migrations-{}", random_hex(8)));
        fs::create_dir_all(root.join("20260101_a")).unwrap();
        fs::write(
            root.join("migration_lock.toml"),
            "provider = \"postgresql\"\n",
        )
        .unwrap();
        assert_eq!(
            available_migrations(&root),
            vec!["20260101_a".to_string()],
            "files next to migration directories are not migrations"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn generated_secrets_are_hex_and_distinct() {
        let first = random_hex(32);
        let second = random_hex(32);
        assert_eq!(first.len(), 64);
        assert_eq!(second.len(), 64);
        assert_ne!(first, second);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn missing_pg_directory_is_named_in_the_error() {
        let error = resolve_paths(Some(Path::new("C:\\definitely-not-here")), false)
            .expect_err("no postgres resources in this test");
        assert!(error.contains("PostgreSQL") || error.contains("postgres"));
    }
}
