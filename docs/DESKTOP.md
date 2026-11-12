# Windows desktop guide

RoleSpec OS is published by **Chryypt** and available from
[GitHub Releases](https://github.com/Ry0x7/rolespec-os/releases/latest). It supports Windows
10/11 x64 with WebView2. The installer bundles Node.js and PostgreSQL; users do not need to install
those separately.

The installer is not Authenticode-signed. Its uninstall entry names Chryypt as the publisher,
but Windows has **no verified publisher** and SmartScreen may warn. A release without
`latest.json` cannot auto-update, so download newer installers manually. Updater signatures
(`.sig`) are separate from Windows Authenticode and do not establish a verified Windows
publisher. Installation, first launch, onboarding and uninstall were exercised on Windows 11
x64; a separate clean-VM walkthrough has not been run.

v2.0.0 includes the integrated manual and agent-assisted workspace, human review, candidate
evidence, resume comparison and validation, application tracking, and tabbed layouts for shorter
pages. The live-browser audit, fixes and remaining limitations are recorded in
[FRONTEND_QA.md](FRONTEND_QA.md). This release preserves the existing application identifier and
`%LOCALAPPDATA%\RoleSpecData` location. A native v2.0.0 install/upgrade has not been verified;
the web QA evidence is not a desktop upgrade certification. Check the release assets for
`latest.json` before relying on automatic updates.

v1.0.5 ships the evidence-backed company research, pipeline and matching changes plus the safer
ATS autofill flow. The installer remains unsigned and still has no latest.json, so an installed
v1.0.4 copy cannot self-update to it; install v1.0.5 over the existing copy and keep the same
`%LOCALAPPDATA%\RoleSpecData` directory. A fresh v1.0.4 install, in-place v1.0.5 upgrade, restart,
data retention and uninstall were exercised on Windows 11 x64. A separate clean-VM walkthrough has
not been run.

v1.0.4 rebuilt the installer: 1.0.3 shipped without the shared Next.js server chunks and the
external-package aliases Turbopack keeps outside the standalone tree, so a fresh install served
HTTP 500 on first launch. Staging now copies both and fails the build when the server bundle is
incomplete or still contains a symlink.

The bundled application's version metadata names **Chryypt** as CompanyName, the NSIS hook in
`desktop/src-tauri/installer-hooks.nsh` adds the same CompanyName to the setup wrapper, and the
uninstall entry records Chryypt as the publisher. The Tauri `productName` (`RoleSpec`), executable name, install directory and
application identifier (`com.rolespec.desktop`) are deliberately unchanged from earlier builds so
upgrades keep the same install identity and existing career data; Windows therefore shows
`RoleSpec` as the application name while the publisher is Chryypt. `%LOCALAPPDATA%\RoleSpecData` is
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
needed once staged. It is Windows x64 only. Tag builds produce unsigned installers and publish
them directly; no signing step is required.

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

The app icon, installer icon and installer wizard images (`icons/`) are generated from
`scripts/desktop/generate-icons.mjs`. Regenerate them after changing the design with
`npm run desktop:icons`; it renders the SVG through the playwright DevDependency and rewrites
`icon.svg`, `icon.png`, `icon.ico`, `header.bmp` and `sidebar.bmp` in place.

To produce the (unsigned) NSIS installer locally, after `npm run desktop:build`:

```bash
cd desktop/src-tauri
npx @tauri-apps/cli@^2 build --bundles nsis
```

The result is `desktop/src-tauri/target/release/bundle/nsis/RoleSpec_<version>_x64-setup.exe`.
The file name and install directory keep the `RoleSpec` identity used by earlier releases; the
window title and documentation say RoleSpec OS, and the bundled executable records Chryypt as its
CompanyName. `desktop/src-tauri/installer-hooks.nsh` adds the CompanyName key the stock Tauri
template omits and removes the runtime `resources` tree on uninstall; the uninstall entry names
Chryypt. A local build is **unsigned**, so Windows SmartScreen will warn about it and the publisher
is not verified.

**Windows trust and SmartScreen**

Windows decides whether to trust an installer from its Authenticode signature, not from the
CompanyName, ProductName or Publisher fields. This repository does not configure Authenticode
signing: tag builds publish the installer as-is and no Authenticode credentials are read. Windows
therefore treats the download as an unknown publisher; SmartScreen may show "Windows protected
your PC", and Smart App Control may block it outright.

The metadata is still complete and useful: Explorer and the uninstall entry name Chryypt. But
metadata cannot create a verified publisher. Removing the warning requires an Authenticode
certificate from a publicly trusted CA and reputation for that identity (EV certificates no
longer bypass SmartScreen). Obtaining and configuring one is a separate decision; Microsoft's
"Report a file as safe" submission can correct a false positive, but it does not sign the binary.

**Updates and the downgrade guard**

An installed copy asks `releases/latest/download/latest.json` for a newer version about ten seconds
after it starts ([update.rs](../desktop/src-tauri/src/update.rs)), verifies the archive against the
updater public key compiled into `tauri.conf.json`, then stops the local server and database before
the installer replaces files and relaunches the app. The matching private key is the repository
secret `TAURI_SIGNING_PRIVATE_KEY`; without it CI produces no updater archive and attaches no
`latest.json`. **Back that key up**: losing it means installed copies can never be updated and every
user has to install a new build by hand.

Release by bumping `version` in `package.json` (and the lockfile), `desktop/src-tauri/Cargo.toml`
(which feeds the Windows executable) and `desktop/src-tauri/tauri.conf.json`, then pushing a matching
`v*` tag. The workflow builds the installer, publishes it with its SHA-256 checksum, and — when
`TAURI_SIGNING_PRIVATE_KEY` is configured — writes the updater `.sig` and `latest.json` around the
built bytes. No Authenticode signature is applied, so those updater signatures do not make
Windows trust the download.

The shell also refuses to open data a newer build created: it compares the migrations recorded in
`_prisma_migrations` against the migrations it ships and exits with an explanation when the database
is ahead. A downgrade therefore fails loudly instead of running old code against a newer schema.

To exercise an update without publishing anything, build two installers with a `--config` overlay
that points the endpoint at a local server (`dangerousInsecureTransportProtocol` is required for
`http://`), serve the newer installer plus a `latest.json` that carries its `.sig`, install the older
build, and accept the prompt. Both builds must be signed with the same key as the `pubkey` in
`tauri.conf.json`, or the download is rejected before anything is installed.

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

---
