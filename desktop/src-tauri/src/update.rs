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

use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::logging::Logger;

/// Long enough for the window, the server and onboarding to be up before a
/// modal dialog can appear.
const STARTUP_DELAY: Duration = Duration::from_secs(10);

/// Checks once, shortly after startup, on a background thread.
pub fn spawn_startup_check(handle: AppHandle, logger: Arc<Logger>) {
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
