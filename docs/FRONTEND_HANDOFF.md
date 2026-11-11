# Frontend handoff

Updated: 2026-11-11. This is the integration contract for a future UI. It
describes the backend that exists in this repository; it does **not** claim that
a workflow or web review screen has been built. The current app still has its
existing resume, discovery, tracker, ATS-extension and settings surfaces.

## Identity and transport

| Caller | Authentication | Origin / CSRF |
| --- | --- | --- |
| Browser app | Owner cookie from `auth()`; local mode is passwordless on loopback, unlock mode is the signed HttpOnly cookie | Mutating cookie requests need a same-origin `Origin`. A missing `Origin` is allowed for curl/server jobs. |
| Browser extension | `Authorization: Bearer rspec_…` personal token | Bearer only; no cookie. CORS is reflected only to `chrome-extension://` / `moz-extension://`. |
| Public cron | `CRON_SECRET` | No user session. |

Never send `userId` in a body or query. Every resource is owner-scoped by the
server; a foreign id returns `404`.

Error envelope:

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE", "state": "OPTIONAL_CURRENT_STATE" }
```

Common statuses: `400 INVALID_INPUT`/`VALIDATION`, `401 UNAUTHORIZED`,
`403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`/illegal transition,
`429 RATE_LIMITED`, `500 SERVER_ERROR`.

## Implemented endpoints

### Application tracker

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/api/applications` | List applications; create an application and its posting |
| `GET`, `PATCH`, `DELETE` | `/api/applications/:id` | Read, edit or delete one application |
| `POST`, `DELETE` | `/api/applications/:id/followup` | Schedule or clear a follow-up date |
| `GET`, `POST` | `/api/jobs` | List jobs; create a job |
| `GET`, `PATCH`, `DELETE` | `/api/jobs/:id` | Read, edit or delete a job |
| `POST` | `/api/jobs/scrape` | Fetch a public posting (Firecrawl when configured, SSRF-safe direct fetch otherwise) |
| `GET`, `POST` | `/api/notes` | Notes |
| `PATCH`, `DELETE` | `/api/notes/:id` | One note |
| `GET`, `POST` | `/api/todos` | To-dos |
| `PATCH`, `DELETE` | `/api/todos/:id` | One to-do |
| `GET` | `/api/activity` | Activity feed |
| `POST` | `/api/activity` | Record an activity event |
| `GET` | `/api/account/export` | Owner JSON export, including intake/workflow/review/ATS/tailoring/activity/AI-usage records |
| `GET` | `/api/exports/:resumeId/:batch/:filename` | Download an owned PDF export |
| `POST` | `/api/resume/parse` | Parse an uploaded PDF/DOCX into resume fields (5 MB cap, rate limited) |
| `POST` | `/api/career-profile/import-linkedin` | Import a LinkedIn PDF export into the career profile |
| `POST` | `/api/linkedin/assist` | Draft LinkedIn profile suggestions from a PDF export |
| `GET` | `/api/cron/prune-exports` | Scheduled cleanup (`CRON_SECRET`) |
| `GET` | `/api/cron/prune-rate-limits` | Scheduled cleanup (`CRON_SECRET`) |
| `GET` | `/api/health` | Liveness and database check |

`/api/linkedin/rating` is intentionally disabled (`404 FEATURE_DISABLED`); do
not build a rating control against it.

### Discovery and ranking

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/ranking` | Rank saved jobs with BM25 plus seven deterministic factors |
| `GET` | `/api/extension/search-links` | Board search links from the career profile (bearer) |
| `POST` | `/api/extension/qualify` | Fit badges for up to 40 visible postings (bearer) |
| `POST` | `/api/extension/jobs` | Save a clipped posting (bearer) |

The ranking response is documented in [API_CONTRACTS.md](API_CONTRACTS.md#implemented-post-apiranking).
It has `snapshot`, `entries`, `excluded`, `reranked`, `warnings` and `poolSize`.
An entry always carries factor `state` (`MATCH`, `PARTIAL`, `MISMATCH`,
`UNKNOWN`), `coverage` and `explanation`. Unknown data must render as unknown,
never as a neutral positive score.

### Unified intake

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/api/intake` | List or create a run |
| `POST` | `/api/intake/upload?source=RESUME\|LINKEDIN&useAi=0\|1` | Upload a PDF/DOCX export |
| `POST` | `/api/intake/chat` | Preview conversational extraction without persisting |
| `GET` | `/api/intake/:id` | Run DTO |
| `GET` | `/api/intake/:id/stream` | Persisted-progress SSE |
| `POST` | `/api/intake/:id/cancel` | Cooperative cancel |
| `POST` | `/api/intake/:id/retry` | Retry failed/cancelled sources only |
| `PATCH` | `/api/intake/:id/patches/:patchId` | Correct a proposed fact |
| `POST` | `/api/intake/:id/patches/:patchId` | Apply a proposed fact, optionally with a conflict disposition |
| `DELETE` | `/api/intake/:id/patches/:patchId` | Reject a proposed fact |

Patch kinds: `CONTACT`, `EVIDENCE`, `SKILL`, `TARGET_ROLE`. Patch status:
`PENDING`, `CONFLICT`, `APPLIED`, `REJECTED`. A patch always carries `source`,
`confidence`, `provenance` and optional conflict details. Applied evidence is
`CANDIDATE`, never confirmed profile truth.

### Workflows and review tasks

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/api/workflows` | List runs; create one run and its eleven steps |
| `GET` | `/api/workflows/:id` | Run DTO |
| `GET` | `/api/workflows/:id/events?limit=50` | Append-only event history |
| `GET` | `/api/workflows/:id/stream` | Persisted-state SSE |
| `POST` | `/api/workflows/:id/advance` | `START`, `RESUME`, `RETRY`, `PAUSE`, `CANCEL`, `COMPLETE_STEP` |
| `GET`, `POST` | `/api/review-tasks` | List or create a standalone review task |
| `PATCH` | `/api/review-tasks/:id` | Resolve or dismiss a task |
| `GET` | `/api/workflows` query `state`, `kind`, `limit` | Owner-scoped list |

Create body:

```json
{
  "jobApplicationId": "cuid",
  "mode": "MANUAL",
  "kind": "APPLICATION",
  "idempotencyKey": "8-120 chars",
  "input": { "resumeId": "cuid", "targetRole": "Backend Engineer" }
}
```

`mode` defaults to `AGENT_ASSISTED`; `kind` currently only accepts
`APPLICATION`. The run is created in `MANUAL` state even for assisted mode; call
`START` to queue it. One tracked application can have only one active workflow
(`MANUAL`, `ASSISTED`, `AWAITING_REVIEW` or `PAUSED`); a second create returns
`409 CONFLICT`. `jobApplicationId` is optional in the schema but a run without
one cannot meaningfully finish the application pipeline.

Shared `WorkflowRun` shape:

```json
{
  "id": "cuid",
  "jobApplicationId": "cuid | null",
  "kind": "APPLICATION",
  "mode": "MANUAL | AGENT_ASSISTED",
  "state": "MANUAL | ASSISTED | AWAITING_REVIEW | PAUSED | FAILED | COMPLETED | CANCELLED",
  "input": { "jobApplicationId": "cuid", "jobId": "cuid", "resumeId": "cuid", "targetRole": "Backend Engineer" },
  "lastError": null,
  "startedAt": "ISO | null",
  "finishedAt": "ISO | null",
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "steps": [
    {
      "id": "cuid",
      "name": "PROFILE",
      "order": 0,
      "status": "PENDING | RUNNING | WAITING_FOR_USER | COMPLETED | FAILED | CANCELLED | SKIPPED",
      "required": true,
      "dependsOn": [],
      "attempts": 0,
      "maxAttempts": 1,
      "output": null,
      "lastError": null,
      "startedAt": null,
      "finishedAt": null
    }
  ],
  "openReviewTaskIds": ["cuid"]
}
```

The step order is fixed: `PROFILE`, `DISCOVER`, `RANK`, `RESEARCH`, `TAILOR`,
`VALIDATE`, `PREPARE_ATS`, `HUMAN_REVIEW`, `SUBMISSION_STAGING`, `TRACKING`,
`FOLLOW_UP`. `DISCOVER` and `FOLLOW_UP` are optional.

`POST /api/workflows/:id/advance` body:

```json
{ "action": "START", "stepName": "PROFILE" }
```

- `RESUME` is legal only from `PAUSED`. Use `RETRY` for `FAILED`.
- `COMPLETE_STEP` is legal only for a `MANUAL` run and requires `stepName`.
- A successful start/assisted action returns `202`; manual/pause/cancel actions
  return `200`. Illegal moves return `409` with the current state.
- A declined `SUBMISSION_CONFIRMATION` completes `HUMAN_REVIEW` with
  `approved: false`; `SUBMISSION_STAGING` then refuses and fails with a named
  fallback. Nothing is submitted.

Workflow events:

```json
{ "id": "cuid", "type": "STEP_COMPLETED", "stepName": "PROFILE", "message": "PROFILE: …", "metadata": { "summary": "…" }, "createdAt": "ISO" }
```

Event types include `RUN_CREATED`, `RUN_STARTED`, `STEP_STARTED`, `STEP_COMPLETED`,
`STEP_FAILED`, `STEP_SKIPPED`, `STEP_WAITING_FOR_USER`, `REVIEW_REQUESTED`,
`REVIEW_RESOLVED`, `RUN_PAUSED`, `RUN_RESUMED`, `RUN_CANCELLED`, `RUN_COMPLETED`,
`LEASE_RECLAIMED`, `RETRY_SCHEDULED`.

Review task shape:

```json
{
  "id": "cuid",
  "runId": "cuid | null",
  "stepId": "cuid | null",
  "jobApplicationId": "cuid | null",
  "atsPreparationId": "cuid | null",
  "kind": "SENSITIVE_ANSWER | UNKNOWN_FIELD | MISSING_PROFILE_FACT | RESTRICTED_ACCESS | AMBIGUOUS_TAILORING | SUBMISSION_CONFIRMATION | ESSAY_ANSWER | RESUME_ATTACHMENT | CONFLICTING_ANSWER | UNSUPPORTED_FIELD",
  "status": "OPEN | RESOLVED | DISMISSED | EXPIRED",
  "question": "Exact question",
  "reason": "Why it is blocked",
  "category": "optional stable category",
  "fallback": "Manual action",
  "suggestedValue": null,
  "answer": null,
  "resolvedAt": null,
  "createdAt": "ISO"
}
```

`PATCH /api/review-tasks/:id`:

```json
{ "action": "RESOLVE", "value": { "approved": true }, "scope": "APPLICATION" }
{ "action": "DISMISS", "reason": "I will apply manually." }
```

For `SUBMISSION_CONFIRMATION`, only an explicit object with `approved: true`
approves staging. A resolved non-submission task re-queues its waiting step with
the answer attached; dismissing the last open task pauses the run.

### ATS preparation and answers

Extension-only, bearer token. Full payloads are in
[API_CONTRACTS.md](API_CONTRACTS.md) and [ATS_SUPPORT.md](ATS_SUPPORT.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/api/extension/ats/preparations` | List/create an idempotent preparation |
| `GET`, `PATCH` | `/api/extension/ats/preparations/:id` | Read; record results, attach resume, confirm submission or abandon |
| `GET`, `POST`, `DELETE` | `/api/extension/ats/answers` | List, approve/edit or revoke answers |
| `GET` | `/api/extension/review-tasks` | Persistent review queue |
| `PATCH` | `/api/extension/review-tasks/:id` | Resolve, dismiss or attach a resume for a task |
| `GET` | `/api/extension/resumes` | List the owner's non-archived resumes for the picker |
| `GET` | `/api/extension/resumes/:id/pdf` | Render an owned resume for user-triggered attachment |
| `GET` | `/api/extension/profile` | Read the profile facts the extension may fill |
| `POST` | `/api/extension/cold-email` | Draft a cold outreach email from the extension |
| `POST` | `/api/extension/email-reply` | Draft a reply from the extension |

Preparation status: `DRAFT`, `READY_FOR_REVIEW`, `READY_TO_SUBMIT`,
`SUBMITTED`, `NOT_SUBMITTED`, `ABANDONED`. A preparation is a staged record, not
a submitted application. `CONFIRM_SUBMISSION` with `submitted: true` is the only
path that moves a linked application to `APPLIED`; a later `submitted: false`
returns `409 TERMINAL` instead of downgrading a confirmed submission.

`/api/review-tasks` and `/api/review-tasks/:id` share the owner-keyed
`review:web` limit (120 per 10 minutes) and return `429 RATE_LIMITED` past it.

### Research and tailoring

These are server actions, not public HTTP routes:

- `runCompanyResearch(jobApplicationId)` returns the three-layer payload and
  persists it under `JobApplication.matchResult`. Render `requirements`,
  `company` and `culture` separately; `UNKNOWN` is not a negative fact.
- `createJobTailoredResume(formData)` and the workflow `TAILOR`/`VALIDATE` steps
  persist a DRAFT, source snapshot, validation report and edit history. The
  draft is never selected for the application automatically.
- `exportResumePdf(resumeId, { singlePage: true })` returns the existing
  template with a real page count and an overflow warning rather than truncating.

## Types the UI can rely on

Use the exported TypeScript contracts instead of duplicating shapes:

- `src/features/workflows/types.ts` — `WorkflowRunDTO`, `WorkflowStepDTO`,
  `WorkflowEventDTO`, `ReviewTaskDTO`, `WorkflowStepName`, `WorkflowStepOutcome`.
- `src/features/ats/services/ats-preparation.service.ts` — `AtsPreparationView`,
  `AtsReviewTaskView`, `AtsAnswerView`.
- `src/features/intake/types.ts` and `src/features/intake/services/intake-dto.ts` —
  intake run/patch/source DTOs.
- `src/features/ranking/types.ts` — ranking entries, factors, snapshot.
- `src/features/jobs/services/three-layer-research.service.ts` —
  `ThreeLayerResearch`, culture signal states.
- `src/features/resume/tailoring/types.ts` — requirement evidence, validation
  report and claim references.
- `extension/src/ats-api.ts` — parsed extension-side ATS shapes.

## UI requirements for the missing workflow surface

1. **Run creation** from one tracked application. Let the user choose `MANUAL`
   or `AGENT_ASSISTED`, show the application's job title/company/resume, and
   send an idempotency key per intent.
2. **Step timeline** rendered from persisted step statuses only. Do not animate
   or extrapolate a percentage. Show required/optional, attempts, timestamps,
   last error and fallback.
3. **Run controls** gated by the legal transitions: start, pause, resume, retry,
   cancel, and manual complete-step. Show why a control is disabled.
4. **Review drawer** with the exact question, reason, category, fallback and
   suggested value (marked as suggested). Resolve/dismiss with an explicit
   confirmation; submission confirmation must show the staged evidence first.
5. **Event history** from `/events` or the SSE stream, including redacted
   failure reasons. A reconnect must reload the run; do not cache personal
   payloads in shared storage.
6. **Staged-evidence view** showing the rank score/factors, research confidence
   and uncertainty, tailored resume id/validation status, ATS field counts and
   blocked questions. Keep “staged” visibly distinct from “submitted”.
7. **Review-queue screen** for `GET /api/review-tasks`: filter by status/kind,
   show provenance (run, application, ATS preparation, answer scope), and
   surface unresolved conflicts. The extension already has its own queue; a web
   screen should use the same server rows, not a parallel store.
8. **Answer memory screen** for ATS answers: current value, scope, approved
   date, last used, use count, revoke. Never show another owner's value; a
   revoked answer is omitted from future plans.
9. **Research view** that separates requirements from company facts and culture,
   with verified/posting-only/unknown labels and citations. Never render an
   unverified claim as a fact.
10. **Tailoring view** that shows the evidence reference for each rewritten
    claim, validation status, diff/compare, version-specific rollback and the
    one-page export warning.
11. **Follow-up view** that shows the recommended date/channel as advice and
    lets the user accept or clear it. Sending remains manual.

## Missing capabilities / honest gaps

- No workflow UI, workflow list screen or global command entry; the API exists
  but nothing calls it from the app.
- No standalone `/workspace/review` screen (F37).
- No generic `SubmissionAttempt` table or evidence route; the extension
  `AtsPreparation` is the staged record that exists (F35 Partial).
- No scheduled `FollowUp` table, business-day +5/+12 scheduling, or LinkedIn
  follow-up channel (F41/F42/F44 Partial/Missing).
- No AI essay-draft endpoint or UI (F33 Missing).
- No dashboard leaderboard and no persisted `RankingSnapshot`.
- Ranking rerank exists only through `POST /api/ranking`; discovery itself does
  not call AI, so discovered-but-unsaved postings have no LLM confidence (F14).
- Provider selection is per user, not per workflow stage (F22).
- No deterministic post-check for the banned-cliché list (F25).
- `POST /api/linkedin/rating` is disabled and returns `404 FEATURE_DISABLED`;
  the LinkedIn page still renders rate controls. Re-enable intentionally or hide
  them (product decision).
- ATS answers are owner-scoped and excluded from plans/logs, but current rows
  are not encrypted at rest (F32 Partial).
- Live Greenhouse/Lever/Workday/Ashby filling was not verified; only maintained
  fixtures exist (F34/F55 Partial).
- No multi-tenant accounts or hosted billing. The workspace is single-owner.

## Integration example: manual application run

```ts
const created = await fetch("/api/workflows", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jobApplicationId,
    mode: "MANUAL",
    kind: "APPLICATION",
    idempotencyKey: crypto.randomUUID(),
  }),
}).then((r) => r.json())

const runId = created.workflow.id as string

await fetch(`/api/workflows/${runId}/advance`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "START" }),
})

for (const stepName of ["PROFILE", "RANK", "PREPARE_ATS"]) {
  await fetch(`/api/workflows/${runId}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "COMPLETE_STEP", stepName }),
  })
}
```

For an assisted run, replace `MANUAL` with `AGENT_ASSISTED`, call `START`, then
open `new EventSource(`/api/workflows/${runId}/stream`)`. The stream is
cookie-authenticated for the app; an extension must use a bearer `fetch` stream
instead of `EventSource`. On every `progress` event, replace the local run with
the payload. On `AWAITING_REVIEW`, `GET /api/review-tasks?status=OPEN` and
resolve the task, then reopen the stream.

## Integration example: ATS preparation (extension)

```ts
const prep = await fetch(`${appUrl}/api/extension/ats/preparations`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ sourceUrl, vendor, fields }),
}).then((r) => r.json())

// The plan never contains answer values. Show FILL as a preview only.
// Blocked fields are in prep.preparation.openReviewTasks.
await fetch(`${appUrl}/api/extension/review-tasks/${taskId}`, {
  method: "PATCH",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    action: "RESOLVE",
    value: "No",
    scope: "APPLICATION",
  }),
})
```

The extension must not click Submit, accept terms, or infer submission from a
filled form. The final confirmation is the user's own action.
