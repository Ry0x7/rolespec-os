# Handoff — RoleSpec (2026-10-21)

## Current task

The repository is set up for collaboration and the dependency/quality pass is landed on `main`.
Next product milestone is 5: a **signed** Windows release plus a clean-VM install → onboard →
reopen → upgrade → uninstall run. Plan: `docs/DESKTOP_ONBOARDING_PROPOSAL.md`; runtime details
(data root, updater, downgrade guard, signing) are in the README's desktop section.

## Repo state

- `main` is protected: PR required, checks `types` / `lint` / `test` / `build` / `extension` /
  `audit`, conversation resolution, linear history, no force push or deletion, admins bypass.
  Merge is squash or rebase only; auto-merge and delete-branch-on-merge are on.
- CI: `.github/workflows/ci.yml` (app matrix, `extension`, `audit`),
  `.github/workflows/desktop-check.yml` (Windows `cargo check`/`test`, only when `desktop/**`
  changes, intentionally not required), `.github/workflows/desktop.yml` (tags + manual dispatch).
- Dependabot groups patch+minor, major and security per ecosystem (npm root, npm `extension/`,
  cargo `desktop/src-tauri`, GitHub Actions). TypeScript majors are ignored for the extension until
  the TS 7 migration is planned.
- Collaboration files: `CONTRIBUTING.md`, `SECURITY.md` (private advisory flow, already enabled),
  `CODE_OF_CONDUCT.md`, `.github/CODEOWNERS`, PR template, bug/feature issue forms, `dependabot.yml`.

## Verified in this pass

- Dependency updates merged after review: vite 8.3.4, hono 4.13.13, extension vite 7.3.7, the npm
  patch/minor group (29 packages), extension jsdom 30 + `@types/chrome` group, and the actions
  major group (checkout/setup-node/upload-artifact v7).
- Closed as deliberate migrations, not bumps: extension TypeScript 7, dotenv 18, undici 8,
  framer-motion 14, vitest 5.
- Shell migrated to rand 0.10 by hand: `OsRng` → `SysRng`, fallible `try_fill_bytes` (OS entropy
  kept). `cargo test --locked` 18 passed, clippy and fmt clean.
- Extension is self-contained: `@types/node` declared and `"node"` added to tsconfig `types`; a
  standalone `npm ci && npm run build` in a copy of `extension/` (no root `node_modules`) passes.
  Without it the `extension` CI job failed on `__dirname` — the job now guards that.
- File tracing no longer bundles the whole repo: `next.config.ts` excludes non-runtime trees. The
  exports route traced 14,551 entries before (13,424 of them `desktop/src-tauri/target`) and traces
  965 now; total trace entries 85,579 → 31,205. `DOCKER_BUILD=1` standalone is 3,268 files / 88 MB
  and its `server.js` serves `/` with 200. The 11 Turbopack warnings still print (they are emitted
  during compilation, before excludes apply).
- Desktop workflow manual dispatch on `main` succeeded (17m54s): unsigned NSIS artifact uploaded
  with upload-artifact v7 (101,921,640 bytes), no release and no `latest.json` for a branch build.
- Quality gates on `main`: `npx tsc --noEmit` 0, `npm run lint` 0 warnings, `npm test` 4,668 tests
  in 273 files, `npm run build` and `DOCKER_BUILD=1 npm run build` succeed, extension 227 tests,
  main CI green on `a3a5c380`.
- Security: `npm audit` at 8 root entries (5 high, dev-only braces/micromatch/fast-glob/eslint chain
  with no published fix; 3 moderate on mammoth → argparse@1 → sprintf-js) and 0 in `extension/`.
  Dependabot alerts are down to 2 (`glib`, `sprintf-js`), both documented as unfixable here.

## Changed files

- `next.config.ts` (tracing excludes), `desktop/src-tauri/src/postgres.rs` (rand 0.10, clippy),
  `desktop/src-tauri/Cargo.toml` + `Cargo.lock`, `extension/package.json` + lock + `tsconfig.json`
- `.github/workflows/ci.yml`, `.github/workflows/desktop-check.yml`, `.github/dependabot.yml`,
  `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/*`
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `README.md`, `handoff.md`

## Known gaps

- No Azure Artifact Signing account, so `v1.0.1` is published **unsigned** and carries no
  `latest.json`; installed copies cannot self-update. Signing is wired in `desktop.yml` and untested.
- Nothing has been tested on a clean Windows VM.
- `glib` 0.18.5 is pinned by gtk 0.18 (Linux only; needs a gtk-rs 0.20/Tauri bump) and `sprintf-js`
  has no patched release (reachable only through mammoth's CLI bin, which the app never runs).
- The issue-form pages could not be rendered anonymously (GitHub redirects the chooser to login);
  their YAML parses and follows the issue-form schema.

## Next action

Milestone 5: configure signing, bump `version` in `desktop/src-tauri/tauri.conf.json`, push a `v*`
tag, and run the install/onboard/reopen/upgrade/uninstall sequence on a clean Windows VM. A signed
tag build publishes `latest.json`, which switches self-updates on for installed copies.

## Do not repeat

- Do not add SQLite or a second schema/migration history, and never edit a shipped migration.
- Do not run a desktop build into `.next`; `DESKTOP_BUILD=1` writes `.next-desktop` on purpose.
- Do not prune Prisma CLI dependencies that look unused (`@prisma/dev`, `@prisma/studio-core`).
- Do not commit `.freebuff/`, staged `desktop/src-tauri/resources/*`, `desktop/vendor/` or
  `desktop/src-tauri/target/`.
- Do not gate "is this a tag build" on `GITHUB_REF_NAME` being non-empty — use `GITHUB_REF_TYPE`.
- Do not pass raw Tauri `resource_dir()` (`\\?\`) paths to PostgreSQL, and do not add the
  `resources` segment twice.
- Do not read `pg_ctl status`/`start` through `output()` on Windows; the postmaster inherits stdio.
- Do not test the updater against an `http://` manifest without `dangerousInsecureTransportProtocol`.
- Do not merge a major dependency bump without its migration; majors are grouped so they can be
  reviewed as one deliberate change.
