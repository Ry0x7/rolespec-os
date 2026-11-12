# Frontend verification and release limits

Audited on 12 November 2026 against the real development and production web
application, PostgreSQL and a configured provider. This is a **conditional local
beta assessment**, not unrestricted production certification.

## Verified behavior

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

The audit corrected narrow workflow-detail layouts, enlarged-text header
overflow, long stacked pages, tab focus/deep-link behavior, missing accessible
labels, duplicate research actions and misleading privacy/offline copy.

Tests used a separate QA database. Original workspace facts and application
status were checked for isolation. No application was submitted to an employer
and no outreach message was sent.

## Automated checks

- Frontend: 343 files and 5,186 tests passed. After the final workflow layout
  correction, the affected three suites passed again with 35 tests.
- Extension: 21 files and 318 tests passed; its production build passed.
- TypeScript, ESLint and the production web build passed. Seven browser checks
  also passed against the built production application.
- The build retained 11 existing dynamic-file-tracing warnings in export storage.

These checks establish the stated scope; they do not establish that every legacy
generator, destructive action, browser or employer integration was exercised.

## Unverified or limited

- A clean v2.0.0 Windows install, in-place upgrade and native WebView session.
  See [the desktop guide](DESKTOP.md) for installation and release mechanics.
- Live employer ATS filling, file attachment and final application completion.
  Headless Chrome identity authorization was blocked; manual-token reads worked.
  Approved-answer replacement/revocation was not exercised end to end.
- Fresh empty-database onboarding, a LinkedIn-issued export, successful owned
  GitHub/portfolio extraction and physical microphone capture. The LinkedIn
  adapter test used an application-generated PDF.
- Native PDF viewing: headless navigation aborted and the download event timed
  out. Successful export and local rendering do not certify the native viewer
  or all eight templates.
- Other browser engines, screen readers, a complete contrast audit and load or
  performance certification. Semantic-name checks are not WCAG certification.
- Workflow/review list limits, extension-only answer management and historical
  validation binding remain contract limitations. See
  [API_CONTRACTS.md](API_CONTRACTS.md) and [WORKFLOW_STATES.md](WORKFLOW_STATES.md).

## Reproducing checks

Run `npm test`, `npm run lint -- src`, `npx tsc --noEmit`, `npm run build`,
`npm --prefix extension test` and `npm --prefix extension run build`.
Run Prisma-generating builds separately from TypeScript checks.

Stateful exploratory drivers in `scripts/qa/` require a disposable clone with the
expected saved application/resume fixture; they are not a generic empty-database
suite. `start-isolated.cjs` starts a QA clone and `live-audit.cjs` records actual
UI/backend results. Review their mutations before replaying them. Raw receipts,
screenshots, local paths and command logs are retained locally under ignored
`.unlazy/qa/`, rather than shipped as public product documentation.
