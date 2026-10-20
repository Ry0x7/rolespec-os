#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod job;
mod logging;
mod postgres;
mod process;
mod supervisor;
mod update;

use std::env;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use job::ProcessJob;
use logging::Logger;
use postgres::{load_or_create_secrets, DesktopSecrets, LocalPostgres};
use supervisor::{
    app_data_root, choose_port, preferred_port, resolve_paths, DesktopPaths, ServerEnv,
    ServerProcess,
};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_single_instance::init as single_instance;

struct AppState {
    server: Mutex<Option<ServerProcess>>,
    postgres: Mutex<Option<LocalPostgres>>,
    logger: Mutex<Option<Arc<Logger>>>,
    /// Held for the shell's lifetime; dropping it terminates every process
    /// still assigned to it.
    job: Mutex<Option<Arc<ProcessJob>>>,
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(single_instance(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // Configuration lives under `plugins.updater` in tauri.conf.json. The
        // JavaScript command surface is unused; `update.rs` drives the plugin.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            server: Mutex::new(None),
            postgres: Mutex::new(None),
            logger: Mutex::new(None),
            job: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let log_path = app_data_root().join("logs").join("desktop.log");
            let logger = match Logger::open(log_path.clone()) {
                Ok(logger) => Arc::new(logger),
                Err(error) => {
                    show_error(
                        "RoleSpec could not start",
                        &format!("Could not open the RoleSpec log file: {error}"),
                        &log_path,
                    );
                    handle.exit(1);
                    return Ok(());
                }
            };

            logger.info("RoleSpec desktop shell starting");
            logger.info(&format!("Log file: {}", logger.path().display()));

            {
                let state = handle.state::<AppState>();
                *state.logger.lock().expect("logger state lock") = Some(logger.clone());
            }

            // Created before any child process so a later crash cannot orphan
            // the server or database. Failure is warned, not fatal: the app is
            // still usable, it just loses crash containment.
            let job = match ProcessJob::create() {
                Ok(job) => Some(Arc::new(job)),
                Err(error) => {
                    logger.warn(&format!(
                        "Could not create the process job; a crash may leave RoleSpec processes running: {error}"
                    ));
                    None
                }
            };
            if job.is_some() {
                logger.info("Process containment: kill-on-close job object");
            }
            {
                let state = handle.state::<AppState>();
                *state.job.lock().expect("job state lock") = job.clone();
            }

            let resource_dir = app.path().resource_dir().ok();
            let is_dev = cfg!(debug_assertions);
            let paths = match resolve_paths(resource_dir.as_deref(), is_dev) {
                Ok(paths) => paths,
                Err(message) => {
                    logger.error(&message);
                    show_error("RoleSpec runtime is missing", &message, logger.path());
                    handle.exit(1);
                    return Ok(());
                }
            };

            logger.info(&format!("Server bundle: {}", paths.app_dir.display()));
            logger.info(&format!("Node runtime: {}", paths.node.display()));

            let managed = managed_database();
            logger.info(if managed {
                "Database: managed local PostgreSQL"
            } else {
                "Database: DATABASE_URL from the environment"
            });

            let secrets = match load_secrets(managed, &logger) {
                Ok(secrets) => secrets,
                Err(message) => {
                    logger.error(&message);
                    show_error("RoleSpec needs configuration", &message, logger.path());
                    handle.exit(1);
                    return Ok(());
                }
            };

            update::spawn_startup_check(handle.clone(), logger.clone());

            std::thread::spawn(move || {
                if let Err(message) = start_runtime(
                    &handle,
                    &paths,
                    resource_dir.as_deref(),
                    is_dev,
                    managed,
                    secrets,
                    job,
                    &logger,
                ) {
                    logger.error(&message);
                    stop_runtime(&handle);
                    show_error("RoleSpec could not start", &message, logger.path());
                    handle.exit(1);
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the RoleSpec desktop shell");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            let state = app_handle.state::<AppState>();
            if state.server.lock().expect("server state lock").is_some() {
                if let Some(logger) = state.logger.lock().expect("logger state lock").as_ref() {
                    logger.info("Window closed; stopping RoleSpec");
                }
            }
            stop_runtime(app_handle);
        }
    });
}

/// Managed by default for a desktop launch. A developer can point at an
/// existing database with `DATABASE_URL`, or force the managed cluster with
/// `ROLESPEC_MANAGED_DB=1`.
fn managed_database() -> bool {
    match env::var("ROLESPEC_MANAGED_DB") {
        Ok(value) => !(value == "0" || value.eq_ignore_ascii_case("false")),
        Err(_) => env::var("DATABASE_URL")
            .map(|value| value.trim().is_empty())
            .unwrap_or(true),
    }
}

/// Desktop secrets must be stable across updates, or every stored AI key
/// becomes unreadable. Managed mode owns the file and ignores env overrides;
/// external mode keeps the old environment contract.
fn load_secrets(managed: bool, logger: &Arc<Logger>) -> Result<DesktopSecrets, String> {
    if managed {
        if env::var("AUTH_SECRET").is_ok() || env::var("ENCRYPTION_KEY").is_ok() {
            logger.warn(
                "AUTH_SECRET/ENCRYPTION_KEY are set but ignored: the managed desktop build uses its own stable secrets.",
            );
        }
        return load_or_create_secrets(logger);
    }

    let auth_secret = env::var("AUTH_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(
            "DATABASE_URL is set, so RoleSpec is using an external database. Set AUTH_SECRET as well, or unset DATABASE_URL to use the managed local database.",
        )?;

    Ok(DesktopSecrets {
        auth_secret,
        encryption_key: env::var("ENCRYPTION_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_default(),
    })
}

#[allow(clippy::too_many_arguments)]
fn start_runtime(
    handle: &tauri::AppHandle,
    paths: &DesktopPaths,
    resource_dir: Option<&Path>,
    is_dev: bool,
    managed: bool,
    secrets: DesktopSecrets,
    job: Option<Arc<ProcessJob>>,
    logger: &Arc<Logger>,
) -> Result<(), String> {
    let preferred = preferred_port();
    let port = choose_port(preferred);
    if port != preferred {
        logger.warn(&format!(
            "Preferred port {preferred} was unavailable; using {port}. Absolute links built with NEXT_PUBLIC_APP_URL may still point at the preferred port."
        ));
    }

    let postgres = if managed {
        let postgres_paths = postgres::resolve_paths(resource_dir, is_dev)?;
        Some(LocalPostgres::start(
            &postgres_paths,
            &paths.node,
            logger,
            job.as_deref(),
        )?)
    } else {
        None
    };

    let database_url = match &postgres {
        Some(postgres) => postgres.database_url(),
        None => env::var("DATABASE_URL").map_err(|_| {
            "No database is configured. Unset DATABASE_URL to use the managed local database."
                .to_string()
        })?,
    };

    if let Some(postgres) = postgres {
        let state = handle.state::<AppState>();
        *state.postgres.lock().expect("postgres state lock") = Some(postgres);
    }

    logger.info(&format!("Starting RoleSpec server on 127.0.0.1:{port}"));
    let mut server = ServerProcess::spawn(
        paths,
        port,
        logger,
        &ServerEnv {
            database_url,
            auth_secret: secrets.auth_secret,
            encryption_key: if secrets.encryption_key.trim().is_empty() {
                None
            } else {
                Some(secrets.encryption_key)
            },
        },
        job.as_deref(),
    )?;

    server.wait_until_healthy(Duration::from_secs(60))?;
    logger.info(&format!("RoleSpec is ready on port {port}"));

    {
        let state = handle.state::<AppState>();
        *state.server.lock().expect("server state lock") = Some(server);
    }

    // `/onboarding` is the first-run entry point and redirects to `/dashboard`
    // once `onboardedAt` is set. Opening `/` skipped setup entirely.
    let url = format!("http://127.0.0.1:{port}/onboarding");
    WebviewWindowBuilder::new(
        handle,
        "main",
        WebviewUrl::External(url.parse().expect("loopback URL")),
    )
    .title("RoleSpec")
    .inner_size(1280.0, 860.0)
    .min_inner_size(960.0, 640.0)
    .center()
    .build()
    .map_err(|error| format!("RoleSpec started, but its window could not be opened: {error}"))?;

    Ok(())
}

/// Stops the app server before the database: the server must not reconnect to a
/// cluster that is already shutting down.
pub(crate) fn stop_runtime(handle: &tauri::AppHandle) {
    let state = handle.state::<AppState>();
    let server = state.server.lock().expect("server state lock").take();
    if let Some(mut server) = server {
        server.stop();
    }
    let postgres = state.postgres.lock().expect("postgres state lock").take();
    if let Some(mut postgres) = postgres {
        postgres.stop();
    }
}

fn show_error(title: &str, message: &str, log_path: &Path) {
    let description = format!("{message}\n\nLog file:\n{}", log_path.display());
    let _ = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title(title)
        .set_description(description)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}
