#!/usr/bin/env bash
# Installs the macOS app from the built disk image, launches it, checks the
# packaged server, then removes it. macOS counterpart to smoke-installer.ps1.
#
# The DMG is mounted read-only; the app is copied to ~/Applications so it runs
# outside the image, exactly like a user install. HOME is not redirected
# because WKWebView needs the real user session, so the runner's clean profile
# is the isolation boundary. The app is unsigned (no Developer ID), which is
# fine here: a locally built bundle has no quarantine attribute. Gatekeeper
# would block the same download on a user's machine.
#
# Usage: scripts/desktop/smoke-dmg.sh <path/to/RoleSpec.dmg>
set -euo pipefail

dmg_path=${1:?usage: smoke-dmg.sh <path/to/RoleSpec.dmg>}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
expected_version=$(node -p "require('${repo_root}/desktop/src-tauri/tauri.conf.json').version")
dmg=$(cd "$(dirname "$dmg_path")" && pwd)/$(basename "$dmg_path")
[[ -f "$dmg" ]] || { echo "::error::DMG not found: $dmg" >&2; exit 1; }

workdir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/rolespec-dmg.XXXXXX")
mount_point="$workdir/mnt"
mkdir -p "$mount_point"
install_dir="$HOME/Applications/RoleSpec.app"
data_root="$HOME/.local/share/RoleSpecData"
app_pid=""

fail() {
  echo "::error::$*" >&2
  exit 1
}

cleanup() {
  status=$?
  set +e
  if ((status != 0)); then
    echo "--- desktop.log (tail) ---"
    tail -n 60 "$data_root/logs/desktop.log" 2>/dev/null
    echo "--- postgres.log (tail) ---"
    tail -n 40 "$data_root/logs/postgres.log" 2>/dev/null
    echo "--- app output ---"
    tail -n 40 "$workdir/app.log" 2>/dev/null
  fi
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null
    sleep 2
    kill -9 "$app_pid" 2>/dev/null
  fi
  # The server and PostgreSQL run from inside the bundle; never leave them
  # holding port 3100 or the install directory.
  pkill -f "$install_dir/Contents/" 2>/dev/null
  if mount | grep -q "on $mount_point "; then
    hdiutil detach "$mount_point" -quiet -force 2>/dev/null
  fi
  rm -rf "$workdir" "$install_dir" "$data_root"
  exit "$status"
}
trap cleanup EXIT

echo "DMG: $dmg"
echo "Expected version: $expected_version"

[[ -e "$install_dir" ]] && fail "RoleSpec is already installed at $install_dir; this test expects a clean runner."
[[ -e "$data_root" ]] && fail "RoleSpec data already exists at $data_root; this test expects a clean runner."

hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount_point" >/dev/null
app_source=$(find "$mount_point" -maxdepth 1 -name '*.app' -print -quit)
[[ -n "$app_source" ]] || fail "No .app bundle inside the disk image."

mkdir -p "$(dirname "$install_dir")"
ditto "$app_source" "$install_dir"

app_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$install_dir/Contents/Info.plist")
[[ "$app_version" == "$expected_version" ]] || fail "Bundle version $app_version does not match tauri.conf.json $expected_version."
echo "Installed bundle version: $app_version"

binary="$install_dir/Contents/MacOS/rolespec-desktop"
[[ -x "$binary" ]] || fail "Installed executable not found at $binary."
echo "Executable: $(file -b "$binary")"

# The workflow exports build-only DATABASE_URL/AUTH_SECRET values. A desktop
# launch must use its managed database, so drop DATABASE_URL for the child and
# force managed mode, matching the Windows smoke test.
(
  unset DATABASE_URL
  export ROLESPEC_MANAGED_DB=1
  exec "$binary"
) >"$workdir/app.log" 2>&1 &
app_pid=$!

base_url='http://127.0.0.1:3100'
deadline=$((SECONDS + 180))
healthy=""
while ((SECONDS < deadline)); do
  kill -0 "$app_pid" 2>/dev/null || fail "RoleSpec exited before becoming healthy (see log tail below)."
  if health=$(curl -fsS --max-time 3 "$base_url/api/health" 2>/dev/null); then
    if grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<<"$health"; then
      healthy=$health
      break
    fi
  fi
  sleep 2
done
[[ -n "$healthy" ]] || fail "RoleSpec did not answer /api/health within 180 seconds."
echo "Health check: 200 (status ok)"

onboarding=$(curl -fsS --max-time 20 "$base_url/onboarding") || fail "Onboarding did not return HTTP 200."
grep -q 'Get started' <<<"$onboarding" || fail "Onboarding page did not contain the expected start action."
echo "Onboarding check: 200 (start action present)"

kill -0 "$app_pid" 2>/dev/null || fail "RoleSpec exited during the smoke test."

# Quit through LaunchServices so the shell runs its shutdown path (server and
# PostgreSQL stopped). Fall back to a signal only if that does not finish.
osascript -e 'tell application "RoleSpec" to quit' >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  kill -0 "$app_pid" 2>/dev/null || break
  sleep 1
done
if kill -0 "$app_pid" 2>/dev/null; then
  kill "$app_pid" 2>/dev/null || true
  sleep 5
  kill -9 "$app_pid" 2>/dev/null || true
fi
wait "$app_pid" 2>/dev/null || true
app_pid=""

# A signalled shell never runs its shutdown path, so stop anything still
# running from the bundle (node, postgres). On the normal quit this is a no-op.
pkill -f "$install_dir/Contents/" 2>/dev/null || true

for _ in $(seq 1 30); do
  curl -fsS --max-time 1 "$base_url/api/health" >/dev/null 2>&1 || break
  sleep 1
done
curl -fsS --max-time 1 "$base_url/api/health" >/dev/null 2>&1 && fail "The server still answers after quitting."

# Uninstall = drag to Trash. The app bundle goes; user data stays.
rm -rf "$install_dir"
[[ -e "$install_dir" ]] && fail "The app bundle still exists after uninstall: $install_dir"
[[ -d "$data_root" ]] || fail "Uninstall removed the separate RoleSpecData directory."
echo "Uninstall check: app bundle removed; data root preserved."

echo "macOS smoke test passed."
