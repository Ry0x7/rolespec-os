# Frontend verification and release limits

Updated on 23 November 2026. The latest release audit ran against the production
build on Chromium 158.0.8127.18 (Playwright 1.65) with an isolated PostgreSQL
database on loopback. It is a **conditional local beta assessment**, not
unrestricted production certification: the Windows installer was not installed
and no application was submitted to an employer.

Tested tree: `4b1faad` (release candidate). Browser evidence was collected on the
same source tree before the final migration guard and documentation commit; the
fresh-migration check was rerun after the guard.

## Release audit — 23 November 2026

Scope: Next.js 16.4.5 production build, `ROLSPEC_ACCESS_MODE=local`, database
`rolespec_feedback_qa_20261123`. Browser evidence is local only; CI deliberately
skips the Playwright browser download, so none of the drivers below are CI gates.

| Gate | Result | Evidence |
| --- | --- | --- |
| TypeScript | PASS | `npx tsc --noEmit`, exit 0 |
| ESLint | PASS | `npx eslint src scripts --max-warnings=0`, exit 0 |
| Root tests | PASS | 374 files, 5,582 tests, exit 0 |
| Production build | PASS | `npm run build`, exit 0; 10 Turbopack warnings |
| Prisma schema/migrations | PASS | `prisma validate`; fresh-database `migrate deploy` applied all 78 migrations with legacy audit/license tables preserved; `migrate status` up to date |
| Extension tests/build | PASS | 21 files, 318 tests, exit 0; Vite build exit 0 |
| Desktop shell | PASS (compile/tests) | `cargo check` exit 0; `cargo test` 18 passed |
| Dependency audit | PASS | `npm audit --audit-level=high` for production and the full tree, 0 vulnerabilities |
| Browser release matrix | PASS | 124 checks, 0 failures |
| Functional journeys | PASS | 13 checks, 0 failures |
| Opportunity filters | PASS | 16 checks, 0 failures |
| Discovery feedback/presets | PASS | 10 checks, 0 failures |
| Career Path Intelligence | PASS | 11 checks, 0 failures |
| FX outage fallback | PASS | 1 check, 0 failures |
| Windows install/upgrade | **NOT TESTED** | No clean VM install or in-place upgrade; installer is unsigned |
| Live employer ATS fill/submit | **NOT TESTED** | Discovery/planning only; no value written to an employer page |
| Screen readers / non-Chromium engines | **NOT TESTED** | Semantic and focus checks are not WCAG certification |
| Load/soak | **NOT TESTED** | No concurrent workflow or provider-stall run in this pass |

Browser coverage and results:

- 320, 390, 768, 1440 and 1920 CSS px, dark and light modes, nine routes
  (`/dashboard`, `/jobs`, `/jobs/discover`, `/career-profile`, preferences,
  appearance, planner, resumes, workspace). 90 route/viewport/mode checks found
  zero document-level horizontal overflow.
- 200% zoom proxy (720×500 CSS viewport at DPR 2) on five routes: no horizontal
  page scroll.
- Focus-ring contrast over cards: minimum **8.78:1** in dark and **5.03:1** in
  light across all six accents. Muted helper text: minimum **5.42:1** dark and
  **5.05:1** light.
- Keyboard: first Tab stop has a visible indicator; a filter preset activates
  with Enter; the mobile navigation drawer traps focus, closes on Escape and
  returns focus to its trigger; career-path and task tabs keep roving focus.
- Reduced motion: the OS preference produces `reduce-motion`, zero running CSS
  animations and near-zero transition durations.
- Functional journeys cover onboarding completion and restoration, profile
  validation without input loss, saved-search presets and editable alerts
  (separate driver), unknown-pay grouping, currency conversion with rate date,
  opportunity-value evidence, feedback rollback on a failed write, deterministic
  ranking across reloads, ATS preparation tabs and workspace tracking.
- FX failure was injected with a Node preload that fails the Frankfurter request.
  The app served the persisted rate set and labelled every converted figure with
  its date and `last known`; it did not invent a rate. The no-rate branch remains
  unit-tested rather than browser-injected.
- All six drivers were rerun against the final rebuilt server after the dependency
  audit fix: 175/175 checks passed. The journeys report contains one console
  entry for the deliberately aborted feedback request; it is test setup, not an
  application error. Evidence lives under `.unlazy/qa/*-final/` (ignored).

Release-blocking fixes made in this pass:

- Hourly pay is annualized on the posting's stated hours; a `$50/hour` role at
  20 hours/week now reports `$55/hour` effective pay, not a doubled figure.
- Quick toggles preserve the stored Opportunity Value policy instead of resetting
  custom weights and minimum-pay rules.
- A malformed `paymin` URL (`%20`, `0x10`, exponent) falls back instead of
  throwing during the filter render.
- Onboarding seniority is copied to the canonical Career Profile only when that
  field is unanswered; later profile edits are preserved.
- Dark focus rings, light muted text, salary/FX notices, amber text fills and
  hover-only delete controls meet their contrast or focus-visibility floors.
- A dropped connection during feedback no longer replaces the page with the route
  error boundary; the select reverts and the error is reported in a toast.
- The discovery-presets migration no longer drops `admin_audit_logs` or
  `license_activation`; both historical tables are preserved for existing
  installs and verified present after a fresh deployment.

Remaining P2 items (not release blockers): the Opportunity Value floor compares
range tops while the advanced filter compares midpoints; paused target roles can
still appear in career-path growth notices; the guided setup has no unsaved-exit
warning; the command-palette input has no focus ring; dark form borders are below
3:1; and 200% text-only resize (not browser zoom) can still reflow grids.

The provider-backed workflow and historical pass below was run on 12 November
2026 against the development and production web application, PostgreSQL and a
configured provider. It remains valid for its stated scope.

## Historically verified behavior (12 November 2026)

- Manual and assisted preparation, persisted events, pause/resume, cancellation,
  provider failure/retry and recovery after a real server restart.
- Resume, DOCX, PDF, chat and typed-transcript intake; separate proposal approval
  and candidate-fact confirmation with source provenance.
- Discovery, persisted ranking, research, resume comparison, historical validation,
  generated PDF bytes and rollback. Both pages of a generated PDF were rendered
  locally and visually inspected.
- Human review, staging, explicit application outcome recording, durable
  business-day reminders and manual outreach touch tracking.
- Current Chromium extension loading and authenticated profile, answer-memory
  and review reads using a disposable token that was subsequently revoked.
- Desktop/mobile layouts, tab navigation and deep links, keyboard controls,
  enlarged text, themes, reduced motion, offline behavior and retry.
- Subsequent 23 November coverage adds saved discovery searches with editable
  in-app alerts, explicit user feedback with transparent ranking adjustments,
  Opportunity Value scoring and presets, salary conversion with rate dates,
  career-path recommendations and target-role approval. See the audit section
  at the top of this page.

The audit corrected narrow workflow-detail layouts, enlarged-text header
overflow, long stacked pages, tab focus/deep-link behavior, missing accessible
labels, duplicate research actions and misleading privacy/offline copy.

Tests used a separate QA database. Original workspace facts and application
status were checked for isolation. No application was submitted to an employer
and no outreach message was sent.

## Automated checks

- Frontend (23 November): 374 files and 5,582 tests passed, exit 0. TypeScript,
  ESLint, the production build and Prisma validation/migration status also passed.
- Browser (23 November): 175 checks across six local drivers, 0 failures: the
  responsive/theme/zoom/focus matrix (124), functional journeys (13), opportunity
  filters (16), discovery feedback and presets (10), career paths (11) and the
  injected FX outage fallback (1).
- Extension: 21 files and 318 tests passed; its production build passed.
- Desktop: `cargo check` passed and `cargo test` reported 18 passed. This is
  compile/test evidence, not install evidence.
- The build reports 10 Turbopack warnings (dynamic file tracing in export storage
  and the optional Antigravity CLI provider).

These checks establish the stated scope; they do not establish that every legacy
generator, destructive action, browser or employer integration was exercised.

## Unverified or limited

- A clean v2.0.1 Windows install, in-place upgrade and native WebView session.
  There is no NSIS artifact in this worktree and the installer is unsigned. See
  [the desktop guide](DESKTOP.md) for installation and release mechanics.
- Live employer ATS filling, file attachment and final application completion.
  The audit verified preparation tabs and staged-material screens only. Headless
  Chrome identity authorization was blocked; manual-token reads worked.
  Approved-answer replacement/revocation was not exercised end to end.
- Fresh empty-database onboarding, a LinkedIn-issued export, successful owned
  GitHub/portfolio extraction and physical microphone capture. The LinkedIn
  adapter test used an application-generated PDF.
- Native PDF viewing: headless navigation aborted and the download event timed
  out. Successful export and local rendering do not certify the native viewer
  or all eight templates.
- Other browser engines, screen readers and load/performance certification. The
  23 November pass measured focus-ring and muted-text contrast in Chromium, not
  a complete WCAG audit, and did not use assistive technology.
- 200% browser zoom was exercised through a 720 CSS-px viewport; 200% text-only
  resize still reflows some grids, which is a WCAG 1.4.4 risk.
- The FX outage test injected a failed Frankfurter request and verified the
  persisted last-known path. The no-rate branch is unit-tested only.
- Workflow/review list limits, extension-only answer management and historical
  validation binding remain contract limitations. See
  [API_CONTRACTS.md](API_CONTRACTS.md) and [WORKFLOW_STATES.md](WORKFLOW_STATES.md).

## Dashboard visual regression

The dashboard cards have a deterministic fixture at `/visual/dashboard` and
`/visual/dashboard?state=worst`. The worst-case state feeds long unbroken company
names, non-Latin text, four-digit counts and nine upcoming events into the real
components, so reflow failures surface without touching the database.

With a local development server running:

```bash
npm run test:visual              # compare phone/desktop, default/worst
npm run test:visual -- --update  # regenerate the checked-in baselines
```

It captures 390px and 1440px, asserts that the document does not scroll
horizontally, and fails any child that grows wider than its own container (the
failure mode an `overflow-hidden` card would otherwise hide). Baselines live in
`screenshots/visual-regression/`; per-run captures and diffs stay under ignored
`.unlazy/visual-regression/`. The fixture 404s in production and is not linked
from the app. The check is not in CI because CI deliberately skips the Playwright
browser download.

## Reproducing checks

```bash
npx tsc --noEmit
npx eslint src scripts --max-warnings=0
npx vitest run
npx prisma validate
npx prisma migrate status
npm run build
npm --prefix extension test
npm --prefix extension run build
cargo check --manifest-path desktop/src-tauri/Cargo.toml
cargo test --manifest-path desktop/src-tauri/Cargo.toml
```

Run Prisma-generating builds separately from TypeScript checks.

Stateful exploratory drivers in `scripts/qa/` require a disposable clone with the
expected saved application/resume fixture; they are not a generic empty-database
suite. Start the production build on loopback against that clone, then run:

```bash
QA_BASE_URL=http://127.0.0.1:3100 node scripts/qa/release-matrix.cjs
QA_BASE_URL=http://127.0.0.1:3100 node scripts/qa/release-journeys.cjs
QA_BASE_URL=http://127.0.0.1:3100 node scripts/qa/opportunity-filters.cjs
DATABASE_URL=<qa-clone> QA_BASE_URL=http://127.0.0.1:3100 node scripts/qa/discovery-feedback.cjs
DATABASE_URL=<qa-clone> QA_BASE_URL=http://127.0.0.1:3100 node scripts/qa/career-path.cjs
```

`opportunity-filters.cjs` expects the showcase fixture's PHP display currency so
USD postings produce a converted equivalent. The FX outage check needs a second
server started with the injected preload:

```bash
NODE_OPTIONS="--require ./scripts/qa/fx-failure-preload.cjs" npx next start -p 3110 -H 127.0.0.1
QA_BASE_URL=http://127.0.0.1:3110 node scripts/qa/fx-failure.cjs
```

`start-isolated.cjs` starts a QA clone and `live-audit.cjs` records actual
UI/backend results. Review their mutations before replaying them. Raw receipts,
screenshots, local paths and command logs are retained locally under ignored
`.unlazy/qa/`, rather than shipped as public product documentation.
