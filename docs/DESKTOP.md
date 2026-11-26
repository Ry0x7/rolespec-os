# Windows desktop guide

RoleSpec OS is published by **Chryypt Inc** and available from
[GitHub Releases](https://github.com/Ry0x7/rolespec-os/releases/latest). It supports Windows
10/11 x64 with WebView2. The installer bundles Node.js and PostgreSQL; users do not need to install
those separately.

The installer is not Authenticode-signed. Its uninstall entry names Chryypt Inc as the publisher,
but Windows has **no verified publisher** and SmartScreen may warn. A release without
`latest.json` cannot auto-update, so download newer installers manually. Updater signatures
(`.sig`) are separate from Windows Authenticode and do not establish a verified Windows
publisher. Installation, first launch, onboarding and uninstall were exercised on Windows 11
x64 for earlier builds; a clean v2.0.0 install or in-place upgrade has not been verified, and a
separate clean-VM walkthrough has not been run.

v2.0.0 adds the today-first dashboard, a configurable daily application goal, explainable
ranking with colour-coded factor badges, a phone-first pipeline board and the RoleSpec OS
Personal Use License. The installer remains unsigned and is built by the tag workflow. Check the
release assets for `latest.json` before relying on automatic updates.

The installer keeps the same application identifier and `%LOCALAPPDATA%\RoleSpecData` location as
earlier releases, so an upgrade preserves the workspace; back up that directory before upgrading.
Older 1.x installers predate the signed updater metadata, so those copies must be replaced
manually. Release-by-release details are in [release notes](releases/).

The bundled application's version metadata names **Chryypt Inc** as CompanyName, the NSIS hook in
`desktop/src-tauri/installer-hooks.nsh` adds the same CompanyName to the setup wrapper, and the
uninstall entry records Chryypt Inc as the publisher. The Tauri `productName` (`RoleSpec`), executable name, install directory and
application identifier (`com.rolespec.desktop`) are deliberately unchanged from earlier builds so
upgrades keep the same install identity and existing career data; Windows therefore shows
`RoleSpec` as the application name while the publisher is Chryypt Inc. `%LOCALAPPDATA%\RoleSpecData` is
user data, not an installer path; do not rename it when rebranding.

v1.0.3 includes resume text import without AI: recognized headings become matching resume sections
with their wording preserved. Editing and application tracking work without AI. AI structuring,
polishing, analysis and generation require a configured provider. CLI and local-model providers
need their own installation; they are not bundled with RoleSpec OS.

For normal installation, download the setup executable, open it, and complete onboarding.
The remainder of this guide is for building, operating and releasing the desktop runtime.

## Build and run from source

This is the runtime bundled by the Windows installer. It runs the same standalone server against a
private PostgreSQL 17 cluster, so no Docker, no user-installed PostgreSQL and no `.env` file is
needed once staged. Windows x64 is the released platform; macOS builds are experimental and
CI-only (see [macOS](#macos-experimental-ci-only)). Tag builds produce unsigned installers and
publish them directly; no signing step is required.

**Prerequisites**
- **Windows 10/11 x64** with WebView2 (present on Windows 11 and updated Windows 10)
- **Node.js 22+**, **Rust** (stable) and the Tauri Windows prerequisites

**Steps**

1. Install dependencies and fetch the pinned runtimes:
   ```bash
   npm install
   npm run desktop:postgres   # one-time: pinned PostgreSQL 17 binaries (~250 MB)
   ```

2. Build and stage the desktop bundle (standalone server, Node, Prisma CLI, migrations):
   ```bash
   npm run desktop:build
   ```

3. Launch the shell:
   ```bash
   npm run desktop:run
   ```

On first launch the shell creates `%LOCALAPPDATA%\RoleSpecData`, initializes the cluster, applies the
normal Prisma migrations and opens the app at `/onboarding`. Later launches reuse that cluster and
the same secrets file, so updates do not lose data or invalidate stored AI keys. It is deliberately a
*separate* directory from the per-user install location (`%LOCALAPPDATA%\RoleSpec`), so uninstalling
the app does not delete your data; remove `RoleSpecData` yourself to erase it.

| Location | Contents |
| :--- | :--- |
| `%LOCALAPPDATA%\RoleSpecData\data\pg` | private PostgreSQL cluster |
| `%LOCALAPPDATA%\RoleSpecData\data\exports` | generated PDFs and exports |
| `%LOCALAPPDATA%\RoleSpecData\config\secrets.json` | stable `AUTH_SECRET` / `ENCRYPTION_KEY` |
| `%LOCALAPPDATA%\RoleSpecData\logs` | shell, server and PostgreSQL logs |

To point the shell at an existing database instead, set `DATABASE_URL` and `AUTH_SECRET` (plus
`ENCRYPTION_KEY` if you use one) before launching. `ROLESPEC_MANAGED_DB=0` forces that mode.

Shell checks: `npm run desktop:check`, `npm run desktop:test`.

The app icon, installer icon and installer wizard images (`icons/`) come from the supplied
RoleSpec OS brand kit. `public/brand/` carries the primary mark plus the ink, ice, mono and
on-dark colourways, and the official light/dark wordmarks; the primary mark is also
`desktop/src-tauri/icons/icon.svg`. The in-app mark is
`src/features/marketing/components/logo-mark.tsx`; its `variant` prop selects `brand`, `ink`,
`ice`, `on-dark` or `mono`. `scripts/desktop/generate-icons.mjs` composes the installer lockups
and renders the whole set through the playwright DevDependency. Regenerate after a design
change with `npm run desktop:icons`; it rewrites `icon.svg`, `icon.png`, `icon.ico`,
`icon.icns`, `header.bmp` and `sidebar.bmp` in place.

To produce the (unsigned) NSIS installer locally, after `npm run desktop:build`:

```bash
cd desktop/src-tauri
npx @tauri-apps/cli@^2 build --bundles nsis
```

The result is `desktop/src-tauri/target/release/bundle/nsis/RoleSpec_<version>_x64-setup.exe`.
The file name and install directory keep the `RoleSpec` identity used by earlier releases; the
window title and documentation say RoleSpec OS, and the bundled executable records Chryypt Inc as its
CompanyName. `desktop/src-tauri/installer-hooks.nsh` adds the CompanyName key the stock Tauri
template omits, removes the runtime `resources` tree on uninstall, and removes the
now-empty install root; the uninstall entry names Chryypt Inc. A local build is
**unsigned**, so Windows SmartScreen will warn about it and the publisher is not
verified.

**Windows trust and SmartScreen**

Windows decides whether to trust an installer from its Authenticode signature, not from the
CompanyName, ProductName or Publisher fields. This repository does not configure Authenticode
signing: tag builds publish the installer as-is and no Authenticode credentials are read. Windows
therefore treats the download as an unknown publisher; SmartScreen may show "Windows protected
your PC", and Smart App Control may block it outright.

The metadata is still complete and useful: Explorer and the uninstall entry name Chryypt Inc. But
metadata cannot create a verified publisher. Removing the warning requires an Authenticode
certificate from a publicly trusted CA and reputation for that identity (EV certificates no
longer bypass SmartScreen). Obtaining and configuring one is a separate decision; Microsoft's
"Report a file as safe" submission can correct a false positive, but it does not sign the binary.

**Updates and the downgrade guard**

An installed copy checks for a newer signed version about ten seconds after it starts
([update.rs](../desktop/src-tauri/src/update.rs)), verifies the artifact against the updater public
key compiled into `tauri.conf.json`, then stops the local server and database before the installer
replaces files and relaunches the app. The passive installer shows progress while it copies the
runtime, starts the new build when it finishes, and exits on its own; the shell removes the
previous update's extracted setup from the temp directory on its next launch. The stable channel reads
`releases/latest/download/latest.json`; the beta channel reads the rolling `beta` release at
`releases/download/beta/latest-beta.json`. Both manifests are signed by the same updater key, so
switching channel does not weaken verification. The matching private key is the repository secret
`TAURI_SIGNING_PRIVATE_KEY`; without it CI produces no updater artifacts and attaches no manifest.
**Back that key up**: losing it means installed copies can never be updated and every user has to
install a new build by hand.

Automatic checks and the release channel are in **Settings → Preferences → Desktop updates**.
Choices are stored in `%LOCALAPPDATA%\RoleSpecData\config\updates.json` as
`{"autoCheck": false, "channel": "beta"}` and read at startup, so automatic checks use them on the
next launch; **Check for updates** re-reads the channel and applies it immediately. The beta channel
also accepts a newer stable release. Switching back to stable does not downgrade an installed beta
build; it stops offering prereleases until a newer stable exists. **Check for updates** shows
checking, download progress and the up-to-date result inline. Manual installs still work by
downloading a newer signed setup file.

Release by bumping `version` in `package.json` (and the lockfile), `desktop/src-tauri/Cargo.toml`
(which feeds the Windows executable) and `desktop/src-tauri/tauri.conf.json`, then pushing a matching
`v*` tag. A stable tag (`v2.1.0`) publishes `latest.json`; a prerelease tag such as
`v2.2.0-beta.1` publishes as a GitHub prerelease and writes `latest-beta.json`. Both update the
rolling `beta` release, and a stable release also points the beta channel at itself so beta users can
move to the newer stable. When `TAURI_SIGNING_PRIVATE_KEY` is configured, the workflow writes the
updater `.sig` and channel manifest around the built bytes. No Authenticode signature is applied, so
those updater signatures do not make Windows trust the download.

The shell also refuses to open data a newer build created: it compares the migrations recorded in
`_prisma_migrations` against the migrations it ships and exits with an explanation when the database
is ahead. A downgrade therefore fails loudly instead of running old code against a newer schema.

To exercise an update without publishing anything, build two installers with a `--config` overlay
that points the endpoint at a local server (`dangerousInsecureTransportProtocol` is required for
`http://`), serve the newer installer plus a `latest.json` (or `latest-beta.json` for the beta
channel) that carries its `.sig`, install the older build, and accept the prompt. Both builds must
be signed with the same key as the `pubkey` in `tauri.conf.json`, or the download is rejected before
anything is installed.

**If desktop startup fails**

- The error dialog names the failing step and the log file. Logs are in
  `%LOCALAPPDATA%\RoleSpecData\logs` (`desktop.log` covers the shell and server,
  `postgres.log` covers the database).
- Port 3100 in use is not fatal: the shell falls back to a free loopback port. Absolute links
  generated with the built `NEXT_PUBLIC_APP_URL` may still point at 3100 in that case.
- `DATABASE_URL` in the environment switches to an external database and requires `AUTH_SECRET`.
  Unset it (or set `ROLESPEC_MANAGED_DB=1`) to use the managed local cluster.
- To start over, close RoleSpec and move `%LOCALAPPDATA%\RoleSpecData` aside. That discards the
  database, exports and the encryption keys for any stored AI credentials; there is no undo.

## macOS (experimental, CI only)

The `Desktop` workflow also builds a macOS app bundle and DMG on a `macos-15` arm64 runner and
smoke-tests the built disk image with `scripts/desktop/smoke-dmg.sh`. The script mounts the DMG
read-only, copies `RoleSpec.app` to `~/Applications`, checks `CFBundleShortVersionString`, launches
the app against its managed database, polls `/api/health` and `/onboarding`, quits it, then removes
the bundle and confirms `~/.local/share/RoleSpecData` survives — the macOS equivalent of the
Windows install/uninstall test.

**This build is not released.** Without an Apple Developer ID the bundle is unsigned, so
Gatekeeper blocks a downloaded copy, and the updater manifest has no `darwin` entry, so it could
not self-update either. The workflow therefore uploads the DMG as the `rolespec-macos-arm64`
artifact only. Publishing macOS builds needs Developer ID signing, notarization and a darwin
updater entry; none of that is configured.

To build it locally on macOS:

```bash
npm ci
npm run desktop:postgres   # universal macOS PostgreSQL 17 (~1.4 GB extracted)
npm run desktop:build
cd desktop/src-tauri
npx @tauri-apps/cli@^2 build --bundles app,dmg
bash ../../scripts/desktop/smoke-dmg.sh "$(ls target/release/bundle/dmg/*.dmg | head -n 1)"
```

`desktop/src-tauri/tauri.macos.conf.json` switches the bundle targets to `app` and `dmg`, uses
`icon.icns` and sets a macOS 12 minimum; the Windows config is untouched. The macOS data root is
`~/.local/share/RoleSpecData`.

Known gap: crash containment is Windows-only. The shell's kill-on-close job object has no Unix
counterpart, so a force-quit on macOS can leave the bundled server and PostgreSQL running; quit
the app normally. The CI smoke test cleans up any such process itself.

---
