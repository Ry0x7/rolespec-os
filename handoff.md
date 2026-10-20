# Desktop Shell & Local Database (2026-10-21)

## Current task

Milestones 2 (Tauri shell), 3 (local PostgreSQL lifecycle), 4 (installer pipeline) and 6 (self-updates)
are verified on this Windows machine. Pushing tag `v1.0.0` ran the Windows workflow, produced the NSIS
installer and created a **draft** release; that installer was then silently installed, launched,
uninstalled and reinstalled with its data preserved. A local 1.0.0 install then updated itself to a
signed 1.0.1 through the real updater, and the schema guard refuses a database with a migration the
build does not ship. Tag `v1.0.1` (current main) built a release that was **published unsigned on
purpose**, since no signing account exists; v1.0.0 stays a draft because it predates the updater.
Remaining: an Azure signing certificate, a signed release with `latest.json`, and a clean-VM test.
The plan is
`docs/DESKTOP_ONBOARDING_PROPOSAL.md`.

## Maintenance pass (2026-10-21)

Reviewed the three open Dependabot PRs (all green: audit/build/lint/test/types) and merged them:
vite 8.2.2 → 8.3.4 (#3), hono 4.13.7 → 4.13.13 (#2), extension vite 7.3.6 → 7.3.7 (#1). That closed
six of the ten open dependency alerts (launch-editor via vite in both packages, hono serveStatic).
`npm audit` on main is now 8 root entries (5 high dev-only braces/micromatch/fast-glob/
eslint-config-next, 3 moderate mammoth → argparse@1 → sprintf-js) and 0 in `extension/`.

Not fixable, left open and documented: braces and sprintf-js have **no published patched
version** (braces 3.0.3 and sprintf-js 1.1.3 are the latest and still in range), and mammoth's
argparse is only reachable from its CLI bin (`require("mammoth")` loads no argparse). glib 0.18.5
is pinned by gtk 0.18 (Linux only, needs a gtk-rs 0.20/Tauri bump) and never compiles on Windows.
The CI audit comment now records the mammoth exception.

Fixed two quality findings: `clippy::question_mark` in `postgres.rs` (behaviour unchanged), and file
tracing pulling the whole repo into server bundles. `store-export.ts` builds paths at runtime, so
Turbopack traced every project file: 14,551 entries for the exports route, 13,424 of them
`desktop/src-tauri/target`. `next.config.ts` now excludes the non-runtime trees; that route traces
965 entries and the exports-free bundles dropped similarly (85,579 → 31,205 total trace entries).
A `DOCKER_BUILD=1` standalone build is 3,268 files / 88 MB and its `server.js` boots and serves `/`
with 200. The 11 build warnings remain — Turbopack emits them during compilation, before excludes
are applied — but the trace they describe is gone.

Collaboration plumbing (commit `adfaa1b4`): `CONTRIBUTING.md` (setup, invariants, checks, release
flow), `SECURITY.md` (private advisory flow, scope, supported versions), `CODE_OF_CONDUCT.md`,
`.github/CODEOWNERS`, PR + issue-form templates, and `.github/dependabot.yml` grouping patch/minor
per ecosystem (npm root, npm extension, cargo, actions). On GitHub: `main` is protected (PR required,
checks `types`/`lint`/`test`/`build`/`audit`, conversation resolution, linear history, no force
push or deletion, admins bypass), squash+rebase only, auto-merge on, delete branch on merge, topics
and labels set, private vulnerability reporting already enabled. Anonymous rendering of the issue
forms could not be checked (GitHub redirects the chooser to login); their YAML parses and follows
the issue-form schema.

Dependency pass after that setup: the patch/minor group, the extension patch/minor group and the
actions major group are merged; four root majors (dotenv 18, undici 8, framer-motion 14, vitest 5)
were closed as deliberate migrations. The shell moved to rand 0.10 by hand (`OsRng` → `SysRng`,
fallible `try_fill_bytes`) rather than merging that bump blind; `cargo test` 18 passed and clippy is
clean. The extension now declares `@types/node` and lists `node` in its tsconfig types — a
standalone `npm ci` in `extension/` previously failed on `__dirname`, which the new `extension` CI
job caught on its first run. `main` now requires `types`/`lint`/`test`/`build`/`extension`/`audit`;
the Windows `desktop` job (`.github/workflows/desktop-check.yml`) runs only when `desktop/**`
changes and is not required. Dependabot groups patch+minor, major and security per ecosystem.

## Verified facts

- The shell runs the shared `.next/standalone` server. There is no desktop fork: one Prisma schema,
  one migration history, one AI layer.
- Desktop builds use `distDir: .next-desktop` (`DESKTOP_BUILD=1`, set by `scripts/desktop/stage-runtime.mjs`)
  so a running `next dev` in the same checkout cannot corrupt the bundle. `DOCKER_BUILD=1` still
  produces `.next/standalone` for Docker.
- The shell starts a private PostgreSQL 17 cluster (`initdb -A trust` on `127.0.0.1` only), applies
  `prisma migrate deploy` through the staged Prisma CLI, then starts `server.js` on port 3100
  (falls back to a free loopback port when occupied) and opens `/onboarding`.
- Shell-owned data lives in `%LOCALAPPDATA%\RoleSpecData`: `data/pg`, `data/exports`,
  `config\secrets.json`, `logs\{desktop,postgres}.log`. Secrets are generated once and reused; the
  cluster is preserved across restarts. It must not be `%LOCALAPPDATA%\RoleSpec`: that is the
  per-user NSIS install directory, so uninstall would delete the database and secrets.
- `DATABASE_URL` present in the environment switches to external-database mode (requires
  `AUTH_SECRET`). `ROLESPEC_MANAGED_DB=0/1` forces the mode; `ROLESPEC_PG_DIR`, `ROLESPEC_APP_DIR`,
  `ROLESPEC_NODE`, `ROLESPEC_PRISMA_DIR`, `ROLESPEC_PORT` are developer overrides.
- Windows shutdown is graceful: window close → `taskkill /T` for the Node child → `pg_ctl -m fast
  stop`, with a force-kill fallback after 3s.
- A Win32 kill-on-close job object (`desktop/src-tauri/src/job.rs`) owns the Node server and the
  PostgreSQL postmaster. If the shell crashes, the OS terminates both instead of leaving them on
  ports 3100/54329. Job creation or assignment failure is logged as a warning, never fatal.
- `npm run desktop:postgres` pins PostgreSQL 17.11-1 Windows x64 by SHA-256. `desktop:build` stages
  the standalone app (whitelisted entries only), Node, the full Prisma CLI dependency tree and
  migrations.
- Packaged layout: Tauri installs resources under `<install>\resources\...` while `resource_dir()`
  returns `<install>` **as a verbatim `\\?\` path**. Both matter: `bundled_root()` keeps the
  `resources` segment and `native_path()` strips the verbatim prefix (PostgreSQL's `initdb` fails on
  `//?/C:/...`). Verified against a copied release layout, not just the dev path.
- Prisma 7.9.1 eagerly requires `@prisma/studio-core` and `@prisma/dev` for `migrate deploy`; the
  staged CLI is ~234 MB. `@prisma/studio-core` also hides `package.json` behind `exports`, so the
  stager falls back to the hoisted package directory.

## Changed files

- `desktop/src-tauri/` — `src/main.rs`, `supervisor.rs`, `postgres.rs`, `job.rs`, `logging.rs`,
  `tauri.conf.json`, `capabilities/default.json`, `icons/icon.ico`, `build.rs`, `Cargo.toml`,
  `Cargo.lock`, `resources/README.md`
- `desktop/ui/index.html` — fallback page only; the window loads the local server
- `scripts/desktop/` — `stage-runtime.mjs`, `fetch-postgres.mjs`, `generate-icon.mjs`
- `.github/workflows/desktop.yml` — Windows x64 NSIS build on tags/manual dispatch
- `next.config.ts` (`distDir`), `package.json` (desktop scripts), `tsconfig.json`, `.gitignore`,
  `.dockerignore`, `eslint.config.mjs` (ignore generated desktop output)
- `README.md` (desktop developer path), `docs/ARCHITECTURE.md`, `docs/DESKTOP_ONBOARDING_PROPOSAL.md`
  (data root), `docs/ROADMAP.md` (E2 done, E3 restart-verified), this file

## Verification (ran, not assumed)

- `cargo test`: 14 passed (health parsing, port choice/fallback, path errors, loopback DB URL,
  secret generation, job create/assign, a child that must die when the job closes, resource prefix
  resolution, verbatim/UNC path normalization, and the data root name).
- First launch against an isolated `%LOCALAPPDATA%` scratch root: created secrets, `initdb`, started
  PostgreSQL on 54329, created the `rolespec` database, applied 57 migrations, server ready on 3100,
  `/api/health` and `/onboarding` returned 200, window titled `RoleSpec` existed and responded.
- Closed the window: server stopped, PostgreSQL logged a fast shutdown, no `rolespec-desktop` or
  `postgres` process remained.
- Second launch on the same root: no `initdb`, cluster reused, migrations idempotent, same
  `owner@rolespec.local` user row (`createdAt` unchanged), secrets file mtime unchanged, health 200.
- Crash containment: after a healthy launch, `taskkill /F` on the shell only (no graceful path)
  terminated the Node server and the PostgreSQL postmaster; both listeners were gone within 5s. The
  next launch recovered the cluster (`redo starts` in the PostgreSQL log) and served health 200.
  Scratch roots were removed afterwards.
- `npx tsc --noEmit`: exit 0. `npm run lint`: exit 0, 0 warnings. `npm test`: 273 files / 4,668
  tests passed.
- Packaged-layout run (release exe + copied `resources/`, isolated `%LOCALAPPDATA%`): first launch
  created secrets, `initdb`, PostgreSQL on 54329, applied 57 migrations, server ready on 3100, health
  200, window titled `RoleSpec`; a restart reused the cluster with `initdb` appearing once; graceful
  close stopped both processes. Data was created only under `RoleSpecData`, not in the app directory,
  which is the property uninstall relies on.
- NSIS installer built locally with `npx @tauri-apps/cli@^2 build --bundles nsis`: 102.97 MiB
  (`RoleSpec_1.0.0_x64-setup.exe`, sha256 `e0da86b5…`), 14,867 entries / 646 MB unpacked. `7z l`
  confirms `resources/app/server.js`, `resources/node/node.exe`,
  `resources/postgres/bin/postgres.exe`, `@prisma/dev` and `@prisma/studio-core` are inside, and the
  embedded exe timestamp matches the final release build.
- CI run 39492977194 on tag `v1.0.1` succeeded from commit `dff352a8`: tests, staging, the NSIS build,
  the update-artifact re-sign and the manifest step all passed (`Wrote .../latest.json`; the file is
  uploaded as a workflow artifact but deliberately kept off the release because the build is
  unsigned). Draft release `v1.0.1` carries `RoleSpec_1.0.1_x64-setup.exe` (110,675,628 bytes), its
  `.sig` and `SHA256SUMS.txt`; the download passes `sha256sum -c`, the signature's trusted comment
  says `version:1.0.1`, and the installer holds 14,876 entries including `resources\app\server.js`,
  `resources\node\node.exe` and `resources\postgres\bin\postgres.exe`. The workflow created it as a
  draft; it was then published with `gh release edit v1.0.1 --draft=false` (an explicit decision to
  ship unsigned) under the title "RoleSpec 1.0.1 — Windows desktop preview", with notes that list the
  desktop runtime, installer/data layout, updater, schema guard and the packaging fixes plus the known
  limitations, rather than GitHub's empty auto-generated changelog. Anonymous checks after publishing:
  the installer URL answers 302 → 200,
  `/releases/latest` redirects to `v1.0.1`, and `/releases/latest/download/latest.json` is 404 —
  auto-update is deliberately still off until a signed release attaches the manifest.
- CI run 39300819266 on tag `v1.0.0` succeeded: tests, staging and installer build passed. It
  uploaded the artifact and created draft release `v1.0.0` with `RoleSpec_1.0.0_x64-setup.exe`
  (109,950,705 bytes) and `SHA256SUMS.txt`. The downloaded asset passed `sha256sum -c`
  (`30f54815…`) and contains 14,876 entries / 648 MB unpacked with the same runtime pieces.
  The release is a draft on purpose: the build is unsigned and SmartScreen blocks unsigned
  installers, so publishing is a manual step after signing.
- Installer lifecycle on this machine (silent `/S`, isolated install directory): install exit 0;
  the installed app opened, created `%LOCALAPPDATA%\RoleSpecData`, served health 200 and shut down
  cleanly; uninstall exit 0 removed the install directory while keeping the PostgreSQL cluster
  (`PG_VERSION` 17) and `secrets.json`; reinstalling and launching reused that data with no second
  `initdb` and the same `owner@rolespec.local` row.
- Updater: `tauri-plugin-updater` is registered and driven from Rust (`src/update.rs`) because the
  window loads the server, not bundled HTML, so the JS command surface is unreachable. Ten seconds
  after startup it reads `releases/latest/download/latest.json`, verifies the artifact against the
  public key in `tauri.conf.json` (`requireSignedVersion` on), downloads it, stops the server and
  cluster, and lets the NSIS installer relaunch the app. A missing manifest is logged as a warning,
  never fatal; observed in a live run ("the update endpoint could not be reached").
- Full update run, 1.0.0 → 1.0.1 (isolated install dir and isolated `LOCALAPPDATA`, hosted manifest
  and installer on `127.0.0.1:8099` through a `--config` overlay that sets the endpoint and
  `dangerousInsecureTransportProtocol`; version left untouched in the repo): the check logged
  "RoleSpec 1.0.1 is available (installed: 1.0.0)", the dialog showed that text, accepting it
  downloaded the 108.7 MB installer, the signature verified (the download would have failed
  otherwise), the shell stopped the server and cluster, the NSIS `/UPDATE` install replaced
  `rolespec-desktop.exe` with 1.0.1, and the relaunched app reused the same cluster (no `initdb`),
  applied migrations idempotently, served health 200 and opened the window. `secrets.json` mtime and
  the `users` row created at 19:41 survived; the next check logged "RoleSpec is up to date".
  Uninstall of the updated install left two empty directories (`install\resources\app`) behind, which
  is cosmetic (no files), unlike the earlier clean install whose directory was removed entirely.
- The desktop workflow only runs on `v*` tags and manual dispatch. A manual dispatch on `main` used to
  reach the manifest step with `GITHUB_REF_NAME=main` and fail, because the step only checked for an
  empty ref and the node invocation carried a stray `\n` argument. It now checks `GITHUB_REF_TYPE`,
  skips branch builds with a warning, and passes every argument on one line; dispatch run 39482422206
  on `main` is green and writes no `latest.json`.
- Updater artifacts: `tauri.conf.json` keeps `createUpdaterArtifacts: false` so local builds need no
  key; CI adds the `--config` overlay when `TAURI_SIGNING_PRIVATE_KEY` exists. A local release build
  produced `RoleSpec_1.0.0_x64-setup.exe.sig` whose trusted comment contains `version:1.0.0`, which
  is what `requireSignedVersion` compares. Authenticode changes the bytes, so CI re-signs the
  installer with `signer sign` afterwards and only then writes `latest.json`
  (`scripts/desktop/write-update-manifest.mjs`, which rejects a tag that does not match the version).
- Downgrade guard: before migrations, the shell reads `_prisma_migrations` through the bundled `psql`
  and refuses to start when the database has a migration this build does not ship. Verified on a real
  cluster by inserting a finished `20990101000000_future_schema` row: the next launch logged the
  "created by a newer version" message, named that migration, stopped PostgreSQL, showed the error
  dialog and never ran `migrate deploy`. An unfinished row is a *failed* migration, not a newer
  schema, and Prisma reports that case (P3009) instead.
- Console windows: every child (`initdb`, `pg_ctl`, `psql`, `createdb`, `node`, `taskkill`, `icacls`)
  is spawned through `process::quiet()`, which sets `CREATE_NO_WINDOW`. A top-level-window watcher
  detected a control console window but zero windows owned by the app's children across a full
  startup and shutdown.
- The updater key pair was generated with `tauri signer generate` into `.freebuff/updater-keys/`
  (gitignored, never committed). The public half is in `tauri.conf.json`; the private half is the
  repository secret `TAURI_SIGNING_PRIVATE_KEY`. Losing it means installed copies can never update.
- The staged bundle (`resources/app`) runs `.next-desktop` (its `server.js` config and BUILD_ID match
  the desktop build), which is why the app boots rather than 404-ing every chunk.

## Known gaps

- `v1.0.1` is **published but unsigned**: SmartScreen shows its warning, and installed copies
  cannot self-update because the release has no `latest.json` and their check logs a warning. `v1.0.0`
  remains a draft; it predates the updater and should stay unpublished.
  Signing is wired into `.github/workflows/desktop.yml` (Azure Artifact Signing over GitHub OIDC,
  then `Get-AuthenticodeSignature` must report `Valid` with a timestamp, and only then does a tag
  build publish instead of drafting). It has never executed: no Artifact Signing account or Entra
  app exists, so the six secrets/variables are unset and CI takes the warned, unsigned, draft path.
- Nothing has been tested on a clean Windows VM.
- The updater has only been exercised against a locally hosted manifest. The real path
  (`releases/latest/download/latest.json` from GitHub) is unproven because nothing is published, and
  an Authenticode-signed installer has never been downloaded through the updater.

## Next action

Both maintenance commits are on `main` (`a413a5c6`, `adfaa1b4`) and pushed. The tracing fix only
shrinks `.next/standalone` itself — `stage-runtime.mjs` already whitelists runtime entries, so the
packaged installer is unchanged in size.

Milestone 5: sign the installer and repeat the install → onboard → reopen → upgrade → uninstall
sequence on a clean Windows VM, recording anything the dev machine hides. The next signed tag (bump
`version` and tag again) publishes automatically and attaches `latest.json`, which switches
self-updates on for installed copies; the unsigned `v1.0.1` cannot update itself. Signing may remain
blocked without a certificate.

## Do not repeat

- Do not add SQLite or a second schema/migration history.
- Do not introduce a second AI credential store or read vendor auth files/tokens.
- Do not claim a downloadable desktop installer exists; none is published.
- Do not run a desktop build into `.next`; `DESKTOP_BUILD=1` selects `.next-desktop` for a reason.
- On Windows, read `pg_ctl status`/`start` through `.status()` with discarded handles: the
  postmaster inherits stdio and `output()` would block until shutdown.
- Do not pass raw Tauri `resource_dir()` paths to PostgreSQL, and do not add the `resources` segment
  twice: package layout is `<install>/resources/<name>`, and the returned path starts with `\\?\`.
- Do not prune Prisma CLI dependencies that look unused (`@prisma/dev`, `@prisma/studio-core`); the
  7.9.1 CLI requires them at startup even for `migrate deploy`.
- Do not commit `.freebuff/`, staged `desktop/src-tauri/resources/*`, `desktop/vendor/` or
  `desktop/src-tauri/target/` — all are gitignored build output.
- Do not gate "is this a tag build" on `GITHUB_REF_NAME` being non-empty: a manual run on a branch
  sets it to the branch name (`main`). Use `GITHUB_REF_TYPE`.
- Do not test the updater against a local `http://` manifest without
  `dangerousInsecureTransportProtocol: true`; the plugin rejects non-HTTPS endpoints.
