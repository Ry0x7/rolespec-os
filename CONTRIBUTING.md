# Contributing to RoleSpec

Thanks for helping. RoleSpec is a self-hosted job-search workspace: a Next.js app, a Windows
desktop shell, and a Chrome MV3 extension in one repository. This guide covers the setup, the rules
that keep the product coherent, and what a reviewable pull request looks like.

- Found a security problem? **Do not open an issue** — follow [SECURITY.md](SECURITY.md).
- Not sure where a change belongs? Open an issue first and describe the workflow you want to fix.

## Ways to contribute

- **Bugs** with clear reproduction steps (use the bug report form).
- **Features** that remove a step from the job-search workflow, not features that add surface area
  for its own sake. Check [docs/ROADMAP.md](docs/ROADMAP.md) for current priorities.
- **Docs** that are wrong, stale, or missing a step a real user hit.
- **Tests** around a confirmed bug — a failing test plus a fix is the easiest PR to review.
- **Platform work**: desktop packaging, Docker, CI, accessibility.

Labels `good first issue` and `help wanted` mark work that is scoped and ready. Comment on the
issue before starting so two people do not build the same thing.

## Prerequisites

| Work area | Needs |
| :--- | :--- |
| Web app | Node.js 22+, npm, a PostgreSQL database (local, Docker, or a free Neon project) |
| Browser extension (`extension/`) | Node.js 22+, Chrome/Brave/Edge to load the unpacked build |
| Desktop shell (`desktop/`) | **Windows x64** plus Rust stable and the [Tauri Windows prerequisites](https://tauri.app/start/prerequisites/); the shell and its pinned PostgreSQL build are Windows-only |

## Local setup

```bash
git clone https://github.com/Ry0x7/rolespec-os.git
cd rolespec-os
npm install                 # runs `prisma generate` via postinstall
cp .env.example .env        # then set DATABASE_URL and AUTH_SECRET
npx prisma migrate dev      # creates the schema
npx prisma db seed          # optional demo/admin data
npm run dev                 # http://localhost:3100
```

`AUTH_SECRET` must be a random value (`openssl rand -base64 32`). `ENCRYPTION_KEY` is optional but
recommended: stored AI provider keys are encrypted at rest, and rotating either key later makes
previously saved credentials unreadable. See the comments in `.env.example` — they are the current
reference for every variable.

The extension is a separate package with its own lockfile:

```bash
cd extension
npm ci
npm run build               # writes extension/dist
npm test
```

Load `extension/dist` in `chrome://extensions` with **Load unpacked**.

### Desktop shell

The desktop build stages the standalone server plus Node, the Prisma CLI and PostgreSQL 17, and is
deliberately isolated from a running `next dev`:

```bash
npm run desktop:postgres    # one-time, pinned binaries (~250 MB)
npm run desktop:build       # stages desktop/src-tauri/resources
npm run desktop:run         # launches the shell
```

`desktop:build` writes `.next-desktop`, never `.next`. Do not point a desktop build at `.next`:
a live dev server owns that directory and the bundle ends up referencing dev chunks. Shell checks
are `npm run desktop:check` and `npm run desktop:test`.

## Before you open a PR

CI runs the same commands on every PR. Run them locally first:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

| CI check | Command | Notes |
| :--- | :--- | :--- |
| `types` | `npx tsc --noEmit` | strict TypeScript |
| `lint` | `npm run lint` | ESLint, must be warning-free |
| `test` | `npm test` | Vitest; 4,600+ tests run in about 90s |
| `build` | `npm run build` | runs `prisma generate` first, so no database connection is needed |
| `extension` | `cd extension && npm ci && npm run build && npm test` | the extension is its own package; it is built and tested on every PR |
| `audit` | `npm audit --audit-level=high --omit=dev` | production dependencies must stay clean at high/critical |
| `audit` | `npm audit --audit-level=high` | dev-only advisories are reported, not fatal |

If you touched `desktop/src-tauri/`, the **Desktop shell** workflow also runs
`npm run desktop:check` and `npm run desktop:test` on `windows-latest`. That job only triggers on
desktop changes and is reported separately from the required checks, because Tauri cannot compile
on the Linux runner the main CI uses.

A change is not verified because a build exits 0. Exercise the workflow you changed — the page, the
API route, the extension popup — and say in the PR what you actually ran.

## Code layout and rules

```
src/app/          routes (App Router) — thin, delegate to features
src/features/     feature code grouped by domain
src/shared/       cross-feature code: lib, ui, prompts
src/config/       site/runtime configuration
extension/        standalone MV3 extension (own package)
desktop/          Tauri shell + staged runtime
prisma/           one schema, one migration history
docs/             ARCHITECTURE.md, ROADMAP.md, DESKTOP_ONBOARDING_PROPOSAL.md
```

Invariants that reviews enforce:

1. **Everything user-owned is scoped to the authenticated user.** New queries take the session user
   id; never trust an id from the request body alone. Downloads (for example `/api/exports/...`)
   re-check ownership, not just the URL.
2. **Job-description text is evidence about the employer, never about the user.** It must not
   become a claim in a resume, score, or generated message.
3. **All AI calls go through `src/shared/lib/ai-generate.ts`.** Do not call a provider SDK directly
   from a feature, and do not add a second credential store.
4. **One Prisma schema and one migration history.** Do not add SQLite, a desktop-only schema, or a
   parallel migration folder. The desktop shell applies the same migrations and refuses to open a
   database created by a newer build.
5. **Preserve working workflows.** Behaviour changes need a reason (correctness, security, or a
   documented product decision), and the smallest change that achieves it.
6. **Do not invent capabilities.** If a screen says a feature exists, it must exist in code and be
   covered by a test or a verified manual run.

`docs/ARCHITECTURE.md` and `docs/ROADMAP.md` are the canonical references for boundaries and
sequencing. `handoff.md` is a working checkpoint, not a design document — do not add planning docs
that duplicate them.

### Database changes

```bash
npx prisma migrate dev --name describe_the_change
```

Commit the generated migration with the schema change. Never edit a migration that has shipped:
installed desktop copies have already applied it, and the downgrade guard only compares migration
names. Keep migrations reversible by thought, not by `migrate reset` — there is no down migration
story.

### UI changes

Match the existing visual system rather than restyling a page. Include before/after screenshots in
the PR (light and dark if the change is visible in both), and check the narrow viewport — the
workspace and resume editor are used on laptops.

## Commits and branches

- Branch from `main`: `fix/resume-export-404`, `feat/extension-clip-shortcut`,
  `docs/desktop-troubleshooting`.
- Subject line in the imperative, matching the existing history: `Fix export cleanup on account
  deletion`, `Bump vite to 8.3.4`.
- One logical change per commit; separate refactors from behaviour changes so review is possible.
- Reference the issue in the PR body (`Closes #123`), not in every commit.
- Do not commit `.env`, `.freebuff/`, staged `desktop/src-tauri/resources/*`, `desktop/vendor/`,
  `desktop/src-tauri/target/`, `extension/dist/`, or generated Prisma output — all are ignored for
  a reason.

## Pull requests

1. Keep the PR focused. A 4,000-line PR that mixes a refactor with a fix will be asked to split.
2. Fill in the template: what changed, why, how you verified it, and any data or security impact.
3. Wait for CI. Review starts once `types`, `lint`, `test`, `build` and `audit` are green.
4. Squash-merge is the default; the branch is deleted afterwards. Write the squash subject so it
   reads as a standalone change.
5. A maintainer may push small fixups to your branch; ask if you would rather they did not.

Reviews are about the change, not the person. Expect questions about user scoping, failure modes,
and whether a test would catch the regression.

## Release flow (maintainers)

- Every push to `main` runs CI. Releases are cut by bumping `version` in
  `desktop/src-tauri/tauri.conf.json` and pushing a matching `v*` tag, which builds and signs the
  Windows installer (see the README's desktop section for the signing setup).
- Desktop releases preserve user data: the installer replaces application files and the shell keeps
  `%LOCALAPPDATA%\RoleSpecData` untouched.
- `latest.json` is published only for signed builds. An unsigned build stays a draft on purpose.

## License

Contributions are accepted under [AGPL-3.0](LICENSE). By submitting a pull request you confirm you
have the right to license the code under those terms.
