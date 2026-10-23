# Windows desktop guide

RoleSpec v1.0.2 is available from [GitHub Releases](https://github.com/Ry0x7/rolespec-os/releases/tag/v1.0.2).
It supports Windows 10/11 x64 with WebView2. The installer bundles Node.js and PostgreSQL;
users do not need to install those separately.

The published v1.0.2 installer is unsigned and has no `latest.json`, so it has no verified Windows
publisher and cannot auto-update. Download a newer installer manually when upgrading. Updater
signatures (`.sig`) are distinct from Windows Authenticode signing. A clean Windows VM
walkthrough remains outstanding.

The current source adds resume text import without AI; the published v1.0.2 installer predates
that fix and needs a new release. Editing and application tracking work without AI. AI structuring, polishing,
analysis and generation require a configured provider. CLI and local-model providers need their
own installation; they are not bundled with RoleSpec.

For normal installation, download the setup executable, open it, and complete onboarding.
The remainder of this guide is for building, operating and releasing the desktop runtime.

## Build and run from source

This is the runtime bundled by the Windows installer. It runs the same standalone server against a
private PostgreSQL 17 cluster, so no Docker, no user-installed PostgreSQL and no `.env` file is
needed once staged. It is Windows x64 only. Tag builds produce installers; published releases may be unsigned.

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
A local build is **unsigned**, so Windows SmartScreen will warn about it.

**Signing Windows releases**

Releases are signed by CI with [Azure Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/)
(formerly Trusted Signing) using GitHub OIDC, so the signing key is never stored in this repository
and the workflow holds no client secret. Configure once:

1. Create an Artifact Signing account and a certificate profile, complete identity validation, and
   grant the GitHub app the *Artifact Signing Certificate Profile Signer* role.
2. Register an Entra app with a federated credential for `repo:Ry0x7/rolespec-os:ref:refs/tags/v*`
   (issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`).
3. Add repository **secrets** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and
   repository **variables** `AZURE_ARTIFACT_SIGNING_ENDPOINT` (e.g. `https://eus.codesigning.azure.net`),
   `AZURE_ARTIFACT_SIGNING_ACCOUNT`, `AZURE_ARTIFACT_SIGNING_PROFILE`.

With all six present, a `v*` tag build signs the setup executable, verifies the signature and its
RFC 3161 timestamp, and **publishes** the release. With any of them missing the workflow warns and
produces an unsigned installer in a **draft** release, so forks and unauthenticated runs still work.
An unsigned draft can be published deliberately with `gh release edit <tag> --draft=false`; until a
signed release exists it carries no `latest.json`, so installed copies cannot auto-update.

Only the installer is Authenticode-signed. The application executable inside it is not; signing that
too requires an `artifact-signing-cli` step wired through `bundle.windows.signCommand` in
`desktop/src-tauri/tauri.conf.json`. Signing shows a verified publisher, but it does not by itself
remove SmartScreen warnings for a brand-new binary — reputation accrues for the signing identity over
time, and EV certificates no longer bypass the warning.

**Updates and the downgrade guard**

An installed copy asks `releases/latest/download/latest.json` for a newer version about ten seconds
after it starts ([update.rs](../desktop/src-tauri/src/update.rs)), verifies the archive against the
updater public key compiled into `tauri.conf.json`, then stops the local server and database before
the installer replaces files and relaunches the app. The matching private key is the repository
secret `TAURI_SIGNING_PRIVATE_KEY`; without it CI produces no updater archive and attaches no
`latest.json`. **Back that key up**: losing it means installed copies can never be updated and every
user has to install a new build by hand.

Release by bumping `version` in `desktop/src-tauri/tauri.conf.json` and pushing a matching `v*` tag.
The workflow rebuilds the updater archive from the *signed* installer, re-signs that archive, and
writes `latest.json`, so the artifact the updater downloads carries the same signature as the one
people download directly.

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
