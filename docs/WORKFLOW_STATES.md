# Workflow states

Updated: 2026-11-11. Normative for the workflow, review and submission backend.
A `WorkflowRun` is an attempt to do one thing (an application pipeline, research,
tailoring, autofill staging, follow-up). It is not the user's application status;
that stays in `JobApplication.status` and is documented separately below.

**Delivery status:** `WorkflowRun`, `WorkflowStep`, `WorkflowEvent` and
`ReviewTask` exist in `prisma/schema.prisma` and are advanced by
`src/features/workflows/services/workflow-worker.ts`. `SubmissionAttempt` and
`FollowUp` are still target contracts, not tables; the current staging step keeps
its bundle in `WorkflowStep.output`, and follow-up timing is advice over
`JobApplication.followUpAt`.

## Entities

| Entity | What it represents | Lifetime |
| --- | --- | --- |
| `WorkflowRun` | One durable execution of one kind (`APPLICATION`, `DISCOVERY`, `RESEARCH`, `TAILOR`, `AUTOFILL`, `FOLLOW_UP`) | Created per attempt; immutable input snapshot |
| `WorkflowStep` | One named unit inside a run | Exactly one row per `(runId, name)`; retries update that row |
| `WorkflowEvent` | Append-only trace of run and step decisions | Never updated; deleted only with its run |
| `ReviewTask` | A question the system must not answer | Open until resolved, dismissed or expired |
| `SubmissionAttempt` (planned) | A staged application with evidence | One active stage per application; history is append-only |
| `FollowUp` (planned) | A scheduled chase on a channel | Derived from the application, not a separate truth |

There is no separate `ApplicationWorkflow` table. An application is a sequence of
runs plus the user's own `JobApplication` record; that record is the durable
identity shared by manual and assisted modes. The delivered create API accepts
only `kind: APPLICATION`; the other enum values are reserved for future
pipelines rather than silently running the application steps under a different
label.

`JobApplication.status` remains `INTERESTED | APPLIED | SCREENING | INTERVIEW |
OFFER | REJECTED | WITHDRAWN`. It is a human record of what happened, never a
proxy for whether an agent step succeeded.

## Core run states

| State | Meaning | Who can enter it | What the user sees |
| --- | --- | --- | --- |
| `MANUAL` | The user is doing this step by hand. No worker will advance it. | User action, or the default for a run created from a manual flow | The editable form or document, with no automation badge |
| `ASSISTED` | An automated step is eligible to run or is running | User starts assistance, or a review answer resumes the run | Progress, and a stop control |
| `AWAITING_REVIEW` | The run cannot continue without a specific human answer | A step that hits missing, sensitive or uncertain information | One review task with the question, reason and fallback |
| `PAUSED` | The user stopped the run, or dismissed a review task | User stops; the last open review is dismissed | A resume action and the preserved inputs |
| `FAILED` | The step exhausted its attempts or hit an unrecoverable error | Worker after the attempt cap; validator hard failure | The specific reason and a manual retry or manual fallback |
| `COMPLETED` | Every required step finished and its output is persisted | Worker after the final step; user marks a manual run done | The artifact, with provenance and a re-run action |
| `CANCELLED` | The user abandoned this attempt; it will not resume | User action only | The attempt in history, with no pending work |

COMPLETED is terminal for the attempt. `CANCELLED` is terminal for the attempt.
Neither deletes artifacts; a new attempt creates a new run. `COMPLETED → ASSISTED`
is legal only as a new attempt with a new run id, never as a mutation of the
completed one.

## Application workflow

### Allowed transitions

Legal edges, in the order the table defines them: `MANUAL → ASSISTED`,
`MANUAL → COMPLETED`, `MANUAL → CANCELLED`, `ASSISTED → AWAITING_REVIEW`,
`ASSISTED → PAUSED`, `ASSISTED → FAILED`, `ASSISTED → COMPLETED`,
`ASSISTED → CANCELLED`, `AWAITING_REVIEW → ASSISTED`, `AWAITING_REVIEW → PAUSED`,
`AWAITING_REVIEW → CANCELLED`, `PAUSED → AWAITING_REVIEW`, `PAUSED → ASSISTED`,
`PAUSED → CANCELLED`, `FAILED → ASSISTED`, `FAILED → CANCELLED`,
`COMPLETED → ASSISTED` (new attempt only).

| From | To | Trigger | Required side effect |
| --- | --- | --- | --- |
| `MANUAL` | `ASSISTED` | User asks for automation on a step | Run row created with an input snapshot and an idempotency key |
| `MANUAL` | `COMPLETED` | User marks the manual step done | Artifact saved; no automation fields claimed |
| `MANUAL` | `CANCELLED` | User abandons | Attempt closed; inputs retained for audit |
| `ASSISTED` | `AWAITING_REVIEW` | A step needs a human answer | `ReviewTask` created in the same transaction |
| `ASSISTED` | `PAUSED` | User stops the run | Lease released; in-flight output discarded, not committed |
| `ASSISTED` | `FAILED` | Attempt cap reached or unrecoverable error | `WorkflowStep.lastError` set; manual path offered |
| `ASSISTED` | `COMPLETED` | Final step succeeds | Output persisted; run finished |
| `ASSISTED` | `CANCELLED` | User abandons | Attempt closed; no partial artifact is presented as final |
| `AWAITING_REVIEW` | `ASSISTED` | User resolves the task | Answer stored per its kind; step re-queued with the answer |
| `AWAITING_REVIEW` | `PAUSED` | User dismisses the task | Task closed as dismissed; run stops with a named reason |
| `AWAITING_REVIEW` | `CANCELLED` | User abandons | Open tasks expire; step set closes |
| `PAUSED` | `AWAITING_REVIEW` | User resumes while an open checkpoint remains | Run returns to the checkpoint instead of pretending it can work |
| `PAUSED` | `ASSISTED` | User resumes with no open checkpoint | Lease cleared; the next step re-reads current inputs |
| `PAUSED` | `CANCELLED` | User abandons | Attempt closed |
| `FAILED` | `ASSISTED` | User retries (`RETRY`, not `RESUME`) | Failed steps only reset; completed work is never repeated |
| `FAILED` | `CANCELLED` | User abandons | Attempt closed |
| `COMPLETED` | `ASSISTED` | User starts a new attempt of the same kind | New run id; prior run untouched |

### Rules

- A transition is written with the state change and its side effect in one
  interactive transaction. A review task cannot exist without its run being
  `AWAITING_REVIEW`, and a run cannot be `AWAITING_REVIEW` without an open task.
- No transition may write a submission. `SUBMISSION_STAGING` only records its
  evidence bundle in `WorkflowStep.output`; the extension's `AtsPreparation` is
  a separate staged draft. Only an explicit user confirmation can mark either
  one submitted.
- `ASSISTED → COMPLETED` requires every required step to be `COMPLETED` and every
  produced artifact to be persisted. A skipped optional step is recorded as
  `SKIPPED`, not `COMPLETED`.
- `MANUAL` runs never acquire a lease and are never claimed by the worker.
- Only the worker moves a run out of `ASSISTED` while it holds the lease. A user
  action that wants to stop a running step moves it to `PAUSED` and the step's
  conditional commit fails because the run version changed.

## Agent run and manual mode

`WorkflowRun.state` uses the same seven states. A run is created in `MANUAL`
state for both entry modes, then `START` moves an `AGENT_ASSISTED` run to
`ASSISTED`; a `MANUAL` run stays `MANUAL` and is completed step by step. Both
modes use the same `JobApplication`, the same step names and the same records.

Per-step statuses are the Prisma `WorkflowStepStatus` enum:

| Step status | Meaning |
| --- | --- |
| `PENDING` | Not started, or waiting for a retry time or dependency |
| `RUNNING` | Claimed by a live worker lease |
| `WAITING_FOR_USER` | Created an open `ReviewTask` and stopped |
| `COMPLETED` | Output committed with its step event |
| `FAILED` | Attempts exhausted, hard validation failure, or declined prerequisite |
| `CANCELLED` | The user cancelled the run |
| `SKIPPED` | Optional step deliberately not run (no data, no provider) |

The application pipeline is fixed and dependency-aware:
`PROFILE → DISCOVER → RANK → RESEARCH → TAILOR → VALIDATE → PREPARE_ATS →
HUMAN_REVIEW → SUBMISSION_STAGING → TRACKING → FOLLOW_UP`. `PROFILE`, `RANK`,
`RESEARCH`, `TAILOR`, `VALIDATE`, `PREPARE_ATS`, `HUMAN_REVIEW`,
`SUBMISSION_STAGING` and `TRACKING` are required; `DISCOVER` and `FOLLOW_UP`
are optional. A needed step is one whose dependencies are all `COMPLETED` or
`SKIPPED`.

### Worker semantics (implemented)

- **One worker loop per server process.** `src/instrumentation.ts` starts it;
  it is disabled under `next build` and `NODE_ENV=test`. A tick recovers expired
  leases, then claims at most three runs. Each run may execute at most two
  independent steps concurrently.
- **One owner per run.** A claim is a conditional `updateMany` on
  `(id, state = ASSISTED, lease is free or expired)`; only the worker whose
  update returns `count = 1` executes. The provider/queue comparison is recorded
  in [RESEARCH.md](RESEARCH.md).
- **Short leases.** A 60-second lease is renewed every 20 seconds while a step
  runs. A crashed process leaves an expired lease; the next tick clears it and
  refunds the interrupted attempt (that attempt produced no committed output).
- **Commit guard.** The step result and its event commit in one transaction that
  first checks the run is still `ASSISTED` and still leased by this worker. The
  step update is also fenced on the attempt's `startedAt` claim token, so output
  from an executor that outlived a pause, resume or lease recovery cannot
  overwrite the newer attempt. A failed guard discards the output and returns
  the step to `PENDING`.
- **Retry policy.** A retryable failure inside the step's attempt cap goes back
  to `PENDING` with exponential backoff (2 seconds doubling to 30 seconds). A
  non-retryable failure, or the cap, sets `FAILED` and records the fallback. A
  required failure fails the run; an optional step's failure is recorded and the
  remaining pipeline continues. Attempt caps come from `pipeline.ts`.
- **Timeouts.** Every step has an `AbortSignal` deadline from its `timeoutMs`,
  and the worker races the executor against that deadline. A provider call that
  ignores the signal still becomes a bounded, retryable timeout rather than a
  hung run.
- **Progress.** `GET /api/workflows/:id/stream` tails persisted rows over SSE;
  `GET /api/workflows/:id/events` returns the append-only history. There are no
  synthetic percentages or agent log lines.
- **Manual mode.** `POST /api/workflows/:id/advance` with `COMPLETE_STEP` and a
  step name marks that step complete for the same application. The worker never
  claims a `MANUAL` run.

A missing target role, a missing resume or missing user information produces
`WAITING_FOR_USER`, not `FAILED`. `PREPARE_ATS` lists sensitive ATS questions in
`needsUserAnswer`; the workflow never answers them itself. The review model also
supports `RESTRICTED_ACCESS` with a supported manual path for extension or
standalone tasks. A validation or grounding failure is `FAILED` rather than a
silent downgrade.

## Tailoring run states

Tailoring is a durable sub-run, not a progress bar. It never advances an
application and never selects a resume; it produces (or refuses to produce) a
reviewable draft.

| `ResumeTailoringRun.status` | Meaning | Allowed next |
| --- | --- | --- |
| `PENDING` | Run row exists, model work not started | `RUNNING`, `CANCELLED` |
| `RUNNING` | Mapping/generation/validation in progress | `COMPLETED`, `NEEDS_REVIEW`, `FAILED` |
| `COMPLETED` | Claim-clean draft persisted with snapshot, validation and edit event | terminal |
| `NEEDS_REVIEW` | Warnings on a saved draft, or no claim-clean draft after 3 attempts | terminal; human acts in the editor |
| `FAILED` | Provider or persistence failure; no claim-clean draft | terminal; retry creates a new run |
| `CANCELLED` | User abandoned the attempt | terminal |

Rules:

- Exactly one `ResumeTailoringRun.resumeId` may be written, and only after the
  whole-document report is `PASS` or `NEEDS_REVIEW`. A `FAIL` writes no resume.
- Bounded repair is three total generations. Each retry receives the exact
  failing claim messages; there is no unbounded loop and no fabricated retry
  history. `attempts` records the real number used.
- `ResumeSnapshot.payload` is immutable. Rollback and restore read it; they never
  copy the live source resume again for a snapshot-backed draft.
- `ResumeValidation` is append-only. `VALIDATE` writes a second row after
  re-checking the stored draft, so a post-tailoring edit cannot leave only the
  original `PASS` on record.
- The workflow stays in `AWAITING_REVIEW` when repair is exhausted. Resolving
  that checkpoint replays `TAILOR` (a new bounded attempt), or the user can
  cancel and edit manually. The application is never auto-selected or submitted.

`HUMAN_REVIEW.suggestedValue` includes `tailoredResumeId`, `validationStatus`,
`validationIssueCount` and `needsReview`, and `SUBMISSION_STAGING.evidence`
includes the draft id and validation status. Staging still refuses without
`{ approved: true }`.

## Review task

States: `OPEN | RESOLVED | DISMISSED | EXPIRED`.

| From | To | Trigger |
| --- | --- | --- |
| `OPEN` | `RESOLVED` | User supplies an answer and confirms reuse choice |
| `OPEN` | `DISMISSED` | User closes it without answering |
| `OPEN` | `EXPIRED` | The parent run is cancelled or the job is archived |

Revoking an approved answer does not reopen a resolved task. The old task stays
resolved for audit; the next time the question is encountered a new task is
created. When a step asks the same exact question and an `OPEN` task already
exists for the run, the worker reuses it instead of creating a duplicate. This is
a transactional check in `commitWaiting`, not a database partial unique index;
only the run's lease owner can commit a waiting step.

Task kinds and the supported manual fallback:

| Kind | Example | Resolution | Reuse |
| --- | --- | --- | --- |
| `SENSITIVE_ANSWER` | Work authorization, sponsorship, salary expectation, demographic, legal history | User types the answer | Optional `AtsAnswer`, opt-in per question; owner-scoped, current rows are not encrypted at rest |
| `UNKNOWN_FIELD` | A field the classifier cannot map safely | User fills it on the page and records the answer | Optional |
| `MISSING_PROFILE_FACT` | No phone number, no work authorization stated | User edits the Career Profile, then resumes | Becomes normal profile data |
| `RESTRICTED_ACCESS` | No site grant, login required, CAPTCHA | User grants the origin or enters the posting manually | Not reused |
| `AMBIGUOUS_TAILORING` | A rewrite cannot be grounded | User edits the text or discards the suggestion | Not reused |
| `SUBMISSION_CONFIRMATION` | Staged application is ready | User reviews evidence and confirms they submitted it | Never automated |

A review task must name the exact question and why it is blocked. "Something went
wrong" is not a valid task. A task with a suggested value must mark that value as
suggested, not answered.

## Submission (target contract, P5)

No `SubmissionAttempt` table ships yet. The implemented
`SUBMISSION_STAGING` step persists its evidence bundle in `WorkflowStep.output`
and refuses without `HUMAN_REVIEW.output.approved === true`; no application row,
`dateApplied` or submission record is written. The following is the target shape
for P5.

`SubmissionAttempt.state`: `DRAFT | STAGED | AWAITING_CONFIRMATION | CONFIRMED |
WITHDRAWN | ABANDONED`.

| From | To | Trigger | Evidence |
| --- | --- | --- | --- |
| `DRAFT` | `STAGED` | A staging step assembled answers, resume export and job snapshot | `answers`, `resumeExportId`, `jobId`, `stagedAt` |
| `STAGED` | `AWAITING_CONFIRMATION` | The user opened the ATS and the extension filled the safe fields | `filledFields`, `reviewTaskIds`, `pageUrl` |
| `AWAITING_CONFIRMATION` | `CONFIRMED` | User explicitly confirms they submitted it themselves | `confirmedAt`, optional screenshot/URL the user supplies |
| `AWAITING_CONFIRMATION` | `ABANDONED` | User closes the form without submitting | `abandonedAt`, reason |
| `STAGED` | `ABANDONED` | Job archived or user cancels | Reason |
| `CONFIRMED` | `WITHDRAWN` | User records a withdrawal | `withdrawnAt` |

`CONFIRMED` is the only state that may stamp `JobApplication.dateApplied` from a
submission flow, and only after the user's confirmation. The system never sets it
from a form being filled. No transition may write a submission; only the user's
confirmation creates `CONFIRMED`.

## Follow-up (target contract)

No `FollowUp` table ships yet. The `FOLLOW_UP` executor recommends a date and
channel from `JobApplication.followUpAt` / `dateApplied`; it never schedules or
sends. The following is the target shape for a dedicated follow-up record.

`FollowUp.state`: `SUGGESTED | SCHEDULED | DUE | DRAFTED | DONE | SKIPPED`.

| From | To | Trigger |
| --- | --- | --- |
| `SUGGESTED` | `SCHEDULED` | User accepts the recommended date, or an APPLIED transition schedules the default |
| `SCHEDULED` | `DUE` | The due date is today in the user's timezone |
| `DUE` | `DRAFTED` | User generates an email or LinkedIn draft |
| `DRAFTED` | `DONE` | User records that they sent it |
| `DUE` | `DONE` | User records a follow-up sent outside the app |
| `SUGGESTED` | `SKIPPED` | User declines |
| `SCHEDULED` | `SKIPPED` | Application reaches a terminal status |

Defaults: email at +5 business days after `dateApplied`; LinkedIn at +12 business
days. Business days exclude Saturday and Sunday in the user's timezone; public
holidays are not modeled and the date remains editable. Generating a draft never
sends anything and never moves the application status.

## Intake run

Intake is a separate, request-scoped state machine. It never advances an
application and never writes a profile fact on its own.

### Run states

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `PENDING` | Rows persisted, adapters not started | `RUNNING`, `CANCELLED` |
| `RUNNING` | At least one source is executing | `COMPLETED`, `PARTIAL`, `FAILED`, `CANCELLED` |
| `COMPLETED` | Every requested source succeeded | none; a new run starts fresh |
| `PARTIAL` | At least one source succeeded and at least one failed | `PENDING` via retry of failed sources |
| `FAILED` | Every source failed | `PENDING` via retry |
| `CANCELLED` | User cancelled, or the process observed cancellation | `PENDING` via retry of cancelled sources |

A source row has its own `PENDING`, `RUNNING`, `SUCCEEDED`, `PARTIAL`,
`FAILED`, `CANCELLED` or `SKIPPED` status. `SUCCEEDED` with zero patches is a
valid outcome: the source was read and had nothing durable to add. Retry only
re-runs `FAILED` or `CANCELLED` sources; a source that already succeeded is
never silently re-read.

### Patch states

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `PENDING` | Proposed fact awaiting review | `APPLIED`, `REJECTED`, `CONFLICT` |
| `CONFLICT` | Collides with an existing profile value | `APPLIED` after a disposition, `REJECTED`, `PENDING` after correction |
| `APPLIED` | Explicitly applied to the profile | stays applied; corrections update the target and are audited |
| `REJECTED` | User declined, kept existing, or an exact duplicate was removed | may be applied later by an explicit action |

### Rules

1. A patch is persisted with source, adapter, locator/URL/file, timestamp and
   confidence. The DTO never exposes raw resume text or a transcript.
2. No adapter writes `CareerEvidence`, `CareerCapability`, `CareerTargetRole` or
   a contact field. Only `applyIntakePatch` does, after a user action.
3. Applied evidence is `CANDIDATE`, never `CONFIRMED`; applied skills are
   unconfirmed. Confirmation remains the existing profile action.
4. A collision without a disposition returns a review task
   (`KEEP_EXISTING`, `ACCEPT_INCOMING` or `KEEP_BOTH`) and writes nothing.
5. Cancellation is cooperative: the route marks the run and pending sources
   `CANCELLED`, aborts the in-process handle, and every progress write re-checks
   the persisted run status. A source that ignores cancellation is marked
   `CANCELLED` at its next checkpoint.
6. Intake never submits an application, accepts terms, or answers a sensitive
   ATS question. Those remain extension review tasks.

## Invariants

1. Every run, step, event and review task row is owner-scoped. A route resolves
   the owner id and filters by it; no client-supplied `userId` is trusted.
2. A state change and its audit artifact commit together. A crash either leaves
   both or neither.
3. A step that can be replayed must be idempotent. `WorkflowStep` is unique on
   `(runId, name)` and `idempotencyKey` is `${runId}:${stepName}`; a `COMPLETED`
   step is never executed again, and a retry updates the same row after resetting
   only its own attempt state. Side effects are not replayed.
4. `AWAITING_REVIEW` always has at least one `OPEN` task. Closing the last task
   moves the run, never leaves it stranded.
5. `FAILED` always carries a user-readable reason and a manual path. A failure
   without both is a bug.
6. A posting never creates a capability, a model never creates an employer and an
   answer never creates a profile fact without an explicit confirm action.
7. `COMPLETED` requires a persisted artifact. A summary screen is not an artifact.
8. `CANCELLED` and `COMPLETED` are terminal for that attempt. History is not
   rewritten; a re-run is a new run.
9. A review answer is never used for a different question. The key is the
   normalized question plus its category, and a changed question asks again.
10. No transition may write a submission, accept terms, click submit, or send an
    email or LinkedIn message.
