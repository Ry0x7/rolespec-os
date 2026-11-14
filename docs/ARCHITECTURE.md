# Architecture

Updated: 2026-11-14.

RoleSpec is a private, single-owner job-search workspace. The web app, Windows
desktop shell and browser extension share one set of career, resume, job and
application data. This document records the current structure and the target
structure for reproducing Recruitt's workflow. It does not replace
[FEATURE_PARITY.md](FEATURE_PARITY.md), which says what exists today, or
[ROADMAP.md](ROADMAP.md), which lists remaining verification work.

## Runtime and code layout

- `src/app`: Next.js routes and thin API handlers.
- `src/features`: domain services, actions, components and tests.
- `src/shared`: UI primitives, infrastructure, AI integration and validation.
- `src/config`: navigation and application configuration.
- `prisma`: PostgreSQL schema and the shared migration history.
- `extension`: standalone Manifest V3 browser companion, with its own dependencies/build.
- `desktop`: Tauri shell and bundled runtime resources; see [DESKTOP.md](DESKTOP.md).

The desktop shell runs a standalone Next.js build with bundled Node.js and a private PostgreSQL
cluster. It binds the server and database to loopback. Desktop builds use `.next-desktop`, separate
from a web development server's `.next`. Docker supplies PostgreSQL and applies the same migrations.
There is no desktop-only schema or separate implementation of the product.

The target architecture adds no second runtime. Every new service is a module
inside the existing Next.js server, every new table lives in the same PostgreSQL
schema, and the Tauri shell only gains loopback endpoints it already proxies.

## Product loop and entities

`Career Profile → Discover → Qualify → Prepare → Apply → Track → Follow up → Outcome`

- **Career Profile** holds the user's own history, evidence, preferences and goals.
- **Master Resume** is reusable and independent of a job description.
- **Role Family Resume** derives from the master for a class of roles.
- **Job-Tailored Resume** is an optional derivative for one application.
- **Job** is the canonical opportunity, including provenance and qualification data.
- **Application** records the user's activity and outcome against a job.

Job descriptions can influence prioritization and wording. They must never become evidence of a
qualification the user has not supplied. Resume improvements must remain reviewable and grounded
in the user's original content. Do not automatically submit applications.

## Target architecture

The product loop grows into an explicit, resumable pipeline:

`Intake → Profile → Discover → Rank → Research → Tailor → Autofill → Review → Submission staging → Track → Follow up`

Four rules shape the design:

1. **One source of truth per fact.** A posting never creates a capability; a
   model never creates an employer; a review answer never becomes a profile fact
   without the user confirming it.
2. **Every automated step is optional and degradable.** Manual qualification,
   manual research notes, manual tailoring, manual form filling and manual
   follow-up must all remain possible with no AI provider configured.
3. **A blocked step becomes a review task, not a failed workflow.** Missing
   information, restricted access and uncertain answers pause the run in
   `AWAITING_REVIEW` with a specific task and a supported manual path.
4. **No new infrastructure service.** State lives in PostgreSQL and is advanced
   by an in-process worker. No Redis, no Convex, no external queue, no second
   database.

### Layer map

| Layer | Existing modules | Current / target additions |
| --- | --- | --- |
| Intake | `src/features/intake` (run, apply, six adapters), `src/features/career-profile/services`, `src/features/linkedin/services` | Delivered: `IntakeRun`/`IntakeSourceRun`/`IntakePatch`/`IntakeConflict`/`IntakeCorrection` and `/api/intake/*`. Intake remains request-scoped with Cancel → Retry recovery, separate from the workflow lease worker. |
| Workflow | `src/features/workflows`, `src/app/api/workflows`, `src/app/api/review-tasks` | Delivered: `WorkflowRun`/`WorkflowStep`/`WorkflowEvent`/`ReviewTask`, the eleven executors, the leased in-process worker, manual mode, review checkpoints and SSE progress. A partial unique index (`workflow_runs_one_active_per_application`) enforces one active run per application. The first-party runs view is `/workspace?view=runs`; the review screen is `/review`. |
| Profile | `career-profile` actions/services, `CareerEvidence`, `CareerCapability` | per-field provenance envelope, merge candidates |
| Discovery | `src/features/discovery/services/adapters` | unchanged read-only adapters, run record |
| Ranking | `qualify.service.ts`, `intelligent-matching.service.ts` | `src/features/ranking/bm25.ts`, `RankingSnapshot` |
| Research | `company-research.service.ts`, `job-requirements.service.ts` | culture block, per-job research run |
| Tailoring | `resume/actions/tailor.ts`, `tailor-resume.ts`, `export` | validation report, coverage score, repair pass |
| Autofill | `extension/src/autofill-core.ts`, `extension/src/autofill-page.ts` | Delivered: `AtsPreparation`/`AtsAnswer`, server-authoritative field classification, persistent `ReviewTask` queue, approved-answer memory with revoke, staged record and user-confirmed submission. The `/review` screen is the web queue. Remaining: live vendor validation. |
| Submission | `src/features/workflows/executors/staging.executor.ts`, `src/features/submissions/services/submission.service.ts`, `src/features/ats/services/ats-preparation.service.ts` | Delivered: one `SubmissionAttempt` row (STAGED) for both the workflow's `SUBMISSION_STAGING` step and `AtsPreparation`, with `/api/submission-attempts` and an explicit confirmation endpoint. `WorkflowStep.output` remains a summary, not a second submission record. |
| Tracking | `job-application.actions.ts`, `ApplicationStatusEvent` | workflow linkage; confirmation advances `INTERESTED → APPLIED` only |
| Follow-up | `src/features/jobs/services/follow-up-task.service.ts`, `outreach-sequence.service.ts` | Delivered: durable `FollowUpTask` +5 business-day EMAIL and +12 business-day LINKEDIN reminders; named `OutreachSequence`/`OutreachTouch` plans for manual actions. No send path. |

### Module boundaries

- **Server-only.** Ranking, workflow orchestration, review resolution,
  submission staging and every database write run on the server. The extension
  never receives a user id, a workflow id it can mutate, or a raw secret.
- **Pure cores.** BM25, business-day arithmetic, anti-fabrication validation and
  field classification are pure functions with no I/O, so they are testable and
  identical on web and desktop.
- **AI at the edges.** Model calls sit behind `src/shared/lib/ai-generate.ts`.
  A workflow step records the provider and model it used, but the state machine
  never depends on a provider being available.

## Unified intake (implemented)

The six Recruitt intake paths share one pipeline and one review queue. They are
not six import features with six schemas.

```text
source input ──▶ adapter ──▶ IntakePatchDraft[] ──▶ validate + fingerprint
                                                        │
                                              IntakePatch (PENDING)
                                                        │
                              ┌─────────────────────────┴─────────────────────────┐
                              │                                                   │
                        no collision                                        collision
                              │                                                   │
                     explicit Apply                                      IntakeConflict
                              │                                                   │
      CareerEvidence CANDIDATE / CareerCapability / CareerTargetRole / contact   KEEP_EXISTING
      (never CONFIRMED; user confirms later in the profile)                     ACCEPT_INCOMING
                                                                                 KEEP_BOTH
```

### Adapter contract

Every adapter implements `IntakeAdapter` in
`src/features/intake/types.ts` and receives the run id, owner id, a validated
source input, an `AbortSignal` and a progress reporter. It returns
`IntakePatchDraft[]`; it never touches Prisma. The run service validates every
draft with `patchDraftSchema` before persistence, so a new adapter cannot invent
a fifth fact shape.

| Source | Input | Authorization / access rule | Failure behavior |
| --- | --- | --- | --- |
| `RESUME` | Stored resume id, or PDF/DOCX text extracted by the upload route | Owner's own resume | Unreadable file is `415`/`400` before a run exists; a readable but factless resume succeeds with a warning |
| `LINKEDIN` | Text from the user's own data export / "Save to PDF" | No live profile fetch, no login-wall bypass, no scraping | Deterministic parse always; optional AI only when requested; provider failure falls back with a warning |
| `GITHUB` | Public profile URL + explicit `consent: true` | Public GitHub API only; no token, no private repositories | Rate limit / not-found becomes a source-level failure with manual fallback |
| `WEB` | Public page URL + explicit `consent: true` | Existing DNS-pinned `fetchPublicUrl`; redirects are revalidated at every hop | Private host, unsupported content and timeouts become source-level failures |
| `CHAT` | 1–60 role/content turns | User-authored transcript; assistant turns are never treated as facts | Narrow deterministic extractor; optional AI; empty result is a warning, not an error |
| `VOICE` | Text transcript from browser speech recognition or paste | Audio never leaves the client; no microphone or ElevenLabs dependency on the server | Same extractor as chat; text fallback is the supported path |

### Canonical intake event

`IntakePatch` is the reviewable unit. It stores `kind` (`CONTACT`, `EVIDENCE`,
`SKILL`, `TARGET_ROLE`), the validated `payload`, `source`, `confidence` (0–100),
a `provenance` envelope (`adapter`, `sourceUrl`, `fileName`, `externalId`,
`locator`, `fetchedAt`, `detail`), a normalized `fingerprint`, and a status
(`PENDING`, `APPLIED`, `CONFLICT`, `REJECTED`). The confidence is evidence about
the source, not a probability claim; an adapter may lower it for inferred facts.

Fingerprints are stable, case/accent/punctuation-folded identities:

- contact: field + normalized value;
- evidence: kind + normalized title + normalized organization;
- skill: alias-folded name (`Node.js`, `NodeJS`, `node js` collapse);
- target role: normalized title.

In-run dedupe uses a stricter exact-claim key: the identity above plus evidence
dates, details and outcome. Byte-equivalent claims are rejected with an auditable
reason and the highest-confidence version is kept. If the same role at the same
organization is stated with different dates or details, both patches survive and
the second apply produces a profile conflict, so the disagreement is reviewable
rather than silently collapsed. Fuzzy title matching remains a deliberate
follow-up, not claimed behavior.

### Run lifecycle and concurrency

`IntakeRun` is a request-scoped orchestration record, deliberately separate from
the general `WorkflowRun` in P1. A run is `PENDING` → `RUNNING` → `COMPLETED`,
`PARTIAL`, `FAILED` or `CANCELLED`. Each `IntakeSourceRun` has its own status and
0–100 progress; sources execute in parallel with `Promise.all`. The route returns
`202` after creating rows and schedules execution with Next `after()`, so the
response is not blocked by a GitHub fetch or an optional model call.

Progress is persisted, not held only in memory. The SSE route reads the database
every 750 ms and emits a `progress` event whenever the DTO changes. Cancellation
writes `CANCELLED` to the run and non-terminal sources, aborts the in-process
`AbortController`, and is also re-checked from the database on every progress
report, so a second process can cancel the visible run. A source failure does not
abort the other sources: all-success is `COMPLETED`, some-success is `PARTIAL`,
none-success is `FAILED`.

Retry resets only sources that are `FAILED` or `CANCELLED`, deleting their
unapplied patches first, and leaves succeeded sources untouched. This is why a
retry cannot silently replace a fact the user already reviewed. There is no lease
or crash-reclaim loop yet: if the server dies mid-run, the run remains `RUNNING`,
and the visible recovery path is Cancel → Retry. P1 adds lease-based recovery for
the general workflow; intake must not grow a second worker engine before then.

### Apply, conflict and confirmation

Nothing an adapter returns is trusted profile data. `applyIntakePatch` is the only
write path, and it always requires an explicit user action:

- **Contact** writes one profile scalar, but only after the user applies it; an
existing different value becomes a conflict.
- **Evidence** is created as `CANDIDATE` with the intake provenance in
  `metadata`; it is never `CONFIRMED` by intake. Confirmation remains the existing
  career-profile action.
- **Skill** is created with `confirmed: false`; this matches manual entry.
- **Target role** is created active and is the only directional value intake adds.

Collisions return `409`-shaped review data, not an overwrite. The user chooses
`KEEP_EXISTING`, `ACCEPT_INCOMING` or `KEEP_BOTH` (evidence only; contact, skill
and target-role identities are unique). `ACCEPT_INCOMING` refuses to rewrite a
confirmed evidence row. Corrections rewrite the patch payload and, if already
applied, the target row, recording the previous and corrected payload in
`IntakeCorrection`.

## End-to-end data flow

```text
Sources                         Server                                    Durable state
──────────────────────────────  ────────────────────────────────────────  ──────────────────────────
Resume PDF/DOCX ─┐
LinkedIn export ─┤              IntakeRun (six adapters, parallel)
GitHub profile ──┤                     │
Portfolio page ──┼─ adapters ──▶ validated CandidatePatch[]              intake_runs
Chat transcript ─┤                     │                                 intake_source_runs
Voice transcript ┘              explicit apply / conflict review         intake_patches
                                        │                                intake_conflicts
                                        └─▶ CareerEvidence CANDIDATE      career_evidence

CareerProfile ─────────────────▶ qualifyCandidate() ──▶ verdict            jobs (qualification snapshot)
Board adapters ── postings ───▶ normalize + dedupe                          ranking_snapshots
                                 BM25(profile terms, pool stats) ──▶ rank
                                 optional AI confidence (shortlist) ──▶ score

Saved Job ─────────────────────▶ research step (requirements/company/culture)
                                 verified citations only ──▶ research row   job_research

Job + Master Resume ───────────▶ tailor step (model suggestions)
                                 deterministic validator
                                 coverage score + report ──▶ suggestions   workflow_steps
                                 user applies (manual or assisted)

ATS form (extension) ──────────▶ server field classification ──▶ fill plan
                                 safe facts ──▶ preview ──▶ user-confirmed fill
                                 sensitive/unknown ──▶ ReviewTask         review_tasks
                                 approved answer ──▶ AtsAnswer            ats_answers
                                 staged form record ──▶ AtsPreparation   ats_preparations

Application ───────────────────▶ staged submission evidence                  submission_attempts
                                 user confirms they submitted ──▶ APPLIED  job_applications
                                 follow-up tasks (+5 email, +12 LinkedIn)  follow_up_tasks
                                 named outreach plan (manual touches)      outreach_sequences
                                                                           outreach_touches
```

### Control flow

1. A user action (or the worker) creates a `WorkflowRun` with a `kind` and an
   input snapshot. The run is owner-scoped and stores a `state`.
2. The worker claims a due run with a conditional update on `(id, state =
   ASSISTED, lease free or expired)`. `FOR UPDATE SKIP LOCKED` was evaluated and
   is not needed for a one-row claim through Prisma; the update returns `count =
   1` for exactly one worker. It stores `leaseOwner`/`leaseExpiresAt`, renews
   the lease while a step runs, and may execute two independent steps at once.
3. A step reads its inputs, performs one unit of work, and writes its output in
   the same transaction as its completion event and a check that the run is
   still `ASSISTED` under this worker's lease. The step row is unique on
   `(runId, name)`, so a replay cannot create parallel copies.
4. On success the run moves to the next dependency-ready step or to `COMPLETED`.
   On a recoverable error the step returns to `PENDING` with backoff. On a
   question that only the user can answer it moves to `AWAITING_REVIEW` and
   creates a `ReviewTask`. On an unrecoverable error it moves to `FAILED` with a
   specific reason and a manual fallback.
5. Resolving a review task resumes the run in `ASSISTED`; dismissing it pauses
   the run in `PAUSED`. Staging creates a `SubmissionAttempt` in `STAGED`, never
   `SUBMITTED`; only the user's explicit confirmation can move it, and no path
   clicks a submit control or sends a message.

The full state machine, legal transitions and invariants are in
[WORKFLOW_STATES.md](WORKFLOW_STATES.md). The HTTP surface is in
[API_CONTRACTS.md](API_CONTRACTS.md).

### Workflow engine (implemented)

The assisted application pipeline is one run with eleven dependency-aware steps:

```text
PROFILE → DISCOVER → RANK → RESEARCH → TAILOR → VALIDATE
        → PREPARE_ATS → HUMAN_REVIEW → SUBMISSION_STAGING → TRACKING → FOLLOW_UP
           (DISCOVER and FOLLOW_UP are optional; every other step is required)
```

There are two entry modes and one record set. `POST /api/workflows` creates a run
for an existing `JobApplication` with `mode: MANUAL | AGENT_ASSISTED`. Both modes
share the application and the eleven `WorkflowStep` rows; manual mode completes
steps through the same advance route and never acquires a lease.

- **Pipeline definition.** `src/features/workflows/pipeline.ts` owns step order,
  dependencies, requiredness, timeout and attempt caps. The worker executes a
  step only when every dependency is `COMPLETED` or `SKIPPED`.
- **Executors.** `src/features/workflows/executors/*.ts` implement one real unit
  of work each: profile readiness, query/link derivation, ranking, three-layer
  research, persistent resume tailoring, revalidation of the stored draft, ATS
  field planning, the human checkpoint, submission staging, tracking review and
  follow-up scheduling. They return an outcome; they never submit, send, select a
  resume or write a `JobApplication` status on the user's behalf.
- **Provider boundary.** Only `RESEARCH` and `TAILOR` call a model, through the
  existing `ai-generate`/provider settings. A missing provider is a typed
  failure with a manual fallback, never a fabricated result.
- **Human checkpoint.** `HUMAN_REVIEW` always creates a `SUBMISSION_CONFIRMATION`
  task. Only an explicit `{ approved: true }` answer completes it as approved;
  a decline is recorded as `approved: false` and `SUBMISSION_STAGING` refuses.
- **Failure isolation.** A required step's failure fails the run. An optional
  step's failure is persisted and the rest continues. A retryable failure uses
  exponential backoff; an attempt cap is a `FAILED` step with the reason kept.
- **Recovery.** Leases are 60 seconds and renewed every 20. A restart reclaims an
  expired run, refunds the interrupted attempt and replays the step. A pause or
  cancel during a step makes the commit guard fail, so uncommitted output is
  discarded rather than presented as final.
- **Surfaces.** `GET /api/workflows/:id`, `/events` and `/stream` expose persisted
  state; `/stream` tails rows over SSE rather than subscribing to an in-memory
  emitter. `GET/POST /api/review-tasks` and `PATCH /api/review-tasks/:id` are the
  checkpoint queue. `src/instrumentation.ts` starts the worker once per server
  process; tests and `next build` never start it.

The tests are `src/features/workflows/__tests__/workflow-engine.test.ts`,
`src/features/workflows/executors/__tests__/*` and
`src/app/api/workflows/__tests__/route.test.ts`.

## ATS preparation (implemented)

```text
extension scan (labels/names/types only, all frames)
  → POST /api/extension/ats/preparations (idempotent on vendor + canonical URL)
  → server re-classifies every field by meaning and sensitivity
  → plan: FILL (stored facts / approved answers) | REVIEW | ATTACH_RESUME
  → user previews and confirms → extension writes fields per frame
  → blocked field → persistent ReviewTask (question, reason, fallback, no value)
  → user resolves → AtsAnswer (APPLICATION or GLOBAL, editable, revocable)
  → user-pressed resume attach → GET /api/extension/resumes/:id/pdf → File or manual download
  → AtsPreparation record (source URL, plan, results, tasks, timestamps)
  → user submits on the employer page → explicit yes/no → SUBMITTED / NOT_SUBMITTED
```

- **Server is the security boundary.** `src/features/ats/lib/field-classifier.ts`
  re-derives category, sensitivity and question key. A client cannot promote a
  sensitive field by changing its label, type or vendor string. `select`, radio,
  checkbox, file, essay and typeahead controls are never written. Essay drafts
  (`/api/extension/essay-draft`) are grounding-checked review text, never a fill
  value.
- **One queued question per blocked field.** `AtsPreparation` owns zero or more
  `ReviewTask` rows. Re-scanning updates the existing open task. A blocked field
  never fails the preparation; resolving or dismissing the task only changes what
  can be filled, never submits.
- **Answer memory is explicit and encrypted.** `AtsAnswer` is approved per
  question, scoped to one application or all forms, editable only with
  `replace: true`, and revoked by keeping the row and setting `revokedAt`. Values
  are stored as an `enc.v1.*` secret-box envelope (`src/shared/lib/answer-crypto.ts`);
  legacy plaintext rows remain readable and are re-encrypted when edited. A
  conflicting replacement raises `409` and leaves one `CONFLICTING_ANSWER` task
  open; revocation reopens the question.
- **Resume attachment is user-triggered.** The PDF endpoint only renders an owned,
  non-archived resume. The panel stages a `File` into the page's input; if the page
  refuses it, the same PDF downloads for manual selection. Nothing is uploaded by
  the server.
- **Staging is not submission.** Creating or refreshing an `AtsPreparation` calls
  `ensureStagedAttempt` and writes one linked `SubmissionAttempt` in `STAGED`.
  Only `CONFIRM_SUBMISSION` with `submitted: true` moves the attempt to
  `SUBMITTED`, moves an `INTERESTED` linked application to `APPLIED`, records
  `dateApplied`, schedules follow-up tasks and appends an `ApplicationStatusEvent`
  with `source: EXTENSION`. A confirmed attempt cannot be downgraded.
- **Coverage.** `extension/src/ats-adapters.ts` distinguishes ingestion from form
  filling. Greenhouse, Lever and Ashby have maintained fixtures; other vendors are
  assisted or manual. On 2026-11-12 a public Lever application page was fetched
  and scanned: 24 fields were discovered and the plan split 6 safe fills from 18
  review fields (13 sensitive), with no submit action. A live fill, resume attach
  and employer submission were not performed. See [ATS_SUPPORT.md](ATS_SUPPORT.md).

The tests are `src/features/ats/__tests__/*`, `src/app/api/extension/ats/__tests__/*`,
`extension/src/ats-fixtures.test.ts`, `extension/src/ats-adapters.test.ts`,
`extension/src/autofill-core.test.ts` and `extension/src/autofill-page.test.ts`.

## Evidence-grounded resume tailoring (implemented)

```text
source resume (id + version)
  → immutable SourceSnapshotPayload (canonical JSON + SHA-256)
  → requirement map: posting line → EvidenceAtom refs (resume + CONFIRMED profile)
  → provider generation (initial + up to 2 repair passes)
  → deterministic per-claim rejection (numbers, scope, names, barred terms, skills)
  → whole-document validation (metrics, dates, entities, credentials, seniority,
     skill set, added roles/bullets, semantic drift, evidence refs)
  → PASS / NEEDS_REVIEW: DRAFT resume + ResumeSnapshot + ResumeValidation + edit event
  → FAIL after 3 attempts: NO resume; run NEEDS_REVIEW; human-review fallback
```

- **One service.** `tailorResumeForApplication()` in
  `src/features/resume/tailoring/tailoring.service.ts` is used by the workflow
  `TAILOR` executor. The manual editor action reuses the same validator,
  requirement mapper and snapshot builder, so both entry modes produce the same
  provenance rows. Manual editing and plain PDF export never require AI.
- **Evidence map.** `evidence-map.ts` flattens resume sections and confirmed
  career evidence into addressable atoms and maps every posting requirement to
  up to three refs with `SUPPORTED` / `PARTIAL` / `UNSUPPORTED`. A posting is
  never evidence about the candidate.
- **Reformulation only.** The prompt receives only existing target text plus the
  pre-grounded/barred term lists. `apply-suggestions.ts` applies selection,
  reorder and rephrase in place; it never inserts an item or a skill, and the
  validator separately rejects a rewritten claim the captured source cannot
  support. Numbers and dates are attribution-scoped to the source field/item.
- **Fail closed.** `claim-validator.ts` returns `FAIL` on any error. The service
  persists no resume for a `FAIL`; the run and report remain so the checkpoint
  can name the exact violation. Warnings produce a reviewable DRAFT marked
  `NEEDS_REVIEW`, still not selected for the application.
- **Version-specific rollback.** A generated resume stores the source revision in
  `ResumeSnapshot.payload`. `rollbackTailoredResume(resumeId, snapshotId?)`
  restores that payload, not the live source; it increments the resume version,
  records `ROLLBACK` in `ResumeEditEvent`, and marks the snapshot's
  `restoredAt`/`restoreCount`. `getTailoredResumeDiff` compares against the same
  captured payload, so a later source edit cannot rewrite the comparison. The
  live-source path is a labeled legacy fallback for resumes created before
  snapshots existed.
- **Workflow revalidation.** `VALIDATE` loads the stored snapshot, requirement map
  and draft sections, re-runs the deterministic validator, appends a second
  `ResumeValidation`, and fails the step if the stored document no longer passes.
  `HUMAN_REVIEW` surfaces the draft id and validation status; nothing is selected
  or submitted until the user acts.
- **Export.** `exportResumePdf(..., { singlePage: true })` composes the existing
  template with at most three tighter presentation configs and counts real PDF
  pages with `pdf-parse`. It never truncates content; when one page is impossible
  it returns the tightest render with `SINGLE_PAGE_WARNING`.

## Data model additions

All tables are owner-scoped through `userId` and use the existing `cuid()` id
convention and `@@map` snake_case names. Migrations are additive; no existing
column is dropped in the parity work.

| Model | Purpose | Key columns and indexes |
| --- | --- | --- |
| `IntakeRun` | One intake attempt across one or more sources | `userId`, `status`, `requestedSources`, `idempotencyKey`, `warnings Json`, `startedAt`, `finishedAt`; unique `(userId, idempotencyKey)`; index `(userId, createdAt)` |
| `IntakeSourceRun` | One source attempt inside a run | `runId`, `source`, `status`, `progress`, `message`, `error`, `input Json` (server-only), `metadata Json`; unique `(runId, source)` |
| `IntakePatch` | A candidate fact proposed by an adapter | `runId`, `sourceRunId`, `source`, `kind`, `payload Json`, `provenance Json`, `fingerprint`, `confidence`, `status`, `appliedTargetType`, `appliedTargetId`; indexes `(runId, status)`, `(runId, fingerprint)` |
| `IntakeConflict` | A proposed fact that collides with the profile | `runId`, `patchId` (unique), `existingType`, `existingId`, `field`, `incoming Json`, `existing Json`, `status`, `resolution`; index `(runId, status)` |
| `IntakeCorrection` | Audit of a user correction | `patchId`, `previousPayload Json`, `correctedPayload Json`, `note`; index `(patchId, createdAt)` |
| `WorkflowRun` | Durable orchestration record | `userId`, `jobApplicationId?`, `kind`, `mode`, `state`, `input Json`, `idempotencyKey`, `leaseOwner`, `leaseExpiresAt`, `stateVersion`, `lastError`, `startedAt`, `finishedAt`; unique `(userId, idempotencyKey)`; index `(userId, createdAt)`, `(state, leaseExpiresAt)` |
| `WorkflowStep` | One executed step and its result | `runId`, `name`, `order`, `status`, `required`, `dependsOn String[]`, `attempts`, `maxAttempts`, `timeoutMs`, `idempotencyKey`, `input`/`output Json`, `lastError`, `nextAttemptAt`, `startedAt`, `finishedAt`; unique `(runId, name)`; index `(runId, status)`, `(status, nextAttemptAt)` |
| `WorkflowEvent` | Append-only run and step trace | `runId`, `stepId?`, `type`, `message`, `metadata Json`, `createdAt`; index `(runId, createdAt)` |
| `ReviewTask` | A question the system must not answer | `userId`, `runId?`, `stepId?`, `jobApplicationId?`, `kind`, `status`, `question`, `reason`, `category`, `fallback`, `suggestedValue Json`, `answer Json`, `resolvedAt`, `resolvedBy`; index `(userId, status)`, `(runId, status)` |
| `RankingSnapshot` | Reproducible ranking response the user actually saw | `userId`, `kind`, `topK`, `minScore`, `poolSize`, `entryCount`, `reranked`, `payload Json`, `createdAt`; index `(userId, createdAt)` |
| `ResumeTailoringRun` | One tailoring attempt, its requirement map and validation | `userId`, `resumeId?`, `sourceResumeId`, `jobApplicationId?`, `status`, `mode`, `attempts`, `sourceVersion`, `snapshotHash`, `requirementMap Json`, `validation Json`, `snapshot Json`, `lastError`; indexes `(userId, createdAt)`, `(resumeId)`, `(sourceResumeId)` |
| `ResumeSnapshot` | Immutable source payload used for version-specific restore | `resumeId`, `userId`, `sourceResumeId`, `sourceVersion`, `hash`, `payload Json`, `capturedAt`, `restoredAt`, `restoreCount`; index `(resumeId, capturedAt)` |
| `ResumeValidation` | Append-only validation report for a draft revision | `resumeId`, `userId`, `tailoringRunId?`, `status`, `sourceHash`, `report Json`, `createdAt`; index `(resumeId, createdAt)` |
| `ResumeEditEvent` | Append-only edit/tailoring/rollback history | `resumeId`, `userId`, `kind`, `versionBefore`, `versionAfter`, `summary`, `metadata Json`, `createdAt`; index `(resumeId, createdAt)` |
| `AtsPreparation` | One staged ATS form preparation | `userId`, `jobApplicationId?`, `workflowRunId?`, `vendor`, `sourceUrl`, `canonicalUrl`, `preparationKey`, `status`, `resumeId?`, `resumeTitle?`, `plan Json`, `results Json`, `reviewTaskIds`, counts, `approvedAt`, `filledAt`, `submittedAt`, `submissionNote`; unique `(userId, preparationKey)`; indexes `(userId, updatedAt)`, `(jobApplicationId, userId)` |
| `AtsAnswer` | Reusable approved answer to one ATS question (the earlier `ApprovedAnswer` placeholder was replaced by this model) | `userId`, `preparationId?`, `questionKey`, `questionText`, `category`, `sensitivity`, `value Json` (encrypted envelope), `scope`, `source`, `dedupeKey`, `approvedAt`, `revokedAt`, `lastUsedAt`, `useCount`; unique `(userId, dedupeKey)`; indexes `(userId, questionKey)`, `(preparationId, revokedAt)` |
| `SubmissionAttempt` | One staged application, shared by workflow and extension paths | `userId`, `jobApplicationId?`, `workflowRunId?` (unique), `atsPreparationId?` (unique), `resumeId?`, `source`, `status`, `jobTitle`, `companyName`, `sourceUrl`, `evidence Json`, `confirmedAt`, `confirmationNote`; indexes `(userId, status)`, `(jobApplicationId, createdAt)` |
| `FollowUpTask` | Durable +5 email and +12 LinkedIn reminder | `userId`, `jobApplicationId`, `channel`, `status`, `dueAt @db.Date`, `appliedOn @db.Date`, `reason`, `source`, `completedAt`; unique `(jobApplicationId, channel)`; index `(userId, status, dueAt)` |
| `OutreachContact` | Named recruiter/hiring contact | `userId`, `name`, `role`, `company`, `email`, `linkedinUrl`, `notes`; index `(userId, createdAt)` |
| `OutreachSequence` | Named plan of manual touches | `userId`, `contactId`, `name`, `status`, `idempotencyKey`, `startedAt`, `completedAt`; unique `(userId, idempotencyKey)`; index `(userId, status, createdAt)` |
| `OutreachTouch` | One scheduled manual action | `sequenceId`, `order`, `channel`, `status`, `dueOn @db.Date`, `note`, `completedAt`; unique `(sequenceId, order)`; index `(sequenceId, status, dueOn)` |
| `UserAiStageSetting` | Per-user provider/model override for one workflow stage | `userId`, `stage`, `provider`, `model`, `apiKeyEnc`; keyed by `(userId, stage)`; the stage list is fixed in `src/shared/lib/ai-stages.ts` |

`WorkflowRun.leaseExpiresAt` and `WorkflowStep.nextAttemptAt` are the only
scheduling primitives; there is no separate cron for workflow advancement. The
worker claims by conditional update, so the index on `(state, leaseExpiresAt)`
is the claim path.

`WorkflowStep` is unique on `(runId, name)` and `WorkflowRun` is unique on
`(userId, idempotencyKey)`. Duplicate open review questions are prevented by the
lease-owner check in `commitWaiting`, not by a partial unique index. The ATS
answer rule is enforced by a deterministic `dedupeKey`
(`scope:preparationId|global:questionKey`), so one live answer exists per scope
and question while revoked rows remain as provenance.

### Why these tables and not a queue service

The packaged Windows app starts one Node process and one PostgreSQL cluster. A
PostgreSQL table with `FOR UPDATE SKIP LOCKED` provides the same claim semantics
as a queue for this workload, survives restart, and needs no extra daemon.
pg-boss and Graphile Worker were evaluated and remain fallbacks, not
requirements; `pg_search` was rejected because it cannot ship in the Windows
PostgreSQL bundle. See [RESEARCH.md](RESEARCH.md) R5–R13.

## Execution model

- **Intake runs are request-scoped.** The create/upload route persists rows and
  schedules the parallel adapters with Next `after()`. Progress is in PostgreSQL,
  the SSE route polls it, and cancel/retry are explicit routes. This is not the
  general workflow worker below; it is a bounded run with no step queue.
- **In-process worker.** A single loop starts with the Next.js server (guarded so
  it does not run in tests or during `next build`), performs one tick immediately
  and then every five seconds. One tick recovers expired leases and claims at
  most three runs; a run executes at most two independent steps concurrently.
  The loop stops with the process, which is the desktop "closed laptop" model.
- **Leases and recovery.** A claim holds a 60-second lease, renewed every 20
  seconds. An expired lease is reclaimed by the next tick; the interrupted step
  returns to `PENDING` and its attempt is refunded because no output committed.
- **At-least-once.** A step may run twice after a crash. Every step therefore has
  an idempotency key, a unique `(runId, name)` row, and writes its outcome in one
  transaction with the completion event and a run-state/lease guard. A replay of
  a `COMPLETED` step is impossible because only `PENDING` steps are eligible.
- **Short steps, no long transactions.** A model call is never made inside a
  database transaction. Inputs are snapshotted, the call happens outside, and the
  result is committed with a conditional update that fails if the run moved.
- **Bounded work.** Each step has a timeout, an attempt cap and a token budget.
  Exceeding a cap is a `FAILED` step with a specific message, never a silent
  retry loop.
- **No cron dependency.** Existing `/api/cron/*` routes remain for retention
  pruning. Workflow advancement does not depend on an external scheduler, so a
  self-hosted or desktop install behaves the same as Vercel.

## Security and privacy boundaries

Access is decided by `src/features/auth/session.ts` and every API route resolves
the caller through `src/features/auth/api-auth.ts`. There are no RoleSpec
accounts, passwords, OAuth providers or registration flow. `auth()` resolves the
one owner row; every query stays scoped to that owner id, including intake runs,
sources, patches, conflicts, corrections, workflow runs, steps, events and review
tasks. `retryWorkflow` checks ownership before resetting any step.

- `local` mode is passwordless only on loopback. `unlock` mode requires
  `ROLSPEC_ACCESS_KEY` and a signed HttpOnly cookie on any non-loopback host.
  `src/proxy.ts` never authenticates; it only redirects legacy bookmarks and
  records the requested path for `/unlock`.
- A bearer `rspec_…` token authenticates the extension even while the browser
  session is locked. Only the SHA-256 hash is stored. The extension never sends a
  cookie and never receives a session.
- Mutating cookie-authenticated requests require a same-origin `Origin`.
- Posting text, page text, uploaded resumes and model output are untrusted input.
  They are fenced in prompts and never interpreted as instructions by the app.
- A model can propose text and classify a field. It cannot write a database row
  that asserts a qualification, cannot answer a sensitive question, and cannot
  submit. This is the OWASP LLM06 excessive-agency boundary.
- `AtsAnswer` rows are owner-scoped, omit revoked rows from every plan, and are
  never logged or echoed in a preparation plan or a review task's suggested-value
  envelope. Values are encrypted at rest with the shared secret-box envelope
  (`enc.v1.*`); only the owner's server process can decrypt them. The
  browser-local cache remains a convenience, not secure storage. The extension
  bearer token is the only credential that can read them, and only for its own
  owner.
- `GET /api/account/export` includes intake runs and source input, workflow runs,
  review tasks, ATS preparations/answers, submission attempts, follow-up tasks,
  outreach plans, ranking snapshots, tailoring history, activity and AI usage
  metadata. It includes no API token hash or AI provider key and is served
  `no-store`.
- Logs record ids, states and aggregated outcomes, not answer text, resume text or
  credentials.
- `IntakeSourceRun.input` stores resume/LinkedIn text or a chat/voice transcript
  so a retry can run after a restart. It is never returned by the API, never
  logged, and never includes raw file bytes or audio.
- GitHub and web sources require per-run `consent: true`. The web source uses the
  existing SSRF-safe fetcher; private addresses and redirects into private space
  are rejected before content is read. LinkedIn is user-export-only and is never
  scraped.

New routes follow OWASP ASVS 5.0.0 V8: server-side authorization on every read
and write, no client-supplied owner id, and a composite or `userId` filter on
every relation traversal. Rate limits use the existing
`src/shared/lib/rate-limit.ts` buckets.

## Failure and degradation

| Failure | Behavior | What the user sees |
| --- | --- | --- |
| No AI provider configured | Deterministic path runs; AI step is skipped | Manual qualification, import, tailoring, autofill and tracking still work |
| Provider timeout or quota | Step retries with backoff, then `FAILED` | Specific reason and a manual retry action |
| Model output fails grounding | Suggestion discarded and recorded; up to two repair passes | The draft is not offered; the exact claim and code are named |
| All tailoring attempts fail validation | No resume row is created; run `NEEDS_REVIEW`; workflow pauses | A human-review question lists the violations and the manual editor fallback |
| Source resume edited after tailoring | Rollback restores the captured snapshot, never the live source | The restored revision and source version are stated |
| Single-page export cannot fit | Tightest supported layout returned with a warning; content is not truncated | Warning names why the page limit was not reached |
| Posting has no description | Qualification returns `unknown` for that dimension | "Not enough information", never a fabricated score |
| Board unavailable | That adapter is reported `error`; the run continues | Partial results with a source status line |
| Page access not granted | Extension offers a per-origin grant and manual entry | Grant button plus a working manual form |
| Sensitive form question | `ReviewTask` in `AWAITING_REVIEW` | One question, why it needs the user, and where to answer |
| App closed mid-run | Intake run stays `RUNNING`; user cancels then retries failed sources. General workflow leases are reclaimed on the next tick and the interrupted step is replayed | Preserved source progress and a working Cancel → Retry path; workflow output is committed only under a valid lease |
| Intake source unavailable | That source is `FAILED`; the other sources still finish | `PARTIAL` run, per-source error and a manual profile path |
| Intake conflict | Patch becomes `CONFLICT`; no profile write | Existing and incoming values side by side, with three explicit choices |
| Crash between step and commit | Step is replayed; idempotency key prevents duplication | No duplicate evidence, answer or submission record |

## Preserved boundaries

These boundaries predate the parity work and remain in force. Unified intake is
the new path; it extends the same profile and evidence services rather than
replacing them.

### Unified intake

`source → adapter → validated patch → explicit apply → candidate profile fact`

Intake never writes a confirmed fact. `IntakeSourceRun.input` holds the source
text or transcript so a retry can run after a restart; it is server-only and is
never included in the API DTO. Uploads are bounded (10 MB resume, 5 MB LinkedIn
PDF), sniffed from leading bytes and parsed with the existing PDF/DOCX extractor.
GitHub and web reads require per-run consent; the web path reuses the existing
SSRF-safe fetcher. AI is optional for every adapter and its failure downgrades to
a deterministic result or a labeled manual fallback, never a failed run.

### Resume import

`PDF/DOCX → validation → bounded text extraction → local import or explicit AI structuring → save`

`POST /api/resume/parse` checks owner access, rate limits, size, MIME/extension, file signatures
and DOCX archive sanity. Extraction has a timeout and a 200,000-character cap. Files are limited
to 5 MB. PDF uses `pdf-parse`; DOCX uses `mammoth`.

The default path never calls AI. It recognizes common standalone headings and maps each to its
matching resume section (summary, experience with bullets, skills, education, projects,
certifications), preserving the extracted wording. Unrecognized headings stay editable `CUSTOM`
sections using their existing `content` field. It does not invent qualifications, achievements or
dates, split fields beyond what the lines state, or promise layout preservation. Image-only scans
without readable text are rejected with guidance to use OCR.

`useAi=true` explicitly enables structured AI parsing and optional bullet polishing. The legacy
`optimizeBullets` field controls only polishing within that AI path; it cannot opt a caller into AI.
Automatic job-match analysis also requires `useAi=true` and a job description. A failed analysis
after persistence must not discard the imported resume.

### AI setup and generation

Every model call goes through `src/shared/lib/ai-generate.ts`. Provider resolution lives in
`src/shared/lib/ai-provider.ts` and `src/shared/lib/ai-providers`.

Onboarding and Settings share plain-language provider choices, advisory diagnostics and a live
connection test under `src/features/onboarding`. A successful diagnostic does not replace the test.
Credentials use the existing encrypted `UserAiSettings` path. Diagnostics must not copy vendor auth
tokens. CLI login belongs to the vendor CLI; local models require a separately running server.

Providers include cloud APIs, Codex CLI, Claude Code, OpenCode free models, Ollama and LM Studio.
CLI tools/local servers are not bundled with the desktop installer. The supplied Docker setup uses
cloud APIs. Provider plans, model availability and limits may change; avoid fixed cost guarantees. Per-stage provider overrides are implemented in `UserAiStageSetting` and
`/api/settings/ai-stages`: research, ranking, discovery, tailoring, profile and
follow-up calls can use different provider/model pairs. They reuse the same
encrypted settings path and never introduce a second credential store.

### Discovery and opportunity confidence

Source adapters normalize and deduplicate results into `Job`, preserving URLs, provider identity
and timestamps. One unavailable source should not fail a whole search. Public search/API/company
career paths and contextual extension capture are complementary.

Pagination is bounded rather than walked: the Firecrawl client hard-caps at two pages with a
per-page `limit` and stops early when a page is short, while the free adapters deliberately read
one page per query. No adapter accepts an unbounded page count from the caller. Dedupe is the
per-owner canonical URL plus a provider-id fallback, freshness is read from `postedAt`, and
eligibility uses the market-fit classifier plus the extracted requirement flags.

Do not bypass login walls, paywalls, CAPTCHAs or anti-bot controls. Search snippets are fallback
signals; prefer the actual posting where accessible. The extension must not interfere with login
fields, password managers or unrelated browser behavior.

**Profile match** measures fit to the user's evidence. **Opportunity confidence** evaluates signals
such as provenance, freshness, completeness and an official application path. Keep these separate.
Stale or incomplete listings are not proof of fraud or dishonest hiring.

### Ranking (implemented)

`postings + confirmed profile → BM25 index → seven factors → composite → optional rerank → top-K`

`src/features/ranking/bm25.ts` is the pure formula (`k1 = 1.2`, `b = 0.75`) with a deterministic
tokenizer. Documents are normalized posting descriptions; a posting with no description returns
`null`, which stays distinct from a real zero. Query terms come only from active target roles,
confirmed capabilities and confirmed evidence — never from candidate rows.

`src/features/ranking/fit-factors.ts` evaluates `SKILLS`, `EXPERIENCE`, `LOCATION`, `WORK_MODE`,
`SALARY`, `AUTHORIZATION` and `FRESHNESS`. Missing data is `UNKNOWN`: it earns no points, remains
visible, and lowers `coverage` instead of being counted as a match. Salary comparison requires the
same currency and a readable period; no exchange rate is invented. Location reuses the existing
market-fit classifier, including Philippine and worldwide rules.

`rankJobPool` fuses `lexicalWeight` (default 0.4) with the factor score. Top-K and `minScore` shape
the returned list only; every excluded posting is reported with a reason. Discovery applies the
composite inside the qualification band, so ranking refines an order but cannot lift a `BLOCKED`
posting above an eligible one. `/api/ranking` exposes the same service for saved jobs.

`rerankShortlist` is the optional AI pass over at most 40 entries (default 20). It uses structured
output, may only reorder, and only with a quote grounded in the posting. Unknown ids, ungrounded
quotes, an omitted shortlist entry, and provider failures leave the deterministic order and are
reported as warnings. A partial verdict set is not a rerank. The AI never changes a factor state or
a stored qualification.

### Research (implemented)

`posting → requirements layer → company layer → culture layer → source summary`

`src/features/jobs/services/three-layer-research.service.ts` returns three separately labelled
layers. Requirements reuse the deterministic flags plus must-have/nice-to-have extraction. Company
facts reuse the fetched-and-verified research path; only independently fetched company text grounds
a company fact. Culture signals are `VERIFIED` only when an independent source quotes the claim,
`STATED_IN_POSTING` when only the posting says it, and `UNKNOWN` when nothing does; contradictions
become an explicit conflict.

`sourceSummary` counts distinct citation hosts and excludes the posting host, so "two independent
sources" is measured rather than assumed. Results are cached in-process for 30 minutes keyed by
company/role/URL; a failed provider degrades to the deterministic layer instead of failing the
research. The payload is stored beside `companyResearch` in `JobApplication.matchResult`.

## Release boundaries

The release audit and its per-capability labels live in [VERIFICATION.md](VERIFICATION.md). The
backend is a real persisted system: workflow state, review tasks, ATS preparations, encrypted answer
memory, submission attempts, follow-up tasks, outreach plans, tailoring provenance and application
history are PostgreSQL rows, not UI state. The boundaries that remain are explicit there rather than
implied here: no live employer-ATS fill/attach/submit, no installed or upgraded
Windows build from this source revision, and no large-pool load test. The duplicate-active-workflow
guard is now a partial unique index in PostgreSQL.

## Sources of truth

Current code, tests and shipped migrations define behavior. This document records
durable boundaries and the target design; [FEATURE_PARITY.md](FEATURE_PARITY.md)
records the measured gap; [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) records
the order of work; [API_CONTRACTS.md](API_CONTRACTS.md) and
[WORKFLOW_STATES.md](WORKFLOW_STATES.md) are normative for new backend work;
[RESEARCH.md](RESEARCH.md) records why the technical choices were made. Keep
historical investigations in git history rather than duplicate planning files.
