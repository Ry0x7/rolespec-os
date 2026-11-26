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
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::logging::Logger;
use crate::supervisor::app_data_root;

/// Long enough for the window, the server and onboarding to be up before a
/// modal dialog can appear.
const STARTUP_DELAY: Duration = Duration::from_secs(10);

/// The settings page writes a request and polls for a result while the shell
/// keeps working; one second keeps the button responsive without busy-waiting.
const REQUEST_WATCH_INTERVAL: Duration = Duration::from_secs(1);

const UPDATE_REQUEST_FILE: &str = "update-check.json";
const UPDATE_STATUS_FILE: &str = "update-status.json";

const STABLE_UPDATE_ENDPOINT: &str =
    "https://github.com/Ry0x7/rolespec-os/releases/latest/download/latest.json";
const BETA_UPDATE_ENDPOINT: &str =
    "https://github.com/Ry0x7/rolespec-os/releases/download/beta/latest-beta.json";

/// Stable is the safe default: an unknown or removed channel name must never
/// move an installed copy onto prereleases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum UpdateChannel {
    #[default]
    Stable,
    Beta,
}

impl UpdateChannel {
    fn parse(value: Option<&str>) -> Self {
        if value.map(str::trim) == Some("beta") {
            Self::Beta
        } else {
            Self::Stable
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Self::Stable => STABLE_UPDATE_ENDPOINT,
            Self::Beta => BETA_UPDATE_ENDPOINT,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct UpdatePreferences {
    auto_check: bool,
    channel: UpdateChannel,
}

impl Default for UpdatePreferences {
    fn default() -> Self {
        Self {
            auto_check: true,
            channel: UpdateChannel::Stable,
        }
    }
}

/// A startup check and a manual request must never run together: two download
/// dialogs or two installers at once would race over the same files.
static CHECK_ACTIVE: AtomicBool = AtomicBool::new(false);

struct CheckGuard;

impl Drop for CheckGuard {
    fn drop(&mut self) {
        CHECK_ACTIVE.store(false, Ordering::SeqCst);
    }
}

fn begin_check() -> Option<CheckGuard> {
    if CHECK_ACTIVE
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        Some(CheckGuard)
    } else {
        None
    }
}

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

/// Reads the preference pair without letting a bad channel reset a valid
/// `autoCheck: false`. The channel is deliberately parsed from the raw value:
/// an unknown or non-string channel falls back to stable, while the existing
/// auto-check contract (malformed autoCheck is unknown) is preserved.
fn parse_update_preferences(contents: &str) -> Option<UpdatePreferences> {
    let auto_check = parse_auto_check(contents)?;
    let parsed: serde_json::Value = serde_json::from_str(contents).ok()?;
    let channel = parsed
        .get("channel")
        .and_then(serde_json::Value::as_str)
        .map(|value| UpdateChannel::parse(Some(value)))
        .unwrap_or(UpdateChannel::Stable);

    Some(UpdatePreferences {
        auto_check,
        channel,
    })
}

fn read_update_preferences(logger: &Arc<Logger>) -> UpdatePreferences {
    read_update_preferences_at(&app_data_root().join("config").join("updates.json"), logger)
}

/// Missing settings keep the old behaviour (automatic checks on stable); only
/// an explicit `{"autoCheck": false}` disables the startup check.
fn read_update_preferences_at(path: &Path, logger: &Arc<Logger>) -> UpdatePreferences {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => return UpdatePreferences::default(),
        Err(error) => {
            logger.warn(&format!(
                "Could not read {}: {error}. Update checks stay enabled on stable.",
                path.display()
            ));
            return UpdatePreferences::default();
        }
    };

    match parse_update_preferences(&contents) {
        Some(preferences) => preferences,
        None => {
            logger.warn(&format!(
                "{} is not valid update settings. Update checks stay enabled on stable.",
                path.display()
            ));
            UpdatePreferences::default()
        }
    }
}

/// The Next server writes this file when the user asks for a check now.
#[derive(Debug, Deserialize)]
struct UpdateRequest {
    id: String,
}

fn parse_request_id(contents: &str) -> Option<String> {
    let request = serde_json::from_str::<UpdateRequest>(contents).ok()?;
    let id = request.id.trim();
    if id.is_empty() || id.len() > 128 {
        return None;
    }
    Some(id.to_string())
}

/// Serialized to `%LOCALAPPDATA%\RoleSpecData\config\update-status.json` (or the
/// macOS equivalent) and polled by Settings → Preferences.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus<'a> {
    id: &'a str,
    state: &'a str,
    current_version: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
    checked_at: String,
}

#[derive(Debug, Clone)]
struct StatusReporter {
    path: PathBuf,
    id: String,
}

impl StatusReporter {
    fn new(root: &Path, id: String) -> Self {
        Self {
            path: root.join("config").join(UPDATE_STATUS_FILE),
            id,
        }
    }

    fn report(
        &self,
        state: &str,
        version: Option<&str>,
        progress: Option<u8>,
        message: Option<&str>,
    ) {
        let status = UpdateStatus {
            id: &self.id,
            state,
            current_version: env!("CARGO_PKG_VERSION"),
            version,
            progress,
            message,
            checked_at: now_rfc3339(),
        };
        if let Err(error) = write_status(&self.path, &status) {
            eprintln!(
                "could not write the update status to {}: {error}",
                self.path.display()
            );
        }
    }
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown-time".to_string())
}

/// Readers poll this file while a download is running, so never leave a
/// half-written JSON document behind. Rename replaces the previous status.
fn write_status(path: &Path, status: &UpdateStatus<'_>) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut body = serde_json::to_vec(status).map_err(std::io::Error::other)?;
    body.push(b'\n');

    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, body)?;
    fs::rename(temp, path)
}

/// The updater extracts the downloaded setup into a kept directory under the
/// temp directory. Nothing removes that directory, so every update would strand
/// a full installer copy. Clear the previous ones at startup; the copy in use
/// by a running installer simply fails to delete and is retried next launch.
pub fn clean_stale_update_installers(logger: &Logger) {
    clean_stale_update_installers_in(&std::env::temp_dir(), logger);
}

fn clean_stale_update_installers_in(directory: &Path, logger: &Logger) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return,
        Err(error) => {
            logger.warn(&format!(
                "Could not inspect {} for stale update installers: {error}",
                directory.display()
            ));
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let name = name.to_ascii_lowercase();
        if !name.starts_with("rolespec-") || !name.contains("-updater-") || !path.is_dir() {
            continue;
        }

        match fs::remove_dir_all(&path) {
            Ok(()) => logger.info(&format!(
                "Removed the previous update installer at {}",
                path.display()
            )),
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => logger.warn(&format!(
                "Could not remove the previous update installer at {}: {error}",
                path.display()
            )),
        }
    }
}

/// Checks once, shortly after startup, on a background thread.
pub fn spawn_startup_check(handle: AppHandle, logger: Arc<Logger>) {
    let preferences = read_update_preferences(&logger);
    if !preferences.auto_check {
        logger.info("Automatic update checks are disabled in Settings → Preferences");
        return;
    }
    let channel = preferences.channel;

    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_DELAY);
        let Some(_guard) = begin_check() else {
            logger.info("Skipping the automatic update check: another check is already running");
            return;
        };
        if let Err(message) = check_and_install(&handle, &logger, None, channel) {
            logger.warn(&format!("Update check failed: {message}"));
        }
    });
}

/// Polls for a manual check requested by Settings → Preferences.
///
/// The page cannot call Tauri commands directly: it is served from the local
/// Next process, not from Tauri's own asset protocol. A request/status file
/// pair keeps that boundary without opening remote IPC.
pub fn spawn_update_request_watcher(handle: AppHandle, logger: Arc<Logger>) {
    std::thread::spawn(move || {
        let root = app_data_root();
        let mut handled: Option<String> = None;

        loop {
            std::thread::sleep(REQUEST_WATCH_INTERVAL);

            let Some(id) = take_request(&root, &logger) else {
                continue;
            };
            // If deleting the request failed, do not run the same check every
            // second; a new click always carries a fresh UUID.
            if handled.as_deref() == Some(id.as_str()) {
                continue;
            }
            handled = Some(id.clone());

            let preferences = read_update_preferences(&logger);
            logger.info(&format!(
                "Manual update check requested ({id}) on the {} channel",
                preferences.channel.as_str()
            ));
            let reporter = StatusReporter::new(&root, id.clone());

            let Some(_guard) = begin_check() else {
                reporter.report("busy", None, None, Some("A check is already running."));
                continue;
            };

            if let Err(message) =
                check_and_install(&handle, &logger, Some(&reporter), preferences.channel)
            {
                logger.warn(&format!("Update check failed: {message}"));
            }
        }
    });
}

fn take_request(root: &Path, logger: &Logger) -> Option<String> {
    let path = root.join("config").join(UPDATE_REQUEST_FILE);
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => return None,
        Err(error) => {
            logger.warn(&format!(
                "Could not read the update request at {}: {error}",
                path.display()
            ));
            return None;
        }
    };

    // Consume it before acting so a restart cannot replay the same request.
    let _ = fs::remove_file(&path);

    match parse_request_id(&contents) {
        Some(id) => Some(id),
        None => {
            logger.warn(&format!(
                "Ignoring a malformed update request in {}",
                path.display()
            ));
            None
        }
    }
}

fn updater_for_channel(
    handle: &AppHandle,
    channel: UpdateChannel,
) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoint = tauri::Url::parse(channel.endpoint()).map_err(|error| {
        format!(
            "the {} update endpoint is invalid: {error}",
            channel.as_str()
        )
    })?;

    handle
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| {
            format!(
                "the {} update endpoint is not allowed: {error}",
                channel.as_str()
            )
        })?
        .build()
        .map_err(|error| format!("the updater could not be configured: {error}"))
}

fn check_and_install(
    handle: &AppHandle,
    logger: &Arc<Logger>,
    reporter: Option<&StatusReporter>,
    channel: UpdateChannel,
) -> Result<(), String> {
    if let Some(reporter) = reporter {
        reporter.report("checking", None, None, None);
    }

    logger.info(&format!("Checking the {} update channel", channel.as_str()));
    let updater = match updater_for_channel(handle, channel) {
        Ok(updater) => updater,
        Err(message) => {
            logger.warn(&format!("Update channel unavailable: {message}"));
            if let Some(reporter) = reporter {
                reporter.report("unavailable", None, None, Some(&message));
            }
            return Ok(());
        }
    };

    let update = match tauri::async_runtime::block_on(updater.check()) {
        Ok(update) => update,
        Err(error) => {
            let message = format!("the update endpoint could not be reached: {error}");
            if let Some(reporter) = reporter {
                reporter.report("error", None, None, Some(&message));
            }
            return Err(message);
        }
    };

    let Some(update) = update else {
        logger.info("RoleSpec is up to date");
        if let Some(reporter) = reporter {
            reporter.report("upToDate", None, None, None);
        }
        return Ok(());
    };

    let version = update.version.to_string();
    logger.info(&format!(
        "RoleSpec {version} is available (installed: {})",
        update.current_version
    ));

    let mut description = format!(
        "RoleSpec {version} is available. You have {}.",
        update.current_version
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

    if let Some(reporter) = reporter {
        reporter.report("available", Some(&version), None, None);
    }

    let accepted = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Info)
        .set_title("RoleSpec update available")
        .set_description(description)
        .set_buttons(rfd::MessageButtons::YesNo)
        .show()
        == rfd::MessageDialogResult::Yes;
    if !accepted {
        logger.info("The update was postponed");
        if let Some(reporter) = reporter {
            reporter.report("declined", Some(&version), None, Some("Update postponed."));
        }
        return Ok(());
    }

    // Download while the app is still fully usable. `download` verifies the
    // signature, so a bad artifact never reaches the install step.
    logger.info(&format!("Downloading RoleSpec {version}"));
    if let Some(reporter) = reporter {
        reporter.report("downloading", Some(&version), Some(0), None);
    }

    let progress_reporter = reporter.cloned();
    let progress_version = version.clone();
    let mut downloaded: u64 = 0;
    let mut last_progress: Option<u8> = None;

    let download = tauri::async_runtime::block_on(update.download(
        move |chunk: usize, total: Option<u64>| {
            downloaded += chunk as u64;
            if let (Some(total), Some(reporter)) = (total, progress_reporter.as_ref()) {
                if total > 0 {
                    let percent = (downloaded.saturating_mul(100) / total).min(100) as u8;
                    if last_progress != Some(percent) {
                        last_progress = Some(percent);
                        reporter.report(
                            "downloading",
                            Some(&progress_version),
                            Some(percent),
                            None,
                        );
                    }
                }
            }
        },
        || {},
    ));

    let bytes = match download {
        Ok(bytes) => bytes,
        Err(error) => {
            let message = format!("the update could not be downloaded: {error}");
            if let Some(reporter) = reporter {
                reporter.report("error", Some(&version), None, Some(&message));
            }
            return Err(message);
        }
    };

    // `install` hands the installer to Windows and exits this process, so the
    // server, the cluster and the log handles are stopped here: the NSIS
    // installer cannot replace files that are still in use.
    logger.info("Stopping RoleSpec before installing the update");
    if let Some(reporter) = reporter {
        reporter.report("installing", Some(&version), None, None);
    }
    crate::stop_runtime(handle);

    logger.info("Installing the update");
    if let Err(error) = update.install(bytes) {
        let message = format!("the update could not be installed: {error}");
        if let Some(reporter) = reporter {
            reporter.report("error", Some(&version), None, Some(&message));
        }
        return Err(message);
    }

    // Windows only returns here when the installer could not be launched.
    let message = "the installer did not start".to_string();
    if let Some(reporter) = reporter {
        reporter.report("error", Some(&version), None, Some(&message));
    }
    Err(message)
}

#[cfg(test)]
mod tests {
    use super::{
        clean_stale_update_installers_in, parse_auto_check, parse_request_id,
        parse_update_preferences, read_update_preferences_at, write_status, UpdateChannel,
        UpdateStatus,
    };
    use crate::logging::Logger;
    use std::fs;
    use std::sync::Arc;

    fn test_logger(name: &str) -> Arc<Logger> {
        let path =
            std::env::temp_dir().join(format!("rolespec-update-{name}-{}.log", std::process::id()));
        Arc::new(Logger::open(path).expect("open test logger"))
    }

    #[test]
    fn stale_update_installers_are_removed() {
        let root = std::env::temp_dir().join(format!(
            "rolespec-update-cleanup-test-{}",
            std::process::id()
        ));
        let stale = root.join("RoleSpec-9.9.9-updater-AbCdEf");
        let keep = root.join("keep-me");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&stale).expect("create stale installer directory");
        fs::create_dir_all(&keep).expect("create unrelated directory");
        fs::write(stale.join("setup.exe"), b"stale").expect("write stale installer");

        clean_stale_update_installers_in(&root, &test_logger("cleanup"));

        assert!(!stale.exists(), "the stale installer directory is removed");
        assert!(keep.exists(), "unrelated temp directories are untouched");
        fs::remove_dir_all(&root).expect("clean up cleanup test root");
    }

    #[test]
    fn missing_settings_file_keeps_checks_enabled() {
        let path = std::env::temp_dir().join(format!(
            "rolespec-update-missing-{}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        assert!(read_update_preferences_at(&path, &test_logger("missing")).auto_check);
    }

    #[test]
    fn saved_false_disables_checks() {
        let path =
            std::env::temp_dir().join(format!("rolespec-update-false-{}.json", std::process::id()));
        fs::write(&path, r#"{"autoCheck":false}"#).expect("write settings");

        assert!(!read_update_preferences_at(&path, &test_logger("false")).auto_check);
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

    #[test]
    fn channel_defaults_to_stable_and_accepts_beta() {
        assert_eq!(
            parse_update_preferences("{}").unwrap().channel,
            UpdateChannel::Stable
        );
        assert_eq!(
            parse_update_preferences(r#"{"channel":"beta"}"#)
                .unwrap()
                .channel,
            UpdateChannel::Beta
        );
        assert_eq!(
            parse_update_preferences(r#"{"channel":"nightly"}"#)
                .unwrap()
                .channel,
            UpdateChannel::Stable
        );
        assert_eq!(
            parse_update_preferences(r#"{"channel":42}"#)
                .unwrap()
                .channel,
            UpdateChannel::Stable
        );
    }

    #[test]
    fn invalid_channel_keeps_saved_auto_check_false() {
        let preferences =
            parse_update_preferences(r#"{"autoCheck":false,"channel":"nightly"}"#).unwrap();

        assert!(!preferences.auto_check);
        assert_eq!(preferences.channel, UpdateChannel::Stable);
    }

    #[test]
    fn channels_use_distinct_manifest_endpoints() {
        assert_ne!(
            UpdateChannel::Stable.endpoint(),
            UpdateChannel::Beta.endpoint()
        );
        assert!(UpdateChannel::Stable.endpoint().ends_with("/latest.json"));
        assert!(UpdateChannel::Beta
            .endpoint()
            .ends_with("/beta/latest-beta.json"));
    }

    #[test]
    fn parses_a_valid_request_id() {
        assert_eq!(
            parse_request_id(r#"{"id":"abc-123"}"#),
            Some("abc-123".to_string())
        );
        assert_eq!(
            parse_request_id(r#"{"id":"  abc  "}"#),
            Some("abc".to_string())
        );
    }

    #[test]
    fn rejects_malformed_request_ids() {
        assert_eq!(parse_request_id("not json"), None);
        assert_eq!(parse_request_id("{}"), None);
        assert_eq!(parse_request_id(r#"{"id":""}"#), None);
        assert_eq!(parse_request_id(r#"{"id":42}"#), None);

        let long = "a".repeat(129);
        assert_eq!(parse_request_id(&format!(r#"{{"id":"{long}"}}"#)), None);
    }

    fn status<'a>(
        state: &'a str,
        version: Option<&'a str>,
        progress: Option<u8>,
        message: Option<&'a str>,
    ) -> UpdateStatus<'a> {
        UpdateStatus {
            id: "request-1",
            state,
            current_version: "2.1.0",
            version,
            progress,
            message,
            checked_at: "2026-11-26T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn status_json_uses_camel_case_and_omits_unknown_fields() {
        let serialized =
            serde_json::to_string(&status("upToDate", None, None, None)).expect("serialize status");
        let json: serde_json::Value = serde_json::from_str(&serialized).expect("parse status");

        assert_eq!(json["id"], "request-1");
        assert_eq!(json["state"], "upToDate");
        assert_eq!(json["currentVersion"], "2.1.0");
        assert_eq!(json["checkedAt"], "2026-11-26T00:00:00Z");
        assert!(json.get("version").is_none());
        assert!(json.get("progress").is_none());
        assert!(json.get("message").is_none());
    }

    #[test]
    fn status_json_reports_download_progress() {
        let serialized =
            serde_json::to_string(&status("downloading", Some("2.1.1"), Some(42), None))
                .expect("serialize status");
        let json: serde_json::Value = serde_json::from_str(&serialized).expect("parse status");

        assert_eq!(json["state"], "downloading");
        assert_eq!(json["version"], "2.1.1");
        assert_eq!(json["progress"], 42);
    }

    #[test]
    fn status_file_is_replaced() {
        let root = std::env::temp_dir().join(format!(
            "rolespec-update-status-replace-{}",
            std::process::id()
        ));
        let path = root.join("config").join("update-status.json");
        let _ = fs::remove_dir_all(&root);

        write_status(&path, &status("checking", None, None, None)).expect("write checking");
        write_status(&path, &status("upToDate", None, None, None)).expect("replace status");

        let contents = fs::read_to_string(&path).expect("read status");
        assert!(contents.contains(r#""state":"upToDate""#));
        assert!(!contents.contains(r#""state":"checking""#));
        assert_eq!(
            fs::read_dir(path.parent().expect("status parent"))
                .expect("list status directory")
                .count(),
            1,
            "the temporary file must be renamed away"
        );

        fs::remove_dir_all(&root).expect("clean up status directory");
    }
}
