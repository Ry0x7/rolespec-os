//! Self-update for the desktop shell.
//!
//! The window loads the local RoleSpec server rather than bundled HTML, so the
//! updater plugin's JavaScript commands have no page to reach them and
//! `withGlobalTauri` stays off. The whole flow therefore lives here: check the
//! configured endpoint, let the plugin verify the artifact against the
//! compiled-in public key, download it, stop the managed runtime, install, and
//! let the installer relaunch the app.
//!
//! Verification is the only thing that makes this safe. A manifest served from
//! GitHub is not itself signed, so a tampered `latest.json` could otherwise
//! point at an older genuine build; `requireSignedVersion` binds the artifact to
//! the version the manifest announces, and the server-side schema guard refuses
//! a database that a downgrade would corrupt.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::logging::Logger;
use crate::supervisor::app_data_root;

/// Long enough for the window, the server and onboarding to be up before a
/// modal dialog can appear.
const STARTUP_DELAY: Duration = Duration::from_secs(10);

/// The desktop-only update preference written by Settings → Preferences.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSettings {
    #[serde(default = "enabled_by_default")]
    auto_check: bool,
}

fn enabled_by_default() -> bool {
    true
}

fn parse_auto_check(contents: &str) -> Option<bool> {
    serde_json::from_str::<UpdateSettings>(contents)
        .ok()
        .map(|settings| settings.auto_check)
}

/// Missing settings keep the old behaviour (check automatically); only an
/// explicit `{"autoCheck": false}` disables the startup check.
fn auto_check_enabled(logger: &Arc<Logger>) -> bool {
    auto_check_enabled_at(
        &app_data_root().join("config").join("updates.json"),
        logger,
    )
}

fn auto_check_enabled_at(path: &Path, logger: &Arc<Logger>) -> bool {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => return true,
        Err(error) => {
            logger.warn(&format!(
                "Could not read {}: {error}. Update checks stay enabled.",
                path.display()
            ));
            return true;
        }
    };

    match parse_auto_check(&contents) {
        Some(enabled) => enabled,
        None => {
            logger.warn(&format!(
                "{} is not valid update settings. Update checks stay enabled.",
                path.display()
            ));
            true
        }
    }
}

/// Checks once, shortly after startup, on a background thread.
pub fn spawn_startup_check(handle: AppHandle, logger: Arc<Logger>) {
    if !auto_check_enabled(&logger) {
        logger.info("Automatic update checks are disabled in Settings → Preferences");
        return;
    }

    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_DELAY);
        if let Err(message) = check_and_install(&handle, &logger) {
            logger.warn(&format!("Update check failed: {message}"));
        }
    });
}

fn check_and_install(handle: &AppHandle, logger: &Arc<Logger>) -> Result<(), String> {
    let updater = match handle.updater() {
        Ok(updater) => updater,
        Err(error) => {
            logger.info(&format!(
                "Automatic updates are not configured in this build: {error}"
            ));
            return Ok(());
        }
    };

    let Some(update) = tauri::async_runtime::block_on(updater.check())
        .map_err(|error| format!("the update endpoint could not be reached: {error}"))?
    else {
        logger.info("RoleSpec is up to date");
        return Ok(());
    };

    logger.info(&format!(
        "RoleSpec {} is available (installed: {})",
        update.version, update.current_version
    ));

    let mut description = format!(
        "RoleSpec {} is available. You have {}.",
        update.version, update.current_version
    );
    if let Some(body) = update
        .body
        .as_deref()
        .map(str::trim)
        .filter(|body| !body.is_empty())
    {
        description.push_str("\n\n");
        description.push_str(body);
    }
    description.push_str(
        "\n\nThe download is verified against RoleSpec's update key before anything is installed. RoleSpec restarts when it is done.",
    );

    let accepted = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Info)
        .set_title("RoleSpec update available")
        .set_description(description)
        .set_buttons(rfd::MessageButtons::YesNo)
        .show()
        == rfd::MessageDialogResult::Yes;
    if !accepted {
        logger.info("The update was postponed");
        return Ok(());
    }

    // Download while the app is still fully usable. `download` verifies the
    // signature, so a bad artifact never reaches the install step.
    logger.info(&format!("Downloading RoleSpec {}", update.version));
    let bytes = tauri::async_runtime::block_on(
        update.download(|_chunk: usize, _total: Option<u64>| {}, || {}),
    )
    .map_err(|error| format!("the update could not be downloaded: {error}"))?;

    // `install` hands the installer to Windows and exits this process, so the
    // server, the cluster and the log handles are stopped here: the NSIS
    // installer cannot replace files that are still in use.
    logger.info("Stopping RoleSpec before installing the update");
    crate::stop_runtime(handle);

    logger.info("Installing the update");
    update
        .install(bytes)
        .map_err(|error| format!("the update could not be installed: {error}"))?;

    // Windows only returns here when the installer could not be launched.
    Err("the installer did not start".to_string())
}

#[cfg(test)]
mod tests {
    use super::{auto_check_enabled_at, parse_auto_check};
    use crate::logging::Logger;
    use std::fs;
    use std::sync::Arc;

    fn test_logger(name: &str) -> Arc<Logger> {
        let path = std::env::temp_dir().join(format!(
            "rolespec-update-{name}-{}.log",
            std::process::id()
        ));
        Arc::new(Logger::open(path).expect("open test logger"))
    }

    #[test]
    fn missing_settings_file_keeps_checks_enabled() {
        let path = std::env::temp_dir().join(format!(
            "rolespec-update-missing-{}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        assert!(auto_check_enabled_at(&path, &test_logger("missing")));
    }

    #[test]
    fn saved_false_disables_checks() {
        let path = std::env::temp_dir().join(format!(
            "rolespec-update-false-{}.json",
            std::process::id()
        ));
        fs::write(&path, r#"{"autoCheck":false}"#).expect("write settings");

        assert!(!auto_check_enabled_at(&path, &test_logger("false")));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn missing_preference_keeps_checks_enabled() {
        assert_eq!(parse_auto_check("{}"), Some(true));
    }

    #[test]
    fn explicit_false_disables_checks() {
        assert_eq!(parse_auto_check(r#"{"autoCheck":false}"#), Some(false));
    }

    #[test]
    fn explicit_true_keeps_checks_enabled() {
        assert_eq!(parse_auto_check(r#"{"autoCheck":true}"#), Some(true));
    }

    #[test]
    fn malformed_preference_is_reported_as_unknown() {
        assert_eq!(parse_auto_check("not json"), None);
        assert_eq!(parse_auto_check(r#"{"autoCheck":"no"}"#), None);
    }
}
