# Verification and release-readiness audit

Audited: 2026-11-11. Workspace: `E:/Github/rolespec-os` (Windows 11, Node
24.18.0, Next.js 16.4.2, PostgreSQL 17 on localhost:55432). No AI provider call
was made for this audit. No installer was built or upgraded.

**Labels used here**

- **VERIFIED** — the claimed behavior was exercised by the cited automated test
  or by a real local HTTP/database run in this audit.
- **FAILED** — the claimed behavior is incomplete, broken, or only true in a
  narrower case than the claim.
- **NOT TESTED** — no honest runtime evidence exists yet; unit coverage may
  exist, but it is not end-to-end evidence.

A green unit suite is not treated as proof of a live external integration. The
feature matrix in [FEATURE_PARITY.md](FEATURE_PARITY.md) remains the detailed
source for the Recruitt comparison.

## Gate summary

| Area | Result | Evidence |
| --- | --- | --- |
| TypeScript | VERIFIED | `npx tsc --noEmit` exit 0 |
| ESLint | VERIFIED | `npm run lint` exit 0 |
| Root tests | VERIFIED | 5,023 tests in 322 files, exit 0 |
| Extension tests | VERIFIED | 318 tests in 21 files, exit 0 |
| Extension build | VERIFIED | `npm run build` in `extension/`, exit 0 |
| Production build | VERIFIED | `npm run build` (Prisma generate + Next build), exit 0 |
| Focused security/research/tailoring tests | VERIFIED | Covered by the full 5,023-test run; targeted reruns also passed |
| Prisma schema | VERIFIED | `npx prisma validate` exit 0; two pre-existing `SetNull` warnings |
| Migrations | VERIFIED | `npx prisma migrate deploy` applied all 4 new migrations; `migrate status` reports up to date |
| Rust desktop shell | VERIFIED (compile only) | `cargo check --manifest-path desktop/src-tauri/Cargo.toml` exit 0 |
| Manual workflow API | VERIFIED | Real local server + PostgreSQL; start and 11 manual step completions produced `COMPLETED` |
| Active-run duplicate guard | VERIFIED | First workflow create `201`; second active create `409 CONFLICT` |
| Cross-origin workflow mutation | VERIFIED | `Origin: https://evil.example` returned `403`; same-origin `201` |
| Data export completeness | VERIFIED | Real export contained `intakeRuns`, `workflowRuns`, `reviewTasks`, `atsPreparations`, `atsAnswers`, tailoring history, activity and AI usage keys |
| Agent-assisted live run | NOT TESTED | Worker is covered by unit tests; no real provider-backed run was executed |
| Live ATS filling | NOT TESTED | Maintained fixtures only; no employer account was used |
| Windows installer/upgrade | NOT TESTED | No installer was built, signed, installed or upgraded |
| Performance/load | NOT TESTED | No concurrency or large-corpus benchmark was run |

## Recruitt capability ledger

The matrix rows below were re-read against the implementation. Matrix statuses
are from [FEATURE_PARITY.md](FEATURE_PARITY.md); the audit label applies the
three-label rule above.

| ID | Capability | Matrix | Audit label | Why |
| --- | --- | --- | --- | --- |
| F01 | Six intake adapters in one profile | Implemented | VERIFIED | Adapter registry, run DTO and SSE tests pass |
| F02 | Resume PDF facts | Implemented | VERIFIED | PDF/DOCX extraction and import tests |
| F03 | LinkedIn profile intake | Implemented | VERIFIED | Export-only adapter; no login-wall bypass |
| F04 | GitHub intake | Implemented | VERIFIED | Public GitHub scan and mapping tests |
| F05 | Personal site intake | Implemented | VERIFIED | SSRF-fetched page and mapping tests |
| F06 | Chat intake | Implemented | VERIFIED | Deterministic extraction and preview route |
| F07 | Voice intake | Implemented | VERIFIED | Transcript/text adapter, text fallback |
| F08 | Per-fact provenance | Implemented | VERIFIED | Patch provenance and apply tests |
| F09 | Merge with conflict handling | Implemented | VERIFIED | Fingerprint, conflict and apply tests |
| F10 | ATS/board ingestion | Implemented | VERIFIED | Read-only adapters and normalization tests |
| F11 | Normalize/dedupe postings | Implemented | VERIFIED | Canonical URL and unique index |
| F12 | Score role against profile | Implemented | VERIFIED | Deterministic qualification tests |
| F13 | BM25 ranking | Implemented | VERIFIED | Real BM25 and ranking route tests |
| F14 | LLM confidence in discovery | Partial | FAILED | Discovery does not call AI; only saved-job rerank exists |
| F15 | Top-40 leaderboard/cutoff | Partial | FAILED | API cutoff exists; no dashboard leaderboard |
| F16 | Board search links | Implemented | VERIFIED | Link derivation tests |
| F17 | Fit badges | Implemented | VERIFIED | Extension badge tests |
| F18 | Job requirements | Implemented | VERIFIED | Deterministic requirement tests |
| F19 | Company research | Implemented | VERIFIED | Grounded research service tests |
| F20 | Culture layer | Implemented | VERIFIED | Three-layer research tests; no UI block |
| F21 | Citations for stored facts | Implemented | VERIFIED | Verified-source filtering and citations |
| F22 | Provider per stage | Partial | FAILED | Provider choice is per user, not per stage |
| F23 | Tailored resume | Implemented | VERIFIED | Manual and workflow tailoring tests |
| F24 | Anti-fabrication validator | Implemented | VERIFIED | Claim validator and workflow revalidation tests |
| F25 | Banned-cliché enforcement | Partial | FAILED | Prompt-only; no deterministic post-check |
| F26 | Keyword coverage | Implemented | VERIFIED | Evidence map and report tests |
| F27 | Single-page PDF | Implemented | VERIFIED | Real PDF page-count tests |
| F28 | Bounded repair then fail | Implemented | VERIFIED | Three-generation cap tests |
| F29 | ATS field discovery/classification | Implemented | VERIFIED | Server classifier and extension fixtures |
| F30 | Safe factual fill | Implemented | VERIFIED | Preview/confirm and no-choice-fill tests |
| F31 | Sensitive review queue | Implemented | VERIFIED | Persistent task tests |
| F32 | Reusable approved answers | Partial | FAILED | Reuse works; answer rows are not encrypted at rest |
| F33 | AI essay drafts | Missing | FAILED | No draft endpoint/UI; essays are review-only |
| F34 | Tailored resume upload | Partial | FAILED | Attach/fallback exists; live employer page not verified |
| F35 | Submission staged with evidence | Partial | FAILED | AtsPreparation exists; no generic SubmissionAttempt/evidence route |
| F36 | Submit gated/dry-run | Implemented | VERIFIED | No-submit and submit-guard tests |
| F37 | Review queue as surface | Partial | FAILED | Extension queue exists; no web review screen |
| F38 | Specific task, not workflow abort | Implemented | VERIFIED | Waiting checkpoint and ATS task tests |
| F39 | Approve once, reuse answer | Implemented | VERIFIED | Approval, conflict, replacement and revoke tests |
| F40 | Application audit trail | Implemented | VERIFIED | Status events and workflow events |
| F41 | Email follow-up +5 business days | Partial | FAILED | Calendar-day advice only; no automatic schedule |
| F42 | LinkedIn follow-up +12 business days | Missing | FAILED | No channel or schedule |
| F43 | Manual follow-up trigger | Implemented | VERIFIED | Draft service/action and UI panel |
| F44 | Automatic schedule on APPLIED | Partial | FAILED | `followUpAt` is user-set; no automatic task |
| F45 | Outreach first-class workflow | Partial | FAILED | Drafting exists; no sequence/schedule/contact record |
| F46 | Dashboard leaderboard | Partial | FAILED | Sort/filter exists; no tailoring leaderboard |
| F47 | Command palette | Implemented | VERIFIED | Component and navigation tests |
| F48 | Guided onboarding | Implemented | VERIFIED | Wizard and AI setup tests |
| F49 | 3D agent room | Not ported | NOT TESTED | Deliberate presentation exclusion; no runtime claim |
| F50 | Hosted multi-tenant/pricing | Not ported | NOT TESTED | Deliberate single-owner exclusion |
| F51 | Never fabricate qualifications | Implemented | VERIFIED | Grounding and fail-closed tailoring tests |
| F52 | Never silently submit | Implemented | VERIFIED | No submit path; extension submit guard |
| F53 | Missing info becomes a task | Implemented | VERIFIED | Profile/tailor/human-review tests |
| F54 | Restricted access fallback | Implemented | VERIFIED | Site-access grant and manual path |
| F55 | Validated Greenhouse/Lever fill | Partial | FAILED | Fixture-tested only; no live employer page |
| F56 | Replayable traces | Roadmap-only | NOT TESTED | Durable events exist; replay UI does not |
| F57 | Confidence-gated auto-submit | Roadmap-only | NOT TESTED | Deliberately excluded |
| F58 | Outreach scheduling workflow | Roadmap-only | NOT TESTED | Not built |
| F59 | Hosted paid tiers | Roadmap-only | NOT TESTED | Not built |
| F60 | One-click auto-submission | Missing | NOT TESTED | Deliberately excluded |

## What was actually exercised

### Real local workflow run

A temporary application was created through `POST /api/applications`, then:

- `POST /api/workflows` with `mode: MANUAL` returned `201` and eleven steps.
- A repeated create with the same idempotency key returned the same run id.
- A cross-origin create returned `403 FORBIDDEN`.
- `POST /api/workflows/:id/advance {action:"START"}` returned `MANUAL` with a
  start timestamp.
- All eleven `COMPLETE_STEP` calls returned `200`; `TRACKING` moved the run to
  `COMPLETED`, and `FOLLOW_UP` was recorded without changing that terminal state.
- `GET /api/workflows/:id/events` returned the append-only `RUN_CREATED`,
  `RUN_STARTED` and `STEP_COMPLETED` history.
- A second active workflow for the same application returned `409 CONFLICT`.
- The temporary application was deleted and the audit activity rows were removed
  from the local database.

This proves the manual compatibility layer, persistence and API contract, not
the agent-assisted provider path.

The run was repeated after the audit fixes (workflow claim fencing, review-task
rate limiting, ATS submission one-way rule, rerank coverage rule, save
serialization and SSRF parsing): a fresh application returned `201`, a manual
workflow returned `201`, a second active workflow returned `409 CONFLICT`, all
eleven `COMPLETE_STEP` calls returned `200`, the final run state was `COMPLETED`,
the event tail contained `RUN_CREATED`, `RUN_STARTED` and `STEP_COMPLETED`, and
the temporary application was deleted with `200`. The server was stopped and
port 3100 was confirmed free afterwards.

### Real migrations and data retention

The four phase migrations were applied to the existing local PostgreSQL database
with `npx prisma migrate deploy`:

```text
20261111150000_add_intake_runs
20261111170000_add_workflow_runs
20261111190000_add_resume_tailoring_provenance
20261111210000_add_ats_preparation
```

`npx prisma migrate status` then reported `Database schema is up to date!`.
`GET /api/applications` still returned the pre-existing tracked application after
the migration, and `GET /api/account/export` returned a valid JSON object with the
new owned collections. This is evidence for additive upgrade, not a clean-install
or signed-installer test.

### Security checks

- Owner scoping is exercised by the route, ATS, workflow and intake suites.
- A real cross-origin `POST /api/workflows` was refused with `403`.
- The SSRF guard and web-presence tests pass; private, loopback, link-local,
  reserved, redirect and DNS-rebinding cases are covered.
- Prompt-injection fences and the prompt-injection suite pass.
- API tokens store only a SHA-256 hash; revocation/expiry checks pass.
- ATS review/preparation responses now carry `Cache-Control: private, no-store`;
  both SSE routes use `no-store`.
- Logs redact credential-shaped keys and text; tests pass.

### Fixes made during this audit

| Defect | Fix | Regression evidence |
| --- | --- | --- |
| Pausing a running workflow consumed its only attempt, so resuming immediately failed | Refund the attempt when the commit guard discards a running step | New workflow test resumes after a pause and completes |
| `RESUME` accepted a `FAILED` run without resetting failed steps | Resume is now `PAUSED`-only; `RETRY` owns failed runs | Workflow tests, API contract update |
| Intake cancellation aborted an unused controller and could resurrect a cancelled source | Link the run abort signal to each source; claim sources conditionally; mark unexpected run failures | Intake service and route tests |
| A dropped ATS field left its review task open forever | Expire stale open tasks on rescan | New ATS service test |
| ATS answer conflict created a task but left preparation status stale | Move the preparation to `READY_FOR_REVIEW` on conflict | ATS tests |
| ATS review route let `AtsError` become a 500 | Map ATS errors to 400/404/409 | Typecheck and route tests |
| Two active workflows could be created for one application | Serial active-run guard returns `409 CONFLICT` | Real API test: 201 then 409 |
| Machine-readable export omitted intake/workflow/review/ATS/tailoring/activity/AI-usage data | Include every new owned collection | Real export key check |
| Extension owner responses could be cached | `private, no-store` on profile, resume, outreach and ATS responses | Build + route tests |
| Staged ATS source URL could retain credential-shaped query parameters | Redact the URL before persistence | Typecheck and ATS tests |
| A completed ATS submission could be reverted to `NOT_SUBMITTED`, leaving the tracker on `APPLIED` without a matching history row | Make confirmed submission one-way; corrections belong in the tracker | ATS service test now asserts `TERMINAL` and unchanged tracker |
| Reusing a question counted both a global and an application-scoped answer | Count only the answer that actually wins precedence | Typecheck; targeted ATS suite |
| An LLM rerank that omitted a shortlisted posting still reordered the others | Treat incomplete coverage as no rerank and retain deterministic order | Rerank regression test |
| A stale workflow attempt could commit over a resumed/reclaimed attempt | Fence every step commit on the attempt's `startedAt` claim token | Workflow engine pause/resume tests |
| Web review-task routes had no rate limit | Add an owner-keyed `review:web` bucket | Route/typecheck; no dedicated route test |
| Error objects in logs kept credential-shaped substrings in `message` | Route `Error.message` through secret-text redaction | Logger regression test |
| IPv4-mapped IPv6 forms such as `::ffff:7f00:1` passed the SSRF address check | Parse IPv6 to bytes and unwrap mapped, compatible, NAT64 and 6to4 forms | Web-presence address tests |
| Two tabs could interleave section-item writes and the version bump | Claim the resume revision by `updatedAt` and write items plus revision in one transaction | Save tests, including a lost-race case |

## Remaining FAILED / blockers

1. **LinkedIn rating UI has no backend.** `src/features/linkedin/hooks/use-linkedin.ts`
   calls `/api/linkedin/rating`, which returns `404 FEATURE_DISABLED`. Either
   restore the route or hide the rate controls; this audit did not choose a
   product direction.
2. **No workflow UI.** `src/app/api/workflows` is complete enough to integrate,
   but no page calls it. Manual mode is only reachable by HTTP today.
3. **No web review queue.** `GET /api/review-tasks` and the extension panel exist;
   a web `/workspace/review` screen does not.
4. **No generic submission record.** `AtsPreparation` stages the extension flow
   and `WorkflowStep.output` stages the agent flow, but there is no shared
   `SubmissionAttempt` table or evidence route.
5. **ATS answers are not encrypted at rest.** They are owner-scoped, omitted from
   plans/logs and revocable, but a local database reader can see values.
6. **Follow-ups are advice.** The schedule service uses calendar days, does not
   create a durable +5/+12 business-day task, and has no LinkedIn channel.
7. **Agent-assisted execution is unit-tested, not live-tested.** A real provider
   run, provider fallback under failure, and a real pause/cancel mid-provider call
   remain NOT TESTED.
8. **Live ATS and desktop installer remain unverified.** Fixtures are not a live
   employer form; `cargo check` is not installer packaging or a Windows upgrade.
9. **No performance/load evidence.** The audit did not benchmark large intake,
   ranking or workflow pools.
10. **Serial duplicate guard has a race.** Two simultaneous creates can both pass
   the pre-check. A database-level active-run constraint would be required for a
   strict guarantee.
11. **Intake application is not one transaction.** Applying a patch writes the
   profile/evidence row and then the `IntakePatch` status in separate statements.
   A crash between them can leave a profile fact with a `PENDING` patch; retrying
   detects the collision rather than duplicating it, but the audit trail is
   briefly inconsistent. Wrapping the per-kind write and `markApplied` in one
   transaction is the next fix.
12. **Workflow timeouts bound the commit, not the executor's side effects.**
   Executors receive an `AbortSignal` but the current services do not consume
   it. A provider call that ignores the deadline can keep running after the step
   is marked failed; its later DB writes are not fenced by the workflow commit
   guard. Threading the signal through provider calls and every persistence
   boundary remains NOT TESTED.
13. **Crash recovery refunds the interrupted attempt.** This is deliberate so a
   crash with `maxAttempts: 1` does not permanently fail the step, but a
   deterministic crash loop can retry indefinitely until the user cancels. A
   recovery counter or a no-refund policy would make the loop bounded.

## Reproduce

```bash
npx prisma validate
npx prisma migrate status
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
cd extension && npm test && npm run build
cargo check --manifest-path desktop/src-tauri/Cargo.toml
node scripts/verify-parity-docs.mjs G1
# ... through G11
```

The real API checks were run against a local production server started with
`ROLSPEC_ACCESS_MODE=local PORT=3100 npm start`, with the four migrations applied.
No production deployment or external account was touched.
