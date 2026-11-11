# Implementation plan

Updated: 2026-11-11. Dependency-ordered work to close the gaps in
[FEATURE_PARITY.md](FEATURE_PARITY.md) without changing RoleSpec's manual
workflow, single-owner model, PostgreSQL schema or AI-optional posture.

## Dependency order

```text
P0  Guardrails and test harness
 └─▶ P1  Durable workflow + review substrate
      ├─▶ P2  Intake + provenance
      │    └─▶ P3  Ranking (BM25 + optional AI confidence + leaderboard)
      ├─▶ P4  Research + tailoring hardening
      └─▶ P5  Server review + approved answers + autofill sync
           └─▶ P6  Submission staging + follow-up automation
                └─▶ P7  Outreach, chat intake, product surface
                     └─▶ P8  Hardening, migration and release verification
```

Every phase is additive. No phase may require Convex, Redis, a separate worker
daemon, a new database, a headless browser, or an automatic submission.

## Coverage map

Every feature that is not `Implemented`, `Not ported` or `Roadmap-only` has a
phase here.

| Feature | Phase | Feature | Phase |
| --- | --- | --- | --- |
| F15 | P3 | F20 | P4 |
| F22 | P4 | F24 | P4 |
| F13 | P3 | F26 | P4 |
| F27 | P4 | F25 | P4 |
| F14 | P3 | F28 | P4 |
| F32 | P5 | F34 | P6 |
| F33 | P7 | F35 | P6 |
| F53 | P5 | F39 | P5 |
| F37 | P5 | F38 | P5 |
| F41 | P6 | F42 | P6 |
| F44 | P6 | F45 | P7 |
| F46 | P3 | F55 | P8 (live vendor verification) |
| F60 | P8 (policy: not implemented) | | |

## Phase P0

**Goal:** make the later phases safe to land. Feature-flag the new surfaces, fix
the test seams, and record the baseline so a regression is visible.

**Files:**
- `docs/FEATURE_PARITY.md`, `docs/ARCHITECTURE.md`, `docs/RESEARCH.md`,
  `docs/API_CONTRACTS.md`, `docs/WORKFLOW_STATES.md` (already written)
- `src/shared/lib/flags.ts` — new: typed server-only flags, default off
- `src/shared/lib/flags.test.ts` — new
- `src/shared/lib/prisma.ts` — read only; confirm the existing adapter and
  connection behavior before adding transactions
- `vitest.config.ts` — read only unless a new test root is needed

**Tests:** flag resolution defaults to off in production and test; an unknown
flag name fails typecheck; no flag changes an existing behavior when off.

**Exit criteria:** `npx tsc --noEmit` passes; `npm test` passes; every new flag
defaults off; a rollback is one flag or one migration, with no data loss.

## Phase P1 — delivered 2026-11-11

**Goal:** a durable, resumable run that can pause for a human. This is the
substrate every later phase uses. **Delivered.**

**Files:**
- `prisma/schema.prisma` — `WorkflowRun`, `WorkflowStep`, `WorkflowEvent`,
  `ReviewTask` and their enums
- `prisma/migrations/20261111170000_add_workflow_runs/migration.sql` — additive
  tables, enums, indexes, cascades and the `(userId, jobApplicationId)` relation
- `src/features/workflows/types.ts` — run, step, event, review and executor types
- `src/features/workflows/pipeline.ts` — dependency-ordered eleven-step definition
- `src/features/workflows/services/workflow.service.ts` — create, read, list,
  review history, transitions and review resolution
- `src/features/workflows/services/workflow-worker.ts` — conditional claim, lease,
  renewal, retry/backoff, commit guard, finalize and restart recovery
- `src/features/workflows/services/schedule.ts` — request-scoped first tick
- `src/features/workflows/executors/*.ts` — eleven real step implementations
- `src/app/api/workflows/route.ts`, `[id]/route.ts`, `[id]/advance/route.ts`,
  `[id]/events/route.ts`, `[id]/stream/route.ts`
- `src/app/api/review-tasks/route.ts`, `src/app/api/review-tasks/[id]/route.ts`
- `src/instrumentation.ts` — starts the loop once per server process
- `src/shared/lib/logger.ts` — text redaction for stored failure messages
- `src/features/workflows/__tests__/workflow-engine.test.ts`,
  `src/features/workflows/executors/__tests__/*`,
  `src/app/api/workflows/__tests__/route.test.ts`

**Deviations from the original sketch (recorded, not hidden):**
- There is no `actions/workflow.actions.ts`; the typed API routes are the
  frontend contract, and every mutation goes through the same service.
- The claim is a conditional `updateMany` on `(id, state, lease)`, not raw
  `FOR UPDATE SKIP LOCKED`. It has the same one-owner guarantee for one row and
  works through the existing Prisma client in the packaged runtime.
- The step key is the unique `(runId, name)` with
  `idempotencyKey = ${runId}:${stepName}`; there is no `inputHash` column.
- A recovered `RUNNING` step has its interrupted attempt refunded, because that
  attempt committed nothing. Deterministic failures still consume an attempt.
- There is no separate `src/features/review` service; `ReviewTask` lives in
  `workflow.service.ts` because its lifecycle is the run's lifecycle.
- `ApprovedAnswer` and `SubmissionAttempt` were not added in this phase; staging
  persists its evidence bundle in `WorkflowStep.output`, and P5 owns those tables.

**Tests:** the suite covers legal and illegal transitions, idempotent create,
full completion, optional-step failure isolation, a real human checkpoint,
declined vs approved checkpoints, pause discarding in-flight output, retry with
backoff, expired-lease reclaim, one-claim ownership, manual step completion,
foreign-owner refusal and route contracts (401/403/400/409/404, schedule calls).

**Exit criteria:** a run can be created, claimed, paused, resumed, failed and
completed with no external daemon; killing the process mid-step and restarting
replays without duplicate side effects; the worker does not start under
`next build` or in tests; the documented transitions match the implemented ones.

## Phase P2 — delivered 2026-11-11

**Goal:** one intake run across six sources, with candidate facts that keep their
source and never self-confirm. **Delivered.** The phase retains its original
place in the order as history; the code now exists and the remaining limits are
listed at the end of this section.

**Files:**
- `prisma/schema.prisma` — `IntakeRun`, `IntakeSourceRun`, `IntakePatch`,
  `IntakeConflict`, `IntakeCorrection`; `CareerEvidenceSource.INTAKE_IMPORT_CANDIDATE`
- `prisma/migrations/20261111150000_add_intake_runs/migration.sql` — additive
tables, enums, indexes and cascades
- `src/features/intake/types.ts` — canonical source, run, patch and adapter types
- `src/features/intake/schemas/intake.schema.ts` — source inputs, patch draft,
  correction and review schemas
- `src/features/intake/lib/patch-fingerprint.ts` — normalization, fingerprints,
  dedupe and contact comparison
- `src/features/intake/lib/parsed-resume-patches.ts` — resume/LinkedIn document
  mapping shared by both document adapters
- `src/features/intake/lib/web-facts-patches.ts` — GitHub/portfolio mapping
- `src/features/intake/services/intake-run.service.ts` — create, parallel
  execution, progress, dedupe, cancel, retry, list/read
- `src/features/intake/services/intake-apply.service.ts` — collision detection,
  explicit apply, conflict resolution, rejection and correction audit
- `src/features/intake/services/intake-dto.ts` — the shared run response shape
- `src/features/intake/services/chat-extraction.service.ts` — deterministic
  chat/voice extraction and optional AI structuring
- `src/features/intake/services/intake-upload.service.ts` — bounded PDF/DOCX
  upload extraction
- `src/features/intake/services/schedule.ts` — Next `after()` execution hook
- `src/features/intake/adapters/` — `resume`, `linkedin`, `github`, `web`,
  `chat`, `voice`, `registry`
- `src/app/api/intake/route.ts` — list/create
- `src/app/api/intake/upload/route.ts` — PDF/DOCX upload
- `src/app/api/intake/chat/route.ts` — non-persisted extraction preview
- `src/app/api/intake/[id]/route.ts` — detail
- `src/app/api/intake/[id]/stream/route.ts` — SSE progress
- `src/app/api/intake/[id]/cancel/route.ts` — cancel
- `src/app/api/intake/[id]/retry/route.ts` — failed-source retry
- `src/app/api/intake/[id]/patches/[patchId]/route.ts` — apply, correct, reject
- `src/features/intake/components/intake-panel.tsx` — one review surface for all
  six sources
- `src/app/(app)/career-profile/page.tsx` — mounts the panel above the existing
  per-source import cards; the old cards remain

**Tests:** each adapter yields patches with a source; no adapter can write
`CONFIRMED`; a source failure does not fail the run; exact duplicate claims
become one review row while differing dates/details stay reviewable; a
conflicting value is surfaced, not overwritten; a run is
idempotent by key; foreign ids return 404; unauthenticated routes return 401;
rate limits return 429; private-address fetches are rejected before any request;
partial and cancelled runs retry only failed sources; a correction is audited.

**Exit criteria:** Met — a user can start intake from any of the six sources,
review candidate facts, apply or reject them, and see the same Career Profile as
before; every applied fact links back to its source; no confirmed fact changed
without an explicit confirmation; every external adapter has a labeled manual
fallback; no AI provider is required.

**Delivered limits:** voice uses client speech-to-text rather than a server audio
provider; LinkedIn is export-only; intake runs are request-scoped and have no
lease reclaim when the process dies (Cancel → Retry is the recovery path until
P1); duplicate detection is exact normalized identity, not fuzzy matching. These
are documented in `FEATURE_PARITY.md`, not hidden in this phase.

## Phase P3

**Goal:** reproducible BM25 ranking, an optional AI confidence pass on the
shortlist, and a leaderboard that says what it measures.

**Delivered 2026-11-11 (backend):** `src/features/ranking/bm25.ts` (pure Okapi
BM25, `k1 = 1.2`, `b = 0.75`), `src/features/ranking/fit-factors.ts` (seven
factors with explicit `UNKNOWN`), `src/features/ranking/services/ranking.service.ts`
(hybrid composite, configurable top-K/threshold, explanations),
`src/features/ranking/services/rerank.service.ts` (optional grounded LLM pass with
deterministic fallback), `src/features/ranking/services/job-ranking.service.ts` and
`POST /api/ranking` for saved jobs, plus discovery sorting by the composite inside
the qualification band. Tests cover the formula, salary parsing, factor unknowns,
determinism, cutoffs and rerank failures. Still open: the discovery-view score/why
chip, a dashboard leaderboard, and a persisted `RankingSnapshot` (the current
response snapshot is not stored).

**Files:**
- `src/features/ranking/bm25.ts` — new: pure Okapi BM25, `k1 = 1.2`,
  `b = 0.75`, exported params and tokenizer
- `src/features/ranking/bm25.test.ts` — new: known-score fixtures, empty corpus,
  one-document corpus, repeated terms, length normalization
- `src/features/ranking/types.ts` — new
- `src/features/ranking/services/ranking.service.ts` — new: build query terms,
  compute corpus stats, persist `RankingSnapshot`
- `src/features/ranking/services/ranking.service.test.ts` — new
- `src/features/ranking/services/ai-confidence.service.ts` — new: optional,
  bounded to the top 40, records provider/model
- `src/features/ranking/services/ai-confidence.service.test.ts` — new
- `prisma/schema.prisma` — add `RankingSnapshot`
- `prisma/migrations/<timestamp>_add_ranking_snapshots/migration.sql` — new
- `src/app/api/ranking/route.ts` — new
- `src/app/api/ranking/__tests__/route.test.ts` — new
- `src/features/discovery/actions/discovery.actions.ts` — call the ranking
  service after qualification; keep the existing verdict sort as the outer band
- `src/features/discovery/components/discovery-view.tsx` — show rank, score and
  "why", without replacing the qualification badge
- `src/features/jobs/services/job-sort.service.ts` — add a `TAILORING_SCORE` sort
  only when the value exists
- `src/features/dashboard/components/stats-panel.tsx` — link to the leaderboard

**Tests:** BM25 matches the formula on a fixture; a posting with no description
gets no lexical score rather than zero; the same pool and profile produce the
same snapshot; the AI pass is skipped with no provider and never blocks the list;
the cutoff is applied to the displayed queue only, never deleting a saved job;
sorting by a missing score puts those rows last.

**Exit criteria:** ranking is reproducible from the stored snapshot; a user can
explain why a job is above another; no job disappears because of a score; the
leaderboard distinguishes profile fit, lexical rank and optional AI confidence.

## Phase P4

**Goal:** research and tailoring become fail-closed and explainable.

**Status:** tailoring (F23, F24, F26, F27, F28) and three-layer research (F19–F21)
landed. Remaining P4 gap: deterministic banned-cliché post-check (F25) and
per-stage provider routing (F22).

**Files:**
- `prisma/schema.prisma` and
  `prisma/migrations/20261111190000_add_resume_tailoring_provenance/migration.sql`
  — `ResumeTailoringRun`, `ResumeSnapshot`, `ResumeValidation`, `ResumeEditEvent`
- `src/features/resume/tailoring/evidence-map.ts` — requirement-to-evidence map
  with addressable resume/profile refs
- `src/features/resume/tailoring/claim-validator.ts` — deterministic fail-closed
  validator (metrics, dates, names, credentials, seniority, skills, evidence refs)
- `src/features/resume/tailoring/apply-suggestions.ts` — reformulation-only apply
  with per-suggestion rejection reasons
- `src/features/resume/tailoring/snapshot.ts` — canonical JSON + SHA-256 source
  snapshot and restore payload
- `src/features/resume/tailoring/tailoring.service.ts` — initial generation + two
  bounded repairs, provenance persistence, reviewable DRAFT
- `src/features/resume/actions/tailor.ts` — manual path uses the same validator,
  mapper and snapshot
- `src/features/resume/actions/rollback.ts` — snapshot/version-specific restore
  and snapshot-based diff, labelled legacy live-source fallback
- `src/features/resume/actions/save.ts` — optimistic version check + edit history
- `src/features/resume/actions/history.ts` — read-only edit/snapshot/validation
  history
- `src/features/export/services/single-page.ts` and
  `src/features/export/actions/export-pdf.ts` — real PDF page count, same
  template, explicit overflow warning
- `src/features/workflows/executors/tailor.executor.ts`,
  `validate.executor.ts`, `human-review.executor.ts`, `staging.executor.ts` —
  persistent draft, stored-snapshot revalidation, checkpoint metadata
- `src/features/resume/components/editor-header.tsx` — one-page download option

**Remaining files for F25/F22:**
- `src/features/resume/services/tailor-resume.ts` — deterministic cliché rejection
- `src/shared/lib/ai-providers/*` — stage override resolver in
  `src/shared/lib/ai-provider.ts`

**Tests:** delivered: `src/features/resume/tailoring/**/*.test.ts`,
`src/features/resume/actions/__tests__/tailor.test.ts`,
`save.test.ts`, `rollback.test.ts`, `history.test.ts`,
`src/features/workflows/executors/__tests__/tailor-validate.executor.test.ts`,
`src/features/export/services/__tests__/single-page.test.ts` and
`src/features/export/actions/__tests__/export-pdf.test.ts`.

Still required: a returned banned cliché is rejected; per-stage provider
override falls back to the user default when unset.

**Exit criteria:** every tailoring attempt has a persisted report and source
snapshot; no ungrounded text can be created; a failed attempt creates no resume
and offers manual editing; rollback restores the captured revision; one-page
export never truncates content; research facts without a fetched source are not
displayed as facts.

## Phase P5 — delivered 2026-11-11

**Goal:** ATS form preparation, the persistent review queue and reusable answers
become server-side and auditable, while the extension keeps a manual path.
**Delivered** as `AtsPreparation` + `AtsAnswer`; the earlier `ApprovedAnswer`
sketch was replaced, not added.

**Files:**
- `prisma/schema.prisma` — `AtsPreparation`, `AtsAnswer`, `AtsPreparationStatus`,
  `AtsAnswerScope`, `AtsAnswerSource`, ATS `ReviewTask` kinds and
  `ReviewTask.atsPreparationId`
- `prisma/migrations/20261111210000_add_ats_preparation/migration.sql` — additive
  enums, tables, indexes, foreign keys and the review-task link
- `src/features/ats/lib/field-classifier.ts` — server-authoritative meaning and
  sensitivity classification plus fill planning
- `src/features/ats/services/ats-preparation.service.ts` — idempotent preparation,
  review reconciliation, answer approval/revoke, resume attach, status and
  submission confirmation
- `src/features/ats/schemas/ats.schema.ts` — strict request contracts
- `src/app/api/extension/ats/preparations/route.ts`, `[id]/route.ts`,
  `src/app/api/extension/ats/answers/route.ts`,
  `src/app/api/extension/review-tasks/route.ts`, `[id]/route.ts`,
  `src/app/api/extension/resumes/[id]/pdf/route.ts` — bearer-token routes
- `extension/src/ats-adapters.ts`, `ats-api.ts`, `autofill-panel.ts`,
  `autofill-page.ts` — vendor matrix, typed calls, persistent queue, frame-aware
  scan/fill and user-triggered resume attachment
- `extension/src/ats-fixtures.test.ts`, `ats-adapters.test.ts` — maintained
  Greenhouse/Lever/Ashby fixtures
- `docs/ATS_SUPPORT.md` — support matrix, flow and limits

**Tests:** `src/features/ats/__tests__/*`, `src/app/api/extension/ats/__tests__/*`,
`extension/src/ats-fixtures.test.ts`, `extension/src/ats-adapters.test.ts`,
`extension/src/autofill-core.test.ts`, `extension/src/autofill-page.test.ts`.
They cover owner scoping, missing sources, conflicts, answer reuse/revoke,
review-task reconciliation, dynamic field signatures, resume attachment, the
manual download fallback and the absence of submit calls.

**Exit criteria:** a user can prepare a form, resolve every blocked question,
attach a resume and confirm submission manually; a blocked field is a task, not
a failed preparation; the server rejects a client-invented safe classification.

**Remaining:** F32 answer rows are not encrypted at rest; F37 has no standalone
web review screen; F34/F55 live vendor attachment and filling are fixture-tested
only. F55 is planned for P8 live verification.

## Phase P6

**Goal:** stage a submission with evidence and schedule follow-ups, without ever
submitting or sending.

**Files:**
- `prisma/schema.prisma` — add `SubmissionAttempt`; add follow-up channel and
  `FollowUp` fields if the existing `followUpAt` is insufficient
- `prisma/migrations/<timestamp>_add_submission_attempts/migration.sql` — new
- `src/features/submissions/services/submission.service.ts` — new
- `src/features/submissions/services/submission.service.test.ts` — new
- `src/app/api/submissions/route.ts` — new
- `src/app/api/submissions/[id]/route.ts` — new
- `src/app/api/submissions/__tests__/route.test.ts` — new
- `src/app/api/extension/exports/[id]/route.ts` — new: bearer-token export
download for the user-confirmed upload
- `src/features/jobs/services/follow-up-schedule.service.ts` — replace
  calendar-day offsets with business-day arithmetic and channel defaults
- `src/features/jobs/services/follow-up-schedule.service.test.ts` — new
- `src/features/jobs/actions/job-application.actions.ts` — schedule the default
  on `APPLIED` only when the user has not set a date
- `src/features/jobs/components/job-pipeline-stepper.tsx` — distinguish "staged",
  "awaiting confirmation" and "confirmed by user"
- `src/features/jobs/components/job-email-panel.tsx` — LinkedIn channel draft and
  reminder, still copy-only
- `extension/src/api.ts` — stage a submission and fetch the chosen export
  through the bearer-token route after the user confirms the upload
- `src/features/export/services/store-export.ts` — read only; reuse ownership

**Tests:** staging does not set `dateApplied`; confirming does; a foreign export
is rejected; an illegal transition is 409; +5 and +12 business-day dates skip
weekends; the APPLIED transition schedules only when empty; generating a draft
never sends; a terminal status skips remaining follow-ups.

**Exit criteria:** an application can be staged with a resume export, answers and
evidence; the user confirms with one explicit action; the tracker records the
confirmation and the status event; follow-ups appear as due tasks with the right
channel and date; nothing is sent by the app.

## Phase P7

**Goal:** close the remaining product-surface gaps without growing the core.

**Files:**
- Chat/voice intake already shipped in P2; do not add a second conversational
  path here.
- `src/features/jobs/services/essay-draft.service.ts` — new: grounded essay
  draft, always returned for review, never auto-filled
- `src/app/api/extension/essay-draft/route.ts` — new
- `src/app/api/extension/essay-draft/__tests__/route.test.ts` — new
- `src/features/jobs/services/outreach-sequence.service.ts` — new: named outreach
  plan with due dates; no sending
- `src/features/jobs/components/outreach-panel.tsx` — new
- `src/features/dashboard/components/next-action.tsx` — include due outreach and
  review tasks
- `src/shared/components/command-palette.tsx` — add review and workflow entries

**Tests:** an essay draft is blocked from auto-fill; a sequence never sends; the
dashboard orders a due review task above a stale saved job; the palette entries
resolve to real routes.

**Exit criteria:** the remaining partial features have a usable manual-first
surface; every AI path has a no-provider fallback; no new dependency is required
for the packaged desktop build.

## Phase P8

**Goal:** prove the composed workflow on the real runtime and leave a safe
release path.

**Files:**
- `prisma/migrations/*` — review the full additive sequence and the backfill
  scripts
- `scripts/desktop/stage-runtime.mjs` — read only unless the worker needs a
  startup hook
- `desktop/src-tauri/src/main.rs` — read only; confirm no new capability is
  needed
- `docs/DESKTOP.md` — add the worker restart and lease-recovery check
- `docs/ROADMAP.md` — move verified items out of "next verification work"
- `.github/workflows/*` — add typecheck, unit and extension tests to CI if absent

**Tests:** full `npx tsc --noEmit`; `npm test`; `extension npm test`; a Windows
install/restart/close-reopen run with a mid-run kill; two-account isolation for
every new route; signed-out 401 and foreign-origin 403; a fresh database migrated
from zero plus an upgrade from the previous released schema.

**Exit criteria:** the workflow completes on a packaged Windows build with the
app closed and reopened mid-run; no duplicate review task, answer or submission
is created; all gates in this plan's test requirements pass; rollback is
documented; no known blocking issue remains in the promoted journey.

## Test requirements

| Layer | Requirement |
| --- | --- |
| Pure units | BM25, business days, field classification, grounding/validation, state transition table. No I/O. |
| Services | Each new service has a Vitest file beside it covering success, empty input, foreign owner and failure. |
| Route handlers | 401, 403 cross-origin, 404 foreign id, 400 validation, 409 illegal transition, success, idempotent replay. |
| Database | Migration applies to an empty database and to a copy of the previous schema; indexes used by the claim query are present. |
| Worker | Duplicate claim, lease expiry, crash-replay, attempt cap, no worker during build/test. |
| Extension | Existing Vitest suite plus answer sync offline, review task creation, no auto-submit, no form-value reading. |
| End-to-end | Manual qualifying run with no AI provider: intake → profile → discover → rank → research (manual) → tailor (manual) → autofill → review → stage → confirm → follow-up. |
| Security | ASVS 5.0.0 V8 checks on each new route; prompt-injection fixture from an untrusted posting; no secret in a list response or log. |

A test that asserts "no submission happened" must include a positive control
proving the assertion can fail, so an absent selector cannot masquerade as
success.

## Next-phase instructions

1. Read `docs/FEATURE_PARITY.md`, `docs/ARCHITECTURE.md`,
   `docs/WORKFLOW_STATES.md` and this file in that order. Do not start from the
   UI.
2. P2 intake has landed and is intentionally a bounded run engine. Land P1 before
   any feature that needs pauses, leases or review tasks in the application
   workflow. Do not fold intake into a second general workflow engine, and do not
   create a third orchestration path for "just this one feature".
3. Add migrations additively. Never edit a shipped migration. Backfill in a
   separate, idempotent step and keep the old column until the new path is
   verified.
4. Keep every new surface behind a flag that defaults off until its phase exit
   criteria pass.
5. Reuse `resolveApiUserId`, `isSameOriginRequest`, `consumeRateLimit`,
   `secret-box`, `ai-generate` and the owner-scoped Prisma patterns. Do not add a
   parallel auth, crypto, rate-limit or AI stack.
6. Treat posting text, page text and model output as untrusted. Never let a model
   answer a sensitive question, accept terms, or submit.
7. Run the gates in `GATES.md` and the phase tests before reporting done. Report
   failed or unrun checks as limitations, not as passes.
8. Do not commit, push, open a PR, publish a release or deploy without explicit
   approval.
