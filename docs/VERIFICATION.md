# Backend and desktop verification history

For current frontend coverage and release limitations, see [FRONTEND_QA.md](FRONTEND_QA.md).
The measurements below predate the consolidated v2.0.0 frontend baseline; installer evidence
explicitly names the version that was tested.

## Current release audit (23 November 2026)

A release-blocking pass ran against the production build (`4b1faad`) with an
isolated PostgreSQL database.
Current gates: TypeScript, ESLint `src scripts`, 374 files / 5,582 tests,
production build (exit 0, 10 warnings), Prisma validation, a fresh-database
deployment of all 78 migrations (`migrate status` up to date), extension 21 files
/ 318 tests plus build, `cargo check` and `cargo test` (18 passed), and a
dependency audit with 0 vulnerabilities. Browser
evidence: 175/175 local Chromium checks across six drivers, rerun against the
final rebuilt server, including 320–1920px, dark/light, six accents, 200% zoom, reduced
motion, keyboard/focus, onboarding, filters/presets, salary conversion, an
injected FX outage, ranking and ATS/tracking surfaces. The full PASS/FAIL matrix
and remaining blockers are in [FRONTEND_QA.md](FRONTEND_QA.md#release-audit--23-november-2026).

After the audit, the published v2.0.2 installer was installed on Windows 11 x64 with
no prior RoleSpec installation and then exercised as an in-place upgrade from v2.0.1.
Both launches reached `/api/health` 200 and opened the native window; the clean
install ended at 78 migrations, and the upgrade applied the three new migrations
without losing a database marker or the generated secrets file. See
[FRONTEND_QA.md](FRONTEND_QA.md#windows-install-and-upgrade-23-november-2026).

Still **NOT TESTED**: live employer ATS fill/submission, screen-reader or
non-Chromium certification, and load/soak.

Historical pass: 2026-11-12. Workspace: RoleSpec OS on Windows 11 x64, Node
24.18.0, Next.js 16.4.2, PostgreSQL 17 on loopback. It added real provider and
browser evidence; it did not install the rebuilt desktop package or submit an
application.

**Labels used here**

- **VERIFIED** — exercised by the cited automated test, real local HTTP/database
  run, real browser DOM, or real built artifact.
- **FAILED** — incomplete, broken, or true only in a narrower case than claimed.
- **NOT TESTED** — no honest runtime evidence yet; unit coverage may exist, but
  it is not end-to-end evidence.

A green unit suite is not treated as proof of a live external integration.

## Gate summary

| Area | Result | Evidence |
| --- | --- | --- |
| TypeScript | VERIFIED | `npx tsc --noEmit` exit 0 after the terminal-guard fix |
| Focused workflow tests | VERIFIED | `workflow-engine.test.ts`, 15 tests, exit 0; includes the terminal-run guard |
| ESLint | VERIFIED | `npx eslint src --max-warnings=0` exit 0 |
| Root tests | VERIFIED | Current: 374 files, 5,582 tests, exit 0. Historical pass: 332 files, 5,107 tests |
| Extension tests | VERIFIED | 21 files, 318 tests, exit 0 |
| Extension build | VERIFIED | Vite build, exit 0; sidepanel and background bundles emitted |
| Production build | VERIFIED | `npm run build`, exit 0; all routes compiled |
| Prisma schema | VERIFIED | `npx prisma validate` exit 0; expected `SetNull` warnings only |
| Migrations | VERIFIED | Fresh disposable database: `npx prisma migrate deploy` applied all 78 migrations and preserved the legacy audit/license tables; `migrate status` up to date |
| Rust desktop shell | VERIFIED (compile/tests) | `cargo check` exit 0; `cargo test` 18 passed |
| Desktop resource staging | VERIFIED | fresh `npm run desktop:build` produced a 174.0 MB app bundle, Node 88.2 MB and Prisma CLI 210.8 MB |
| Windows NSIS installer | VERIFIED (artifact only) | `RoleSpec_1.0.5_x64-setup.exe`, 104.94 MiB, SHA-256 `6B8879A7…0285AA09`, version 1.0.5, CompanyName Chryypt, signature `NotSigned` |
| Agent-assisted live run | VERIFIED | Real Codex CLI provider; development and production-build runs completed all required steps |
| AI-disabled manual workflow | VERIFIED | Real PostgreSQL; 11/11 steps completed across two processes, one `RUN_COMPLETED`, no AI call or automation side effect |
| AI-disabled assisted fail-closed | VERIFIED | Keyless provider: deterministic `RESEARCH` fallback, non-retryable `TAILOR` failure, run `FAILED`, no draft/submission |
| Cancel and restart recovery | VERIFIED | Dead lease reclaimed, completed output preserved, interrupted attempt refunded, cancellation preserved completed state |
| Provider package resolution | VERIFIED | `npm install` restored the lockfile-pinned `ai-sdk-provider-codex-cli@2.4.0`; dynamic import succeeds |
| Live ATS discovery/plan | VERIFIED | Real public Lever application HTML: 24 fields, 6 safe fills, 18 review fields (13 sensitive), no submit action |
| Live ATS fill/attachment | NOT TESTED | No value was written to an employer page; no resume was uploaded |
| Windows install/upgrade | VERIFIED | v2.0.2 clean install and v2.0.1 → v2.0.2 upgrade on Windows 11 x64: 78 migrations, marker/secrets preserved, uninstall kept data; installer unsigned |
| Performance/load | PARTIAL | Synthetic ranking/qualification baseline and 25 HTTP reads; no soak, concurrency or multi-process test |

## Provider-backed workflow evidence

The installed global AI setting was pointed at the local `codex-cli` provider
with model `gpt-6.1-sol`. This is a real provider call, not a mock.

### Failure path first

An earlier run used the default `claude-code` provider, which was not logged in.
The first attempt produced:

```text
Not logged in · Please run /login
```

The `TAILOR` step retried twice, then failed with `AI tailoring failed. Please
try again.` and the manual fallback. No draft resume, no staged application and
no submission were written. This confirms the bounded-retry and fail-closed
provider path.

### Development server run

After the provider was configured, a fresh workflow on a real tracked
application completed `PROFILE → DISCOVER → RANK → RESEARCH → TAILOR → VALIDATE
→ PREPARE_ATS`, paused at `HUMAN_REVIEW`, resumed after an explicit
`{approved: true}`, and finished `SUBMISSION_STAGING → TRACKING → FOLLOW_UP`.

Observed:

- Final run state `COMPLETED`; 33 append-only events.
- `TAILOR` used two generation attempts, produced one evidence-referenced claim,
  `validationStatus: PASS`, zero errors and zero warnings.
- The created resume was a `DRAFT` with `sourceResumeId` set to the original.
- The source snapshot hash was recorded; source version was 1.
- `HUMAN_REVIEW` was resolved explicitly; the staged output reported
  `submitted: false`.
- `TRACKING` kept the application at `INTERESTED`; nothing was submitted.

### Production-build run

A second fresh workflow ran through `npm start` from the production build, not
`next dev`, with the same provider. It also reached `AWAITING_REVIEW` and
completed after the same explicit approval.

Observed:

- Final state `COMPLETED`; all eleven steps `COMPLETED`.
- `VALIDATE`: `PASS`, one claim, four evidence references.
- `PREPARE_ATS`: nine safe form fields, five sensitive questions preserved for
  the user (`workAuthorization`, `sponsorship`, `salaryExpectation`,
  `demographics`, `legalHistory`).
- `SUBMISSION_STAGING`: one `SubmissionAttempt` staged with the tailored resume,
  rank score, validation status and blocked-question count.
- `TRACKING`: application status `INTERESTED`; `submittedByWorkflow: false`.
- `FOLLOW_UP`: a recommended date is returned; nothing is sent.

Both runs exercised the real `generateObject`/`generateText` provider path,
database persistence, review-task resolution and post-approval staging. They did
not prove pause/cancel mid-provider-call, restart recovery under load, or a live
AI-free journey; those are covered separately below and by tests.

## AI-disabled, cancel and restart walk (2026-11-13)

This walk used the real PostgreSQL database and the workflow service/worker, not
a mock. The fixture had a master resume, a tracked posting and one application
per scenario; rows were removed after evidence capture.

**AI-free end-to-end (manual mode).** With the user's AI setting pointed at a
provider with no key, a `MANUAL` run completed `PROFILE`, `DISCOVER`, `RANK` in
one process, then the remaining eight steps in a second process. Result:
`COMPLETED`, every step `COMPLETED` with `{ manual: true }`, exactly one
`RUN_COMPLETED`, and 11 `STEP_COMPLETED` events. No tailoring run, submission
attempt or review task was created; the application stayed `INTERESTED` with
`dateApplied: null`. A further `COMPLETE_STEP` was rejected with
`INVALID_TRANSITION`, so a finished run cannot be mutated.

**AI-disabled assisted path.** With a keyless provider, an `AGENT_ASSISTED` run
completed `PROFILE`, `DISCOVER`, `RANK` and `RESEARCH`; research degraded to the
deterministic layer and reported that no source was verified. `TAILOR` failed
once, non-retryably, with `Add your API key in Settings → AI to use AI
features.` The run became `FAILED`; zero tailored resumes, submission attempts
or review tasks were created, and the application stayed unchanged. This is
fail-closed by design: the manual path remains available, and the assisted
pipeline is not claimed to complete without AI.

**Crash recovery.** A real assisted run had `PROFILE` committed and `RANK` left
`RUNNING` under an expired lease owned by `crashed-worker`. A fresh process called
`recoverExpiredLeases`: it reclaimed one run, cleared the lease, kept the
`PROFILE` output, reset `RANK` to `PENDING`, refunded its interrupted attempt
(`attempts: 0`) and wrote `LEASE_RECLAIMED`. Cancelling the recovered run then
left the completed output intact and marked only unfinished steps `CANCELLED`.
A separate manual run cancelled after a process restart also preserved its
completed `PROFILE` step.

The remaining unexercised case is a cancel during an actual provider call; this
walk cancelled after lease recovery, not mid-generation.

### Essay drafting

A live `POST /api/extension/essay-draft` request took 17.5 seconds and returned a
100-word draft from the selected resume. `reviewRequired` was `true`,
`autoFill` was `false`, and `unsupportedNumbers` was empty. Nothing was written
to a preparation or a form.

## Live ATS discovery and plan

On 2026-11-12 a real public Lever demo application page was fetched and loaded
into jsdom. The extension's production `scanAutofillFields()` and
`buildFillPlan()` code was run against that DOM, not a hand-written fixture.

| Measure | Result |
| --- | --- |
| Discovered fields | 24 |
| Safe profile fills | 6: full name, email, phone, LinkedIn, GitHub, website |
| Review fields | 18 |
| Sensitive review fields | 13 (document, authorization, demographic) |
| Submit actions | 0; the scanner and fill path contain no submit/click call |

The plan correctly refused to auto-fill work authorization, sponsorship,
demographic, EEO and resume-upload controls. The discovered adapter was Lever
with `formFilling: verified-fixture`.

This verifies classification and planning on a real employer-shaped DOM. It does
**not** verify writing values, dynamic validation, a live file upload or the
manual file-selection fallback on an employer page. Those remain NOT TESTED.

## Desktop packaging

The desktop runtime was rebuilt from the current source:

```text
npm run desktop:build   # fresh .next-desktop build + staged resources
cargo check             # exit 0
cargo test              # 18 passed
npx @tauri-apps/cli@^2 build --bundles nsis
```

The NSIS build completed from current staged resources:

- Artifact: `desktop/src-tauri/target/release/bundle/nsis/RoleSpec_1.0.5_x64-setup.exe`
- Size: 104.94 MiB
- File/product version: 1.0.5
- CompanyName: Chryypt; ProductName: RoleSpec
- Signature: `NotSigned`

This is build evidence, not install evidence. No clean-VM install, in-place
upgrade, first launch, restart or uninstall was performed. Windows may warn or
block the unsigned installer.

## Performance baseline

Synthetic, single-process, warm-up plus three measured runs:

| Path | Pool | Best | Throughput |
| --- | --- | --- | --- |
| `rankJobPool` (BM25 + seven factors) | 1,000 postings | 357 ms | ~2,800 postings/s |
| `rankJobPool` | 5,000 postings | 1,861 ms | ~2,686 postings/s |
| `qualifyCandidate` (deterministic discovery) | 1,000 postings | 564 ms | ~1,772 postings/s |
| `qualifyCandidate` | 5,000 postings | 3,007 ms | ~1,663 postings/s |
| `GET /api/workflows/:id` | production build, 25 requests | p50 8.5 ms, p95 23.3 ms | — |

The postings were synthetic, with 60-sentence descriptions and a 40-capability
profile. These numbers are a regression baseline, not a capacity guarantee.
No concurrent workflow ticks, provider stalls, large resume pools or database
contention were measured.

## Data, security and recovery checks

- Cross-origin `POST /api/workflows` returned `403 FORBIDDEN`; same-origin and
  no-Origin local calls were accepted.
- Bearer authentication and owner scoping are exercised by the ATS, workflow,
  submission, follow-up, outreach and intake suites.
- A real export service call returned 31 collections including
  `submissionAttempts`, `followUpTasks`, `outreachSequences`,
  `rankingSnapshots`, tailoring history, workflow runs and review tasks.
  A defect found in this pass — `RankingSnapshot` rows were omitted from the
  export — was fixed and re-checked.
- ATS answer values are stored as `enc.v1.*` envelopes; legacy plaintext rows
  remain readable and are re-encrypted on edit. Export decrypts answer values
  and replaces unreadable ciphertext with `{unreadable: true}` rather than
  leaking ciphertext as an answer.
- Confirmed submissions are one-way. `submitted: false` after `SUBMITTED`
  returns `409 TERMINAL`; the tracker is not downgraded.
- Follow-up and outreach completion are user reports. No outbound transport
  exists in either service.
- The active-workflow duplicate guard is now a PostgreSQL partial unique index
  (`workflow_runs_one_active_per_application`), not only a serial pre-check.
- The workflow lease, attempt fencing, abort signal, restoration of interrupted
  attempts and bounded recovery are covered by tests. Restart recovery under a
  real crash loop was not exercised in this pass.

## Feature ledger

This is the audit summary of verified workflow capabilities and intentional product boundaries.

| Capability | Label | Evidence |
| --- | --- | --- |
| F14 discovery AI confidence | VERIFIED | Unit tests cover optional grounded rerank and fallback; live workflow used deterministic discovery, so the live AI rerank path itself is not claimed |
| F22 per-stage provider routing | VERIFIED | Stage-settings service/route tests; live Tailor calls used the configured provider |
| F24 anti-fabrication validator | VERIFIED | Unit suite plus two live tailored drafts with `PASS` validation |
| F25 banned-cliché rejection | VERIFIED | Deterministic claim-validator tests |
| F27 single-page PDF | VERIFIED | Real PDF page-count tests; no live export was repeated in this pass |
| F32 encrypted ATS answers | VERIFIED | Answer-crypto tests, ATS service tests, export decryption check |
| F33 essay drafts | VERIFIED | Live endpoint returned a grounded draft with mandatory review |
| F35 submission staging | VERIFIED | Live production staging created a `SubmissionAttempt`; unit tests cover confirmation and terminal rules |
| F37 review queue | PARTIAL | Extension queue and server rows verified; no web screen |
| F41/F42/F44 follow-ups | VERIFIED | Service and route tests; live staging created the `SubmissionAttempt` whose confirmation schedules the tasks. No live submission was confirmed, so no live follow-up task was created |
| F45 outreach sequences | VERIFIED | Service and route tests; no send path |
| F46 leaderboard | PARTIAL | Persisted snapshot and API verified; no dashboard UI |
| F49/F50 hosted/3D exclusions | NOT PORTED | Deliberate product boundaries |
| F55 live ATS fill | PARTIAL | Real Lever discovery/plan verified; live fill/upload NOT TESTED |
| F60 one-click auto-submit | MISSING | Deliberately excluded by the no-silent-submit invariant |

## Remaining blockers and honest limits

1. **No first-party workflow or review UI.** This pass deliberately did not
   build UI; the API is ready and documented in
   [API_CONTRACTS.md](API_CONTRACTS.md). This is a historical observation;
   `/workspace?view=runs` and `/review` are present in the v2.0.0 baseline. See
   [FRONTEND_QA.md](FRONTEND_QA.md) for subsequent frontend verification.
2. **Live employer ATS fill and resume attachment are not verified.** The live
   Lever result covers discovery and planning only. Dynamic fields, file upload,
   validation errors and the manual file-selection fallback need a real page.
3. **No clean-VM install or upgrade.** The installer was rebuilt and inspected,
   but not installed. It remains unsigned, so SmartScreen/Smart App Control may
   block it; Authenticode signing and reputation are separate from updater
   signatures.
4. **No production load or soak test.** The benchmark is single-process and
   synthetic. Workflow tick contention, lease recovery under a real crash,
   provider stalls and large-database behavior are not measured.
5. **AI-free and failure journeys.** The AI-free manual workflow, the
   AI-disabled assisted fail-closed path, expired-lease recovery and
   cancellation were walked live on 2026-11-13. A cancel during an actual
   provider call and multi-process recovery under load remain untested.
6. **Some seeded postings use `example.com`.** They are test data, not evidence
   of external board coverage.
7. **Single-owner only.** No multi-tenant isolation, hosted billing or account
   tiers were added, and none should be inferred from the API surface.

## Fixes landed while closing the audit gaps

The implementation work before this pass landed the substantive fixes; the
commit history is the source of truth. This pass added one data-export fix:

| Defect | Fix | Regression evidence |
| --- | --- | --- |
| Account export omitted `RankingSnapshot` rows after leaderboard history was added | Include `rankingSnapshots` in the export type, query, destructuring and response | Real export service call now returns 31 collections with `rankingSnapshots`; typecheck passes |
| A finished manual run accepted another `COMPLETE_STEP` and appended a second `RUN_COMPLETED` | Reject manual completion on `COMPLETED` or `CANCELLED` runs | Live walk now records one `RUN_COMPLETED`; workflow-engine test asserts `INVALID_TRANSITION` |

Previously landed and re-checked here: encrypted ATS answers, durable
business-day follow-ups, per-stage AI routing, deterministic cliché rejection,
discovery AI confidence, durable `SubmissionAttempt` records, outreach
sequences, essay drafting, restored LinkedIn rating, database active-run guard,
workflow attempt fencing, abort signals, atomic intake apply and crash-recovery
bounding.

## Reproduce

```bash
npx prisma validate
npx prisma migrate status
npx tsc --noEmit
npx eslint src --max-warnings=0
npx vitest run
npm run build
cd extension && npm test && npm run build
cargo check --manifest-path desktop/src-tauri/Cargo.toml
cargo test --manifest-path desktop/src-tauri/Cargo.toml
npm run desktop:build
```

The live HTTP checks used the production build on `http://localhost:3100` with
the local PostgreSQL database, an owner-scoped bearer token and the explicitly
configured Codex CLI provider. No production deployment or employer account was
touched, and no application was submitted.
