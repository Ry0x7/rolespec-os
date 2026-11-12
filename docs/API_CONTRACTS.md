# API contracts

Updated: 2026-11-12. Normative for new route handlers. Existing routes are listed
as they behave today; the parity work does not rename or remove them.

## Conventions

- **Identity.** Every route resolves the caller through
  `resolveApiUserId(req)` in `src/features/auth/api-auth.ts`. Cookie sessions and
  bearer personal tokens are both accepted. A route never reads a `userId` from
  the body or query.
- **Mutation origin.** Cookie-authenticated mutations are checked against the
  request origin. `resolveApiUserId` rejects a cross-origin cookie request; a
  route that calls `isSameOriginRequest` explicitly returns `403`, while a route
  that relies on the resolver reports the same rejection as `401`. The extension
  uses a bearer token, which is not ambient and therefore not subject to the
  cookie CSRF rule.
- **Owner scoping.** Every Prisma read and write includes `userId` or traverses an
  owner-scoped relation. A foreign id returns `404`, not `403`, so existence is
  not leaked.
- **Validation.** JSON bodies are parsed with Zod schemas beside the feature
  (`src/features/<domain>/schemas`); only declared fields are consumed. Upload
  routes are the documented exception: they accept one bounded multipart `file`
  and run content sniffing before parsing.
- **Streaming.** Long-running reads use server-sent events with `no-store`; the
  stream re-reads persisted state rather than relying on an in-memory emitter.
- **Dates.** Request dates are ISO `YYYY-MM-DD` for calendar dates and full ISO
  timestamps for instants. Responses use the same forms. Calendar logic uses the
  user's timezone through `src/shared/lib/user-day.ts`.
- **Rate limits.** Buckets live in `src/shared/lib/rate-limit.ts` and are
  namespaced per feature. Exceeding one returns `429` with the standard
  `{ "error", "code": "RATE_LIMITED" }` envelope. The intake responses do not
  add a `Retry-After` header.
- **No secrets in responses.** Provider keys, token hashes and answer ciphertext
  never leave the server.
- **AI is optional.** A route that can use AI returns a deterministic result or a
  structured "needs your input" response when no provider is configured; it does
  not return `500` for a missing key. Existing AI errors keep their
  `AiKeyRequiredError` / `AiDailyLimitError` mapping.

## Error envelope

Every new route returns one of:

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE" }
```

```json
{ "error": "Validation failed", "code": "VALIDATION", "fields": { "title": "Required" } }
```

```json
{ "error": "Too many requests", "code": "RATE_LIMITED" }
```

Status codes: `200` read/update, `201` create, `202` accepted for asynchronous
work, `204` delete, `400` validation, `401` no identity, `403` cross-origin
mutation, `404` not found or not owned, `409` state conflict or illegal
transition, `422` a legal action with an unusable input (for example a missing
resume export), `429` rate limited, `500` unexpected. A `409` includes the
current state so the client can re-render instead of guessing.

## Existing routes

This table covers the routing surface, including the new application, outreach,
follow-up and settings routes. The intake routes are enumerated under
[Implemented: unified intake](#implemented-unified-intake). Methods in this table
are exactly those exported by each handler.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/account/export` | owner | Export the owner's data as a downloadable archive |
| `GET`, `POST` | `/api/activity` | owner | Read the activity feed; record an activity event |
| `GET`, `POST` | `/api/applications` | owner | List applications; create an application with its job |
| `GET`, `PATCH`, `DELETE` | `/api/applications/:id` | owner | Read, update or delete one application |
| `POST`, `DELETE` | `/api/applications/:id/followup` | owner | Schedule or clear a legacy follow-up date |
| `GET`, `POST` | `/api/submission-attempts` | owner | List or manually stage a durable submission attempt |
| `GET`, `PATCH` | `/api/submission-attempts/:id` | owner | Read one attempt; confirm submitted/not submitted |
| `GET` | `/api/follow-ups` | owner | List durable EMAIL/LINKEDIN reminders |
| `PATCH` | `/api/follow-ups/:id` | owner | Mark a reminder `DONE` or `DISMISS` |
| `GET`, `POST` | `/api/outreach/sequences` | owner | List or create a named outreach plan |
| `GET`, `PATCH` | `/api/outreach/sequences/:id` | owner | Read; `ACTIVATE` or `CANCEL` |
| `PATCH` | `/api/outreach/touches/:id` | owner | Report one manual touch `DONE` or `SKIPPED` |
| `GET`, `PUT`, `DELETE` | `/api/settings/ai-stages` | owner | Per-stage AI provider/model/key overrides |
| `POST` | `/api/career-profile/import-linkedin` | owner | Import a LinkedIn PDF into the career profile |
| `GET` | `/api/cron/prune-exports` | cron secret | Delete expired resume exports and stored PDFs |
| `GET` | `/api/cron/prune-rate-limits` | cron secret | Delete expired rate-limit attempts |
| `GET` | `/api/exports/*` | owner | Serve a stored export after ownership re-check |
| `POST` | `/api/extension/cold-email` | bearer token | Draft a cold email, connection note or LinkedIn DM |
| `POST` | `/api/extension/email-reply` | bearer token | Draft a reply to a received email |
| `POST` | `/api/extension/essay-draft` | bearer token | Draft one non-sensitive essay for human review |
| `POST` | `/api/extension/jobs` | bearer token | Save a clipped job as `INTERESTED` |
| `GET`, `POST` | `/api/extension/ats/preparations` | bearer token | List or create an idempotent ATS preparation with a server fill plan |
| `GET`, `PATCH` | `/api/extension/ats/preparations/:id` | bearer token | Read one preparation; record results, attach a resume, confirm submission or abandon |
| `GET`, `POST`, `DELETE` | `/api/extension/ats/answers` | bearer token | List, approve/edit or revoke reusable ATS answers |
| `GET` | `/api/extension/profile` | bearer token | Return the profile facts the autofill panel may use |
| `GET` | `/api/extension/review-tasks` | bearer token | Read the persistent ATS review queue |
| `PATCH` | `/api/extension/review-tasks/:id` | bearer token | Resolve, dismiss or attach a resume for one ATS review task |
| `GET` | `/api/extension/resumes/:id/pdf` | bearer token | Render an owned resume for user-triggered attachment |
| `POST` | `/api/extension/qualify` | bearer token | Qualify up to 40 visible postings for fit badges |
| `GET` | `/api/extension/resumes` | bearer token | List non-archived resumes for the picker |
| `GET` | `/api/extension/search-links` | bearer token | Build board search links from the profile |
| `GET` | `/api/health` | public | Liveness and database check |
| `GET`, `POST` | `/api/jobs` | owner | List jobs; create a job |
| `GET`, `PATCH`, `DELETE` | `/api/jobs/:id` | owner | Read, update or delete one job |
| `POST` | `/api/jobs/scrape` | owner | Fetch and extract a posting from a URL |
| `POST` | `/api/linkedin/assist` | owner | Generate LinkedIn profile suggestions |
| `POST` | `/api/linkedin/rating` | owner | Rate the owner's LinkedIn PDF export with optional resume context |
| `GET`, `POST` | `/api/notes` | owner | List notes; create a note |
| `PATCH`, `DELETE` | `/api/notes/:id` | owner | Update or delete a note |
| `POST` | `/api/resume/parse` | owner | Parse an uploaded PDF/DOCX resume |
| `GET`, `POST` | `/api/todos` | owner | List todos; create a todo |
| `PATCH`, `DELETE` | `/api/todos/:id` | owner | Update or delete a todo |

### Existing behavior that new code must preserve

- `POST /api/extension/jobs` accepts the clip form, normalizes the URL, dedupes
  per owner, stores a qualification snapshot and returns optional `risk` and
  `requirements`. It never stamps `dateApplied`.
- `POST /api/extension/qualify` caps at 40 postings per request and returns no
  candidate text beyond the verdict and matched capability names.
- `POST /api/resume/parse` enforces 5 MB, MIME/extension/signature checks, a
  200,000-character extraction cap, a timeout, and the owner check. `useAi` is
  the only way to opt into AI.
- `GET /api/exports/*` re-checks resume ownership; storage paths are not an
  authorization mechanism.
- `/api/cron/*` is useless without `CRON_SECRET`. A self-hosted install must call
  it or accept indefinite retention.

## New routes

Every route in this section is implemented. Intake, ranking, workflow,
review-task, ATS preparation/answer, resume-PDF, submission-attempt, follow-up,
outreach, per-stage AI settings and essay-draft routes all exist in the tree.
All routes are owner-scoped, validate with Zod where a body is accepted, and
return the error envelope above. Routes that read or write personal data send
`Cache-Control: private, no-store`.

### Implemented: unified intake

Six sources (`RESUME`, `GITHUB`, `LINKEDIN`, `WEB`, `CHAT`, `VOICE`) produce the
same `IntakePatch` review unit. A run is `PENDING`/`RUNNING`/`COMPLETED`/
`PARTIAL`/`FAILED`/`CANCELLED`; a source is `PENDING`/`RUNNING`/`SUCCEEDED`/
`PARTIAL`/`FAILED`/`CANCELLED`/`SKIPPED`. The shared run shape is:

```json
{
  "id": "cuid",
  "status": "PARTIAL",
  "requestedSources": ["RESUME", "GITHUB"],
  "error": null,
  "warnings": ["GITHUB: GitHub is rate limiting public requests."],
  "startedAt": "2026-11-11T15:00:00.000Z",
  "finishedAt": "2026-11-11T15:00:08.000Z",
  "createdAt": "2026-11-11T15:00:00.000Z",
  "sources": [{ "id": "cuid", "source": "GITHUB", "status": "FAILED", "progress": 0, "message": null, "error": "GitHub is rate limiting public requests.", "startedAt": "…", "finishedAt": "…" }],
  "patches": [{
    "id": "cuid",
    "kind": "EVIDENCE",
    "source": "RESUME",
    "status": "PENDING",
    "confidence": 85,
    "data": { "evidenceKind": "EXPERIENCE", "title": "Backend Engineer", "organization": "Acme", "details": null, "outcome": null, "startDate": "2021-01-01", "endDate": null },
    "provenance": { "adapter": "resume-text", "sourceUrl": null, "fileName": "cv.pdf", "externalId": null, "locator": "experience:1", "fetchedAt": "…", "detail": null },
    "rejectionReason": null,
    "appliedTargetType": null,
    "appliedTargetId": null,
    "correctedAt": null,
    "conflict": null
  }],
  "counts": { "pending": 1, "applied": 0, "conflicts": 0, "rejected": 0 }
}
```

Source `input` (resume text, LinkedIn export text, chat/voice transcript, URL and
consent) is stored on `IntakeSourceRun.input` so retry works after a restart. It
is **server-side only** and is never included in the DTO above.

#### `GET /api/intake`

List the owner's recent runs. Query `limit` (default 10, clamped 1–50). Response
`200`: `{ "runs": IntakeRun[] }`. No source content is returned.

#### `POST /api/intake`

Create and schedule a run. Rate limit: `intake:run`, 10 per 10 minutes.

```json
{
  "requests": [
    { "source": "RESUME", "input": { "resumeId": "cuid" } },
    { "source": "RESUME", "input": { "text": "…", "fileName": "cv.pdf" } },
    { "source": "GITHUB", "input": { "url": "https://github.com/handle", "consent": true } },
    { "source": "WEB", "input": { "url": "https://example.dev", "consent": true } },
    { "source": "LINKEDIN", "input": { "text": "…", "fileName": "profile.pdf", "useAi": false } },
    { "source": "CHAT", "input": { "transcript": [{ "role": "user", "content": "…" }], "missingFields": ["contactEmail"], "useAi": false } },
    { "source": "VOICE", "input": { "transcript": "…", "inputMode": "PASTED", "useAi": false } }
  ],
  "idempotencyKey": "optional-client-uuid"
}
```

Exactly one request per source, 1–6 requests. `RESUME` needs `resumeId` or at
least 20 characters of `text`. `GITHUB`/`WEB` require `consent: true`. Response
`202`: `{ "run": IntakeRun }`. Reusing an `idempotencyKey` (8–100 chars) returns
the existing run id with the same shape. Errors: `400 INVALID_INPUT`, `401`, `429
RATE_LIMITED`, `500 INTAKE_FAILED`.

#### `POST /api/intake/upload?source=RESUME|LINKEDIN&useAi=0|1`

Multipart `file` upload. Resume accepts PDF/DOCX up to 10 MB; LinkedIn accepts
the user's own PDF export up to 5 MB. Leading bytes decide the parser, not the
browser MIME type. `useAi=1` is opt-in and LinkedIn-only; the adapter falls back
to deterministic parsing if the provider is unavailable. Rate limit: `intake:upload`,
10 per 10 minutes. Response `202`: `{ "run": IntakeRun }`. Errors: `400` bad body/
unreadable text, `413 TOO_LARGE`, `415 INVALID_TYPE`, `429`, `500`.

#### `POST /api/intake/chat`

Preview conversational extraction without persisting anything. Rate limit:
`intake:chat`, 40 per 10 minutes.

```json
{ "transcript": [{ "role": "user", "content": "I worked at Acme as a Backend Engineer from 2021 to 2023." }], "missingFields": ["contactEmail"], "useAi": false }
```

Response `200`: `{ "mode": "deterministic"|"ai", "patches": IntakePatchDraft[], "nextQuestion": string|null, "warnings": string[] }`.
`patches` here are previews with `kind`, `data`, `confidence`, `provenance`; they
have no database id and are not applied. The client starts a real `CHAT` run with
the accepted transcript. AI failure returns `mode: "deterministic"` plus a
warning, not `500`.

#### `GET /api/intake/:id`

Return `{ "run": IntakeRun }`. A foreign or missing id returns `404
INTAKE_NOT_FOUND`.

#### `GET /api/intake/:id/stream`

Server-sent events. Content type `text/event-stream`; the route polls persisted
progress every 750 ms and closes when the run is `COMPLETED`, `FAILED` or
`CANCELLED` (about six minutes maximum). Events:

```text
event: progress
data: {"id":"cuid","status":"RUNNING",...}

event: ping
data: {}

event: error
data: {"error":"…"}
```

`progress` carries the same run DTO. Repeated identical states are suppressed.
A client disconnect aborts the stream. Auth is the same cookie/bearer identity as
the detail route; the SSE response is `no-store`.

#### `POST /api/intake/:id/cancel`

Cancel a `PENDING` or `RUNNING` run. Non-terminal sources become `CANCELLED`, the
in-process signal is aborted, and the run becomes `CANCELLED`. Response `200`:
`{ "run": IntakeRun }`. A completed run returns `409 INTAKE_STATE`; an already
cancelled run is idempotent.

#### `POST /api/intake/:id/retry`

Reset only `FAILED`/`CANCELLED` sources to `PENDING`, delete their unapplied
patches, and schedule the run again. Succeeded sources are never re-read. Response
`202`: `{ "run": IntakeRun }`. `409` when the run is still active or has no failed
source.

#### `POST /api/intake/:id/patches/:patchId`

Apply one proposed fact. Body is optional:

```json
{ "disposition": "KEEP_EXISTING" | "ACCEPT_INCOMING" | "KEEP_BOTH" }
```

With no collision, response `200`:

```json
{ "status": "APPLIED", "patchId": "cuid", "appliedTargetType": "career_evidence", "appliedTargetId": "cuid", "conflict": null, "message": "…" }
```

A collision with no disposition returns `200` with `status: "CONFLICT"` and a
persisted `IntakeConflict` (not an overwrite). `KEEP_EXISTING` marks the patch
`REJECTED`; `ACCEPT_INCOMING` updates the existing row (refuses a confirmed
evidence row with `409`); `KEEP_BOTH` is legal only for evidence. `404` foreign id.

#### `PATCH /api/intake/:id/patches/:patchId`

Correct a fact before or after apply. Body:

```json
{ "correction": { "kind": "EVIDENCE", "data": { "evidenceKind": "EXPERIENCE", "title": "…", "organization": null, "details": null, "outcome": null, "startDate": null, "endDate": null } }, "note": "optional" }
```

The correction is validated by the same canonical schema, the patch fingerprint
is recomputed, the applied target is updated if the patch was already applied,
and an `IntakeCorrection` audit row is written. A conflict is dismissed when a
correction makes it moot. Response `200`: `{ "status": "APPLIED"|"PENDING", "patchId": "cuid" }`.

#### `DELETE /api/intake/:id/patches/:patchId`

Reject a proposed fact. Optional `{ "reason": "…" }`. Applied facts cannot be
rejected retroactively (`409`); edit the profile instead. Response `200`:
`{ "status": "REJECTED", "patchId": "cuid" }`.

### Implemented: workflow engine and review tasks

The workflow engine is one durable run per application attempt. Every route
requires the owner session; mutating routes also reject a foreign `Origin` with
`403`. A run is created in `MANUAL` state even for `AGENT_ASSISTED`, then `START`
queues it. `mode` and `state` are separate on purpose: the mode says who does the
work, the state says what is happening now.

Shared run shape (`WorkflowRun`):

```json
{
  "id": "cuid",
  "jobApplicationId": "cuid",
  "kind": "APPLICATION",
  "mode": "AGENT_ASSISTED",
  "state": "ASSISTED",
  "input": { "jobApplicationId": "cuid", "jobId": "cuid", "resumeId": "cuid", "targetRole": "Backend Engineer" },
  "lastError": null,
  "startedAt": "2026-11-11T15:00:00.000Z",
  "finishedAt": null,
  "createdAt": "2026-11-11T15:00:00.000Z",
  "updatedAt": "2026-11-11T15:00:00.000Z",
  "steps": [{
    "id": "cuid",
    "name": "PROFILE",
    "order": 0,
    "status": "COMPLETED",
    "required": true,
    "dependsOn": [],
    "attempts": 1,
    "maxAttempts": 1,
    "output": { "targetRoles": 2, "confirmedCapabilities": 8 },
    "lastError": null,
    "startedAt": "2026-11-11T15:00:01.000Z",
    "finishedAt": "2026-11-11T15:00:01.100Z"
  }],
  "openReviewTaskIds": []
}
```

The step set is always the eleven pipeline steps, in this order: `PROFILE`,
`DISCOVER`, `RANK`, `RESEARCH`, `TAILOR`, `VALIDATE`, `PREPARE_ATS`,
`HUMAN_REVIEW`, `SUBMISSION_STAGING`, `TRACKING`, `FOLLOW_UP`. `DISCOVER` and
`FOLLOW_UP` are optional; the rest are required for `COMPLETED`.

#### `GET /api/workflows`, `POST /api/workflows`

`GET` query: `state?` (a `WorkflowState`), `kind?` (a `WorkflowKind`), `limit`
(default 20, clamped 1–50). An unknown state or kind is `400 INVALID_INPUT`.
Response `200`: `{ "items": WorkflowRun[] }`. There is no cursor; the native
list is small and owner-scoped.

`POST` body (`.strict()` — unknown keys are rejected):

```json
{
  "jobApplicationId": "cuid?",
  "mode": "MANUAL" | "AGENT_ASSISTED",
  "kind": "APPLICATION",
  "idempotencyKey": "8-120 chars, optional",
  "input": { "resumeId": "cuid?", "targetRole": "200 chars max" }
}
```

`mode` defaults to `AGENT_ASSISTED`; `kind` currently accepts only `APPLICATION`.
The other `WorkflowKind` enum values are reserved for future pipelines and are
rejected here rather than silently producing an application pipeline. When
`jobApplicationId` is present, the application must belong to the owner; its
`jobId` and `resumeId` are folded into the run input snapshot. Response `201`:
`{ "workflow": WorkflowRun }`. A repeated `(userId, idempotencyKey)` returns the
existing run instead of creating a second one. One application may have only one
active run (`MANUAL`, `ASSISTED`, `AWAITING_REVIEW` or `PAUSED`); a second active
create is `409 CONFLICT`. Rate limit: `workflow:create`, 20 per 10 minutes.
Errors: `400 INVALID_INPUT`, `401`, `403`, `404` for a foreign application,
`409`, `429`, `500`.

#### `GET /api/workflows/:id`

Returns `{ "workflow": WorkflowRun }` with the shape above. `404` for a foreign
or missing id. The response never includes another owner's input or output.

#### `GET /api/workflows/:id/events?limit=50`

Returns persisted history, oldest first:

```json
{
  "events": [{
    "id": "cuid",
    "type": "STEP_COMPLETED",
    "stepName": "PROFILE",
    "message": "PROFILE: Profile ready with 2 target role(s) and 8 confirmed skill(s).",
    "metadata": { "summary": "…" },
    "createdAt": "2026-11-11T15:00:01.100Z"
  }]
}
```

`limit` defaults to 50 and is clamped 1–200. Messages and metadata are
redacted; they never contain provider keys, raw profile text or review answers.
`404` for a foreign run.

#### `GET /api/workflows/:id/stream`

Server-sent events over the same owner session. The stream polls persisted rows
every 750 ms and emits:

```text
event: progress
data: { ...WorkflowRun }

event: ping
data: {}

event: error
data: { "error": "…" }
```

`progress` is sent whenever the run payload changes (not a fabricated
percentage); `ping` is a keepalive. The stream ends at `COMPLETED`, `FAILED` or
`CANCELLED`, after roughly six minutes, or when the client disconnects. A reload
or a second tab sees the same persisted state.

#### `POST /api/workflows/:id/advance`

The only user-triggered advancement. Body (`.strict()`):

```json
{ "action": "START" | "RESUME" | "RETRY" | "PAUSE" | "CANCEL" | "COMPLETE_STEP", "stepName": "PROFILE" }
```

`stepName` is required only for `COMPLETE_STEP` and must be one of the eleven
pipeline names.

| Action | Legal from | Effect | Status |
| --- | --- | --- | --- |
| `START` | `MANUAL` | `AGENT_ASSISTED` → `ASSISTED` and schedule a tick; `MANUAL` stays `MANUAL` and is stamped started | `202` assisted, `200` manual |
| `RESUME` | `PAUSED` | Re-queues only when no checkpoint is open; otherwise returns to `AWAITING_REVIEW`. A `FAILED` run uses `RETRY` | `202` |
| `RETRY` | `FAILED` | Resets only `FAILED` steps and re-queues the run | `202` |
| `PAUSE` | `ASSISTED`, `AWAITING_REVIEW` | Clears the lease; in-flight output is discarded | `200` |
| `CANCEL` | Any non-terminal state | Cancels pending/running steps and expires open tasks | `200` |
| `COMPLETE_STEP` | A `MANUAL` run | Marks that step `COMPLETED`; finishes the run on the last required step | `200` |

An illegal transition is `409` with `{ error, code, state }`; a foreign run is
`404`. Rate limit: `workflow:advance`, 120 per 10 minutes. The route performs no
model call inline; it updates state and asks the worker to tick.

#### `GET /api/review-tasks`, `POST /api/review-tasks`

`GET` query: `status` (default `OPEN`; one of `OPEN`/`RESOLVED`/`DISMISSED`/
`EXPIRED`), `kind?`, `limit` (default 20, clamped 1–50). Unknown filters are `400`.
Response `200`: `{ "items": ReviewTask[] }`.

Rate limit: `review:web`, 120 requests per 10 minutes, shared by `GET`/`POST`
on this route and `PATCH /api/review-tasks/:id`. A limit hit is
`429 RATE_LIMITED`.

`POST` records a standalone blocked field when it is not attached to a server
run (for example, the extension):

```json
{
  "jobApplicationId": "cuid?",
  "kind": "SENSITIVE_ANSWER",
  "question": "Are you authorized to work in the United States?",
  "reason": "Work authorization needs your explicit answer.",
  "category": "authorization",
  "fallback": "Enter the answer on the form yourself.",
  "suggestedValue": null
}
```

`question` and `reason` are required, 1–2000 characters. Response `201`:
`{ "task": ReviewTask }` with `status: "OPEN"` and `runId: null`. A foreign
`jobApplicationId` is `404`.

#### `PATCH /api/review-tasks/:id`

Resolve or dismiss a task. Body (`.strict()`):

```json
{ "action": "RESOLVE", "value": { "approved": true } }
{ "action": "DISMISS", "reason": "I will apply manually." }
```

- `RESOLVE` requires a `value`. For `SUBMISSION_CONFIRMATION`, only an explicit
  object with `approved: true` approves staging. Any other value is recorded as
  `approved: false`; submission staging then refuses with a named fallback.
- Resolving the last open task and moving the run to `ASSISTED` schedules a
  worker tick. `DISMISS` pauses an `AWAITING_REVIEW` run with the reason kept.
- `409` if the task is not `OPEN`; `404` for a foreign task.
- The response is `{ "task": ReviewTask, "run": WorkflowRun | null,
  "preparation": AtsPreparationView | null }`. `preparation` is present when the
  task belongs to an ATS preparation and reflects the refreshed status. The
  response repeats the stored `answer` as submitted; it never returns another
  owner's task.

Review-task answers are workflow decisions. ATS question memory is the separate
`AtsAnswer` resource below. Durable application staging is
`/api/submission-attempts`; there is no `/api/submissions` route.

### Implemented: ATS preparation and the persistent review queue

The browser extension is the only caller. Every route below requires
`Authorization: Bearer rspec_…`; a cookie session is never accepted. Responses
carry the extension CORS headers for the configured app origin. Every resource is
scoped to the token owner, and a foreign id is `404`, never a silent empty result.

An `AtsPreparation` is a staged claim about one form, not a submitted application.
It stores the vendor, source and canonical URL, page/job/company labels, the
chosen resume, the server plan, field-level results, review task ids and
timestamps. It stores no page HTML, no file bytes and no answer values.

Preparation status is derived, never client-set:

| Status | When |
| --- | --- |
| `DRAFT` | Created with no detected fields |
| `READY_FOR_REVIEW` | At least one linked `ReviewTask` is `OPEN` |
| `READY_TO_SUBMIT` | No open task and at least one field is detected |
| `SUBMITTED` | The user explicitly confirmed submission |
| `NOT_SUBMITTED` | The user explicitly said it was not submitted |
| `ABANDONED` | The user abandoned it; a submitted preparation cannot be abandoned |

Shared preparation shape (`AtsPreparationView`):

```json
{
  "id": "cuid",
  "jobApplicationId": "cuid",
  "workflowRunId": null,
  "vendor": "greenhouse",
  "sourceUrl": "https://boards.greenhouse.io/acme/jobs/1?utm_source=x",
  "canonicalUrl": "https://boards.greenhouse.io/acme/jobs/1",
  "pageTitle": "Nurse Manager at Acme Health",
  "jobTitle": "Nurse Manager",
  "companyName": "Acme Health",
  "status": "READY_FOR_REVIEW",
  "resumeId": "cuid",
  "resumeTitle": "Marisol — Nurse Manager",
  "plan": {
    "fields": [
      {
        "fieldId": "af-0",
        "label": "Will you require visa sponsorship?",
        "questionKey": "will you require visa sponsorship",
        "category": "sponsorship",
        "sensitivity": "sensitive",
        "decision": "REVIEW",
        "required": true,
        "reason": "Sponsorship needs your explicit answer."
      }
    ],
    "fillCount": 4,
    "reviewCount": 3,
    "resumeUploadCount": 1
  },
  "results": [
    { "fieldId": "af-0", "status": "REVIEW_REQUIRED", "reason": "Sensitive question" }
  ],
  "reviewTaskIds": ["cuid"],
  "fieldsDetected": 8,
  "fieldsFilled": 4,
  "fieldsBlocked": 3,
  "approvedAt": null,
  "filledAt": null,
  "submittedAt": null,
  "submissionNote": null,
  "createdAt": "2026-11-11T15:00:00.000Z",
  "updatedAt": "2026-11-11T15:00:01.000Z",
  "openReviewTasks": [
    {
      "id": "cuid",
      "kind": "SENSITIVE_ANSWER",
      "status": "OPEN",
      "question": "Will you require visa sponsorship?",
      "reason": "Sponsorship needs your explicit answer.",
      "category": "ats:sponsorship",
      "fallback": "Enter the answer on the form yourself.",
      "suggestedValue": { "required": true, "questionKey": "will you require visa sponsorship" },
      "createdAt": "2026-11-11T15:00:01.000Z"
    }
  ]
}
```

A plan field is one of `FILL`, `REVIEW` or `ATTACH_RESUME`. Only
`identity`/`contact`/`link` facts already stored on the career profile, or a
question the owner explicitly approved, can be `FILL`. A `FILL` field names its
provenance (`profileKey` or `answerId`) and never repeats the value. An
application-scoped answer deliberately takes precedence over a global answer on
that form; a conflicting edit to an existing answer is `409` and creates one
`CONFLICTING_ANSWER` review task.

#### `GET /api/extension/ats/preparations`, `POST /api/extension/ats/preparations`

`GET` query: `jobApplicationId?`, `limit` (default 20, clamped by the service).
Response `200`: `{ "preparations": AtsPreparationView[] }`.

`POST` body (`.strict()`, unknown keys rejected):

```json
{
  "sourceUrl": "https://boards.greenhouse.io/acme/jobs/1?utm_source=x",
  "vendor": "greenhouse",
  "pageTitle": "Nurse Manager at Acme Health",
  "jobTitle": "Nurse Manager",
  "companyName": "Acme Health",
  "jobApplicationId": "cuid",
  "resumeId": "cuid",
  "fields": [
    {
      "fieldId": "af-0",
      "label": "Will you require visa sponsorship?",
      "name": "sponsorship",
      "type": "text",
      "tagName": "input",
      "autocomplete": null,
      "required": true,
      "options": ["Yes", "No"],
      "requiresSelection": false,
      "frameId": 0
    }
  ],
  "results": [
    { "fieldId": "af-0", "status": "REVIEW_REQUIRED", "reason": "Sensitive question" }
  ]
}
```

`fields` is capped at 150; `results` at 150. `sourceUrl` must be an http(s) URL.
The server canonicalises it, normalises an unknown vendor to `generic`, hashes
`vendor + canonicalUrl` and upserts by `(userId, preparationKey)`, so a re-scan
returns the same preparation. It re-classifies every field; the client's
category, sensitivity or decision is not accepted. A linked application or
resume must belong to the same owner (`404` otherwise).

Response `201` when created, `200` when refreshed:

```json
{
  "preparation": AtsPreparationView,
  "approvedAnswers": [
    { "id": "cuid", "questionKey": "will you require visa sponsorship", "value": "No", "scope": "APPLICATION", "category": "sponsorship" }
  ],
  "created": true
}
```

`approvedAnswers` is returned so the panel can pre-fill review inputs. It is
only ever the owner's live answers.

#### `GET /api/extension/ats/preparations/:id`

Response `200`: `{ "preparation": AtsPreparationView }`. `404 NOT_FOUND` for a
foreign or missing preparation.

#### `PATCH /api/extension/ats/preparations/:id`

A discriminated union on `action` (`.strict()`):

```json
{ "action": "RECORD_RESULTS", "results": [{ "fieldId": "af-0", "status": "FILLED" }] }
{ "action": "ATTACH_RESUME", "resumeId": "cuid" }
{ "action": "CONFIRM_SUBMISSION", "submitted": true, "note": "Confirmation page shown." }
{ "action": "ABANDON" }
```

- `RECORD_RESULTS` updates the field-level report and refreshes status.
- `ATTACH_RESUME` validates that the resume is owned and not archived, then stores
  its id and title. It does not upload anything.
- `CONFIRM_SUBMISSION` is the only path that writes `SUBMITTED` / `NOT_SUBMITTED`.
  On `submitted: true` and a linked application, it moves the application to
  `APPLIED`, sets `dateApplied` once, and appends
  `ApplicationStatusEvent { source: "EXTENSION" }`. It never infers submission
  from a filled form or page event. Response:
  `{ "preparation": AtsPreparationView, "applicationStatus": "APPLIED" | null }`.
  Confirmation is one-way: once `SUBMITTED`, `submitted: false` returns
  `409 TERMINAL` and never downgrades the preparation or the tracker.
- `ABANDON` is `409 TERMINAL` for a submitted preparation.

Rate limits: `extension:ats-prepare` 40 per 10 minutes, shared by the list/create/
read/update routes. A limit hit is `429 RATE_LIMITED`.

#### `GET /api/extension/ats/answers`

Query: `preparationId?`, `questionKey?`. Returns the owner's live (non-revoked)
answers, newest first, capped at 200:

```json
{ "answers": [{
  "id": "cuid", "preparationId": "cuid", "questionKey": "will you require visa sponsorship",
  "questionText": "Will you require visa sponsorship?", "category": "sponsorship",
  "sensitivity": "sensitive", "value": "No", "scope": "APPLICATION",
  "source": "USER_APPROVED", "approvedAt": "2026-11-11T15:00:00.000Z",
  "lastUsedAt": null, "useCount": 0
}]}
```

When `preparationId` is given, global answers plus that preparation's
application-scoped answers are returned.

#### `POST /api/extension/ats/answers`

```json
{
  "preparationId": "cuid",
  "questionText": "Will you require visa sponsorship?",
  "value": "No",
  "scope": "APPLICATION",
  "replace": false
}
```

`value` is a non-empty string (2000 chars), boolean, or up to 20 strings.
`APPLICATION` scope requires `preparationId`, and the question must already be
detected in that preparation's plan. The question key is derived from
`questionText`. A live answer with a different value is `409 CONFLICT` unless
`replace: true`; the error includes the existing answer for the owner. The
conflict also creates one open `CONFLICTING_ANSWER` task on the preparation
(without duplicating an existing one), so the decision stays visible in the
review queue.

Response `201`:

```json
{
  "answer": AtsAnswerView,
  "resolvedTaskIds": ["cuid"],
  "preparation": AtsPreparationView
}
```

Approving an answer resolves matching open review tasks for that preparation and
recomputes preparation status. Answer values are owner-scoped, never logged and
never included in a plan or review task's suggested-value envelope. Values are
encrypted at rest with the answer envelope (`enc.v1.<secret-box payload>`);
legacy plaintext rows remain readable and are re-encrypted on the next edit.

#### `DELETE /api/extension/ats/answers`

Body `{ "id": "cuid" }`. Revokes the answer by setting `revokedAt`, keeps the row
for provenance, omits it from future plans and reopens its review task when it
belonged to a preparation. Response `200`:
`{ "revoked": true, "preparation": AtsPreparationView | null }`.
A foreign answer is `404`.

Rate limits: `extension:ats:answers` 80 per 10 minutes for list/approve/revoke.

#### `GET /api/extension/review-tasks`

Bearer-token view of the same persistent queue as `/api/review-tasks`. Query:
`status` (default `OPEN`), `kind?`, `limit` (default 50). Unknown filters are
`400 VALIDATION`. Response `200`: `{ "items": ReviewTask[] }`, owner-scoped and
ordered newest first. ATS tasks include `atsPreparationId` and their
`suggestedValue` never contains an answer value.

#### `PATCH /api/extension/review-tasks/:id`

```json
{ "action": "RESOLVE", "value": "No", "scope": "APPLICATION" }
{ "action": "DISMISS", "reason": "I will answer on the page." }
{ "action": "ATTACH_RESUME", "resumeId": "cuid" }
```

- `RESOLVE` on a task linked to an ATS preparation records the approved answer,
  optionally `GLOBAL`, resolves the task and refreshes the preparation.
- `DISMISS` leaves the answer unknown and keeps the preparation reviewable.
- `ATTACH_RESUME` records the chosen resume on the linked preparation.
- A task that is not `OPEN` is `409 TASK_NOT_OPEN`; a foreign task is `404`.
- Response: `{ "task": ReviewTask, "run": WorkflowRun | null, "preparation": AtsPreparationView | null, "answerRecorded": boolean }`.
  Resolving a workflow task still uses the workflow path and schedules a tick
  when the run returns to `ASSISTED`.

Rate limit: `extension:ats:review` 60 per 10 minutes.

#### `GET /api/extension/resumes/:id/pdf`

Renders an owned, non-archived resume with its existing template. Returns
`application/pdf` with `Content-Disposition: inline`, `Cache-Control: private,
no-store` and `X-Content-Type-Options: nosniff`. The extension calls it only after
an explicit Attach press; it never uploads the file itself. A foreign or archived
resume is `404 RESUME_NOT_FOUND`; a render failure is `500 PDF_FAILED`; renders
over 12 MiB are refused. Rate limit: `extension:resume:pdf` 12 per 10 minutes.

### Implemented: resume tailoring, provenance and single-page export

These are authenticated server actions and one internal service, not public HTTP
routes. They share the owner scoping and error envelope conventions above.

#### `createJobTailoredResume(formData)` — manual editor action

Fields: `title`, `sourceResumeId`, `jobApplicationId`. The action authenticates,
validates ownership, applies the per-user tailoring rate limit, maps requirements
to source evidence, generates and applies reformulations, validates the whole
document, then writes in this order: `Resume` (`DRAFT`, `JOB_TAILORED`) →
`ResumeSnapshot` (immutable source payload) → `ResumeTailoringRun` →
`ResumeValidation` → `ResumeEditEvent`. On success it redirects to the editor
with `?jobId=`.

A `FAIL` report returns `{ error, validation }` and writes **no resume**. The
existing manual editor remains usable without AI.

```json
{
  "success": true,
  "resumeId": "cuid",
  "tailoringRunId": "cuid",
  "snapshotHash": "sha256-hex",
  "validation": {
    "status": "PASS | NEEDS_REVIEW | FAIL",
    "sourceHash": "sha256-hex",
    "issues": [{ "code": "FABRICATED_METRIC", "severity": "error", "message": "…" }],
    "claims": [{ "claimId": "claim-1", "itemRef": "…", "evidenceRefs": [], "requirementIds": [] }],
    "requirementCoverage": { "supported": 4, "partial": 2, "unsupported": 3, "total": 9 }
  },
  "requirements": [{ "id": "req-1", "verdict": "SUPPORTED", "evidenceRefs": [] }]
}
```

#### `tailorResumeForApplication({ userId, jobApplicationId, sourceResumeId?, mode })` — internal workflow service

Same pipeline as the manual action, plus bounded repair: up to three total model
generations, each repair receiving the exact validation/rejection messages. On a
`FAIL` after the cap it returns
`{ ok: false, reason: "VALIDATION_FAILED", validation, runId }` and creates no
resume. On warnings it creates a DRAFT with `ResumeTailoringRun.status =
NEEDS_REVIEW` and `review` instructions. It never changes
`JobApplication.resumeId`.

#### `validateExecutor` (workflow `VALIDATE`)

Loads `ResumeTailoringRun.snapshot`, `requirementMap` and the stored draft
sections, re-runs `validateTailoredResume()`, appends a second `ResumeValidation`
and fails the step on `FAIL`. Output: `{ validated, resumeId, tailoringRunId,
validationStatus, claims, evidenceReferences, issueCount, requirementCoverage }`.

#### `rollbackTailoredResume(resumeId, snapshotId?)`

Restores `ResumeSnapshot.payload.sections` and increments `Resume.version`.
Returns `{ success: true, restoredFrom: "snapshot" | "live-source", snapshotId?,
sourceVersion? }`. The live-source branch exists only for resumes created before
snapshots and is labeled `live-source`; new resumes always use the snapshot.

#### `getTailoredResumeDiff(resumeId)`

Compares the tailored draft against the **captured** source revision, not the live
source. Returns `{ success, diff, comparedAgainst: "snapshot" | "live-source",
sourceVersion? }`; only resumes created before snapshots exist use the labeled
live-source fallback.

#### `getResumeHistory(resumeId)`

Read-only. Returns up to 50 `ResumeEditEvent` rows (newest first), up to 20
snapshot descriptors without payload, the current `version`, the latest
`ResumeValidation` report, the latest `ResumeTailoringRun` summary, and its
requirement map (`RequirementEvidence[]`) for the job-requirement comparison.
Used by the comparison/history surface.

```json
{
  "data": {
    "resumeId": "cuid",
    "version": 5,
    "editEvents": [{ "kind": "ROLLBACK", "versionBefore": 4, "versionAfter": 5, "summary": "…" }],
    "snapshots": [{ "id": "cuid", "sourceVersion": 2, "hash": "…", "restoreCount": 1 }],
    "latestValidation": { "status": "PASS", "report": { "claims": [], "issues": [] } },
    "tailoring": { "status": "COMPLETED", "mode": "MANUAL", "attempts": 1 },
    "requirements": [{ "id": "req-1", "verdict": "SUPPORTED", "evidenceRefs": [] }]
  }
}
```

#### `saveResume(resumeId, sections, { baseVersion? })`

Optimistic concurrency: when `baseVersion` is supplied and differs from the
stored version, returns `{ error, conflict: true, currentVersion }`. The editor
autosave sends the version it loaded and adopts the server's returned `version`
after every successful save. A changed payload increments `Resume.version` and
appends a `MANUAL_EDIT` edit event; an unchanged autosave does neither.

#### `exportResumePdf(resumeId, options)`

Default output is unchanged: `{ success, pdfUrl, template }`. With
`singlePage: true` it returns additionally `{ pageCount, singlePageSatisfied,
layoutAttempts, warning? }`. It renders the same template with at most three
tighter presentation configurations, stores only the chosen PDF, and returns
the tightest render plus `SINGLE_PAGE_WARNING` when one page is impossible.

### Superseded: `/api/answers` and `/api/extension/answers/resolve`

The reusable-answer contract is delivered at `/api/extension/ats/answers`
(above). The earlier `ApprovedAnswer` model and these routes were not built; do
not call them. Answer values stay out of preparation plans and review-task
suggested values, and are readable only by the token owner.

### Implemented: submission attempts

One durable record for a staged application, whether it came from the workflow
`SUBMISSION_STAGING` step, an extension `AtsPreparation`, or the user staging
manually. It is evidence, not a submission: only an explicit user confirmation
changes its state, and no endpoint here submits anything.

`SubmissionAttempt` fields: `id`, `jobApplicationId`, `workflowRunId`,
`atsPreparationId`, `resumeId`, `source` (`WORKFLOW`, `EXTENSION`, `MANUAL`),
`status`, `jobTitle`, `companyName`, `sourceUrl`, compact `evidence`, `confirmedAt`,
`confirmationNote`, timestamps. `workflowRunId` and `atsPreparationId` are unique,
so a replay reads the existing row instead of creating a duplicate.

#### `GET /api/submission-attempts`, `POST /api/submission-attempts`

Browser cookie; mutating `POST` requires same-origin. GET query: `status?`
(`STAGED`, `SUBMITTED`, `NOT_SUBMITTED`, `ABANDONED`), `jobApplicationId?`,
`limit?` (1–50, default 20). Response `200`: `{ items: SubmissionAttempt[] }`.
List does not consume a write bucket; it is owner-scoped.

`POST` body:

```json
{
  "jobApplicationId": "cuid",
  "resumeId": "cuid",
  "evidence": { "atsHost": "jobs.lever.co", "filledFields": 6 }
}
```

`jobApplicationId` is required; `resumeId` and `evidence` are optional. The
application and a non-archived resume must belong to the owner. Response `201`:
`{ attempt }` with `source: "MANUAL"` and `status: "STAGED"`. A replay for the
same manual application returns the existing row. Errors: `401`, `403`,
`404 NOT_FOUND` / `RESUME_NOT_FOUND`, `400 INVALID_INPUT` / `INVALID_BODY`,
`429 RATE_LIMITED` (submission write bucket, 60 per 10 minutes), `500
SUBMISSION_STAGE_FAILED`.

#### `GET /api/submission-attempts/:id`, `PATCH /api/submission-attempts/:id`

`GET` returns `{ attempt }` or `404 NOT_FOUND`. `PATCH` requires same-origin and
the submission write bucket.

```json
{ "submitted": true, "note": "Submitted on the company site." }
```

`submitted` is required; `note` is optional and redacted before storage.
Response `200`: `{ attempt, applicationStatus, submitted }`.

Semantics:
- `submitted: true` moves the attempt to `SUBMITTED`, records `confirmedAt`, and
  advances an `INTERESTED` tracker row to `APPLIED` exactly once with an
  `ApplicationStatusEvent` (`source: USER`, `EXTENSION` or `WORKFLOW`).
- The same confirmation creates the durable `EMAIL` +5 and `LINKEDIN` +12
  business-day follow-up tasks. It also aligns the legacy `followUpAt` field with
  the email task when that field was empty; a user-set date is never overwritten.
- `submitted: false` records `NOT_SUBMITTED`. It is refused with `409 TERMINAL`
  after a confirmed submission; correct the tracker instead of downgrading.
- An `ABANDONED` or terminal row is refused with `409` rather than reopened.
- Errors: `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`,
  `400 INVALID_INPUT`, `409 CONFLICT` / `TERMINAL`, `429 RATE_LIMITED`, `500
  SUBMISSION_CONFIRM_FAILED`.

### Implemented: durable follow-ups

`FollowUpTask` is a reminder the user acts on. There is no send transport, no
auto-email and no auto-LinkedIn message. `channel` is `EMAIL` or `LINKEDIN`;
`status` is `PENDING`, `DONE`, `DISMISSED` or `CANCELLED`; `dueAt` and `appliedOn`
are calendar dates (`YYYY-MM-DD`). Confirming a submission creates EMAIL at +5
business days and LINKEDIN at +12 business days. Public holidays are not modelled.

#### `GET /api/follow-ups`

Browser cookie. Query: `status?`, `jobApplicationId?`, `due=1` (only `PENDING`
rows due today or earlier), `limit?` (1–100, default 50). Response `200`:
`{ items: FollowUpTask[] }`, ordered by `dueAt` then `createdAt`. Errors: `401`,
`400 INVALID_INPUT`, `429 RATE_LIMITED` (follow-up bucket, 120 per 10 minutes).
The read shares the follow-up write bucket so a stuck client cannot poll it.

#### `PATCH /api/follow-ups/:id`

Same-origin. Body `{ "action": "DONE" | "DISMISS" }`. Response `200`: `{ task }`
with the new status and `completedAt`. Errors: `401`, `403`, `404 NOT_FOUND`,
`400 INVALID_INPUT` / `INVALID_BODY`, `409 TERMINAL` when the application closed
and the task was cancelled, `429 RATE_LIMITED`, `500 FOLLOW_UP_UPDATE_FAILED`.

### Implemented: outreach sequences

A named outreach plan for one recruiter contact. Every touch is a reminder; the
API never sends anything and the response always reports `sent: false`.
`OutreachSequence.status`: `DRAFT`, `ACTIVE`, `COMPLETED`, `CANCELLED`.
`OutreachTouch.status`: `PENDING`, `DONE`, `SKIPPED`, `CANCELLED`; channels are
`EMAIL` and `LINKEDIN`. The default plan is EMAIL day 0, EMAIL +5 business days,
LINKEDIN +12 business days.

#### `GET /api/outreach/sequences`, `POST /api/outreach/sequences`

Browser cookie; `POST` is same-origin. GET query `status?`, `limit?` (1–100,
default 30). Response `200`: `{ sequences }`. Both methods consume the outreach
write bucket (60 per 10 minutes) and return `429 RATE_LIMITED` when exhausted.

`POST` body (strict; provide `contactId` or an inline `contact`):

```json
{
  "name": "Vercel platform recruiter",
  "startOn": "2026-11-12",
  "idempotencyKey": "optional-stable-key",
  "contact": {
    "name": "Sam Lee",
    "role": "Technical Recruiter",
    "company": "Vercel",
    "email": "sam@example.com",
    "linkedinUrl": "https://www.linkedin.com/in/example"
  }
}
```

Response `201`: `{ sequence }`. Replaying the same `idempotencyKey` returns the
existing plan. Errors: `401`, `403`, `400 INVALID_INPUT` / `INVALID_BODY`,
`404 NOT_FOUND` for a foreign contact, `409 CONFLICT`, `429 RATE_LIMITED`,
`500 OUTREACH_CREATE_FAILED`.

#### `GET /api/outreach/sequences/:id`, `PATCH /api/outreach/sequences/:id`

`GET` returns `{ sequence }` or `404`. `PATCH` is same-origin and takes
`{ "action": "ACTIVATE" }` or `{ "action": "CANCEL" }`. Activation moves a
`DRAFT` to `ACTIVE` (and is idempotent for an already active row); cancel marks
the sequence and its pending touches `CANCELLED`. A completed or cancelled
sequence is `409 TERMINAL`. Errors: `401`, `403`, `404`, `400 INVALID_INPUT`,
`409 CONFLICT` / `TERMINAL`, `429`, `500 OUTREACH_UPDATE_FAILED`.

#### `PATCH /api/outreach/touches/:id`

Same-origin. Body `{ "action": "DONE" | "SKIPPED" }`. Response `200`:
`{ sequence }` with the updated touch and `sent: false`. Completing the last
pending touch moves the sequence to `COMPLETED`. Errors: `401`, `403`, `404`,
`400 INVALID_INPUT`, `409 TERMINAL` for a closed sequence or cancelled touch,
`429`, `500 OUTREACH_UPDATE_FAILED`.

### Implemented: per-stage AI settings

Stages are `PROFILE`, `DISCOVER`, `RANK`, `RESEARCH`, `TAILOR`, `ATS`, `OUTREACH`.
A row overrides the user's normal provider for all calls in that stage; absent or
cleared means fall back unchanged. API keys are encrypted with the same
secret-box as the deployment key and only `last4` is ever returned.

#### `GET /api/settings/ai-stages`

Browser cookie. Response `200`: `{ items: UserAiStageSetting[], availableStages }`.
`UserAiStageSetting`: `{ stage, provider, model, configured, last4?, defaultModel }`.
No key material or ciphertext is returned.

#### `PUT /api/settings/ai-stages`

Same-origin. Body (strict):

```json
{ "stage": "TAILOR", "provider": "openai", "model": "gpt-5", "apiKey": "sk-…" }
```

`apiKey` is optional: omitted keeps the stored key, `clearApiKey: true` removes
it, and a non-empty value replaces it. Switching provider without a new key
clears the old provider's key so it cannot be sent to the wrong service.
Response `200`: `{ item }`. Errors: `401`, `403`, `400 INVALID_INPUT` /
`INVALID_BODY`, `429 RATE_LIMITED` (30 per 10 minutes), `500
AI_STAGE_SAVE_FAILED`.

#### `DELETE /api/settings/ai-stages?stage=TAILOR`

Same-origin. Removes the override. Response `200`: `{ removed: true }`; `404
NOT_FOUND` when no row exists; `400 INVALID_INPUT` for an unknown stage.

### Implemented: extension essay drafting

#### `POST /api/extension/essay-draft`

Bearer token; extension CORS. Drafts one non-sensitive free-text answer from
confirmed profile facts and an owned resume. It is review-only: the response
contains `reviewRequired: true` and `autoFill: false`, and nothing writes the
draft to a preparation or a form. Sensitive categories are rejected.

```json
{
  "question": "Why do you want to work here?",
  "preparationId": "cuid",
  "jobApplicationId": "cuid",
  "resumeId": "cuid",
  "maxWords": 180,
  "instructions": "Mention the platform work.",
  "fieldType": "textarea",
  "tagName": "textarea"
}
```

`question` is required (5–4000 chars). The optional ids must belong to the token
owner; a preparation supplies job/company/resume context when present. Response
`200`: `{ draft, wordCount, grounding, unsupportedNumbers, reviewRequired: true,
autoFill: false }`. `grounding` reports employer terms mentioned without
candidate evidence, and `unsupportedNumbers` lists numbers absent from the
profile/resume evidence. Errors: `401`, `400 VALIDATION` / `NOT_AN_ESSAY` /
`AI_KEY_REQUIRED`, `404 NOT_FOUND` / `RESUME_NOT_FOUND`, `429 RATE_LIMITED`
(essay-draft bucket, 10 per 10 minutes) / `AI_DAILY_LIMIT`, `500
ESSAY_DRAFT_FAILED`.

### Implemented: profile rating

#### `POST /api/linkedin/rating`

Browser cookie only. Same-origin. `multipart/form-data` with a required `file`
field containing the user's own LinkedIn "Save profile as PDF" export (PDF only,
5 MB max) and an optional `resumeId` for owned resume context. The route extracts
text, runs the rating, and persists it; it never signs in to LinkedIn, scores a
URL or sends anything. The upload guard is the per-user `LINKEDIN` rating window;
the AI call also uses the shared LinkedIn bucket (10 per 10 minutes).

Response `201`: `{ data, contextUsed: { resume: boolean } }`. Errors: `401`,
`403`, `400 INVALID_BODY` / `NO_FILE` / `INVALID_TYPE` / `TOO_LARGE` /
`PARSE_FAILED` / `EMPTY_PDF` / `AI_KEY_REQUIRED`, `404 INVALID_RESUME`,
`429 RATE_LIMITED` / `AI_DAILY_LIMIT`, `500 RATING_FAILED`.

### Implemented: `/api/ranking`

Rank the owner's saved jobs with Okapi BM25 (`k1 = 1.2`, `b = 0.75`) plus seven
deterministic fit factors. `POST` is same-origin only; bearer-token calls are
accepted when no `Origin` is present. `GET` returns the latest persisted
snapshot for the leaderboard. Rate limit on both: `ranking:run`, 30 per 10
minutes.

#### `GET /api/ranking`

Browser cookie or bearer token. Response `200`: `{ snapshot: RankingSnapshot |
null }`; `null` means no ranking has been run yet. `RankingSnapshot`:
`{ id, kind, topK, minScore, poolSize, entryCount, reranked, result, createdAt }`
where `result` is the exact last `POST` response payload. Errors: `401`,
`429 RATE_LIMITED`.

#### `POST /api/ranking`

Request (strict object; unknown keys are rejected):

```json
{
  "jobIds": ["cuid"],
  "topK": 20,
  "minScore": 40,
  "lexicalWeight": 0.4,
  "rerank": false
}
```

All fields are optional. `jobIds` is capped at 100 and defaults to every saved
job. `topK` is 1–100; omit it for the whole pool. `minScore` is a 0–100
composite cutoff. `lexicalWeight` is 0–1 (default 0.4); the remainder is the
factor weight. `rerank: true` opts into the optional, grounded LLM pass over the
first 20 entries; it never blocks the response.

Response `200`:

```json
{
  "snapshot": {
    "rankedAt": "2026-11-11T15:00:00.000Z",
    "corpusSize": 42,
    "unscoredCount": 3,
    "averageDocumentLength": 148.2,
    "queryTerms": ["backend", "postgresql", "typescript"],
    "topK": 20,
    "minScore": 40,
    "lexicalWeight": 0.4,
    "fitWeight": 0.6
  },
  "entries": [
    {
      "postingId": "cuid",
      "rank": 1,
      "score": 82,
      "lexicalScore": 4.71,
      "lexicalRank": 2,
      "fitScore": 71,
      "coverage": 0.85,
      "factors": [
        { "id": "SKILLS", "label": "Skills", "state": "MATCH", "weight": 25, "reason": "The posting names 4 of your 6 confirmed skills.", "evidence": ["TypeScript"] },
        { "id": "AUTHORIZATION", "label": "Work authorization", "state": "UNKNOWN", "weight": 15, "reason": "The posting does not say whether it sponsors visas.", "evidence": [] }
      ],
      "explanation": ["Lexical relevance 100% (BM25 4.71) against your roles, confirmed skills and evidence."]
    }
  ],
  "excluded": [{ "postingId": "cuid", "reason": "below-threshold" }],
  "reranked": false,
  "warnings": [],
  "poolSize": 42,
  "snapshotId": "cuid | null"
}
```

`snapshotId` is present only when the best-effort `RankingSnapshot` write
succeeded; a storage failure is logged and must not fail the ranking. The
snapshot stores the exact response for later comparison, not a recomputation.

Rules:
- The seven factor ids are `SKILLS`, `EXPERIENCE`, `LOCATION`, `WORK_MODE`,
  `SALARY`, `AUTHORIZATION`, `FRESHNESS`; states are `MATCH`, `PARTIAL`,
  `MISMATCH`, `UNKNOWN`. Unknown factors earn no points and are listed in the
  explanation. `coverage` is the share of factor weight backed by known data.
- A posting with no description has `lexicalScore: null`, not `0`.
- `topK` and `minScore` only shape `entries`. Every excluded posting appears in
  `excluded` with a reason; no saved job is deleted or hidden from the tracker.
- Ranking never changes a qualification verdict. `rerank` can reorder the
  shortlist only, never add, drop or regrade a posting; a provider failure
  returns the deterministic order with `reranked: false` and a warning.
- Errors: `401 UNAUTHORIZED`, `403 FORBIDDEN`, `429 RATE_LIMITED`,
  `400 INVALID_INPUT` / `INVALID_BODY`, `500 RANKING_FAILED`.

### Three-layer research payload

The `runCompanyResearch` server action (`src/features/jobs/actions/company-research.actions.ts`)
returns `{ success, research, layers }` and stores both under
`JobApplication.matchResult`:

```json
{
  "companyResearch": { "companyName": "Acme", "confidence": "HIGH", "citations": [] },
  "researchLayers": {
    "requirements": { "required": ["3+ years TypeScript"], "preferred": [], "flags": ["NO_SPONSORSHIP"], "uncertainty": [] },
    "company": { "companyName": "Acme", "confidence": "HIGH", "citations": [] },
    "culture": {
      "signals": [{ "label": "Remote policy", "value": "fully remote", "state": "STATED_IN_POSTING", "citations": [] }],
      "confidence": "MEDIUM",
      "explanation": "One independent source backed the company facts; unstated culture signals are UNKNOWN.",
      "conflicts": []
    },
    "sourceSummary": { "totalSources": 3, "independentSources": 1, "hosts": ["acme.example"] },
    "researchedAt": "2026-11-11T15:00:00.000Z",
    "cached": false
  }
}
```

Culture signals are `VERIFIED` only when an independent fetched source quotes
the claim, `STATED_IN_POSTING` when only the posting says it, and `UNKNOWN` when
nothing does. A conflict (for example "fully remote" and "hybrid" in the same
posting) leaves the signal UNKNOWN rather than picking a side.

## Idempotency

- `POST /api/intake` accepts an optional `idempotencyKey` body field, unique per
  owner for the life of the row (not a 24-hour TTL). The same key returns the
  existing run id.
- `POST /api/workflows`, `POST /api/submission-attempts` and
  `POST /api/extension/jobs` are replay-safe: the same key or identity returns
  the same resource and status, not a duplicate. Outreach sequences also accept
  `idempotencyKey`; a replay returns the existing plan.
- Upload, chat-preview, cancel, retry and patch actions are naturally keyed by
  their resource id; they do not accept a separate HTTP idempotency key. Repeating
  an already-applied patch is a no-op that returns the applied target.
- An ATS preparation is idempotent on `(userId, sha256(vendor + canonicalUrl))`;
  re-scanning the same form returns the same row and does not duplicate review
  tasks. An approved ATS answer is idempotent on `(userId, scope, preparationId,
  questionKey)`; a different value requires an explicit `replace: true`.
- A workflow step's internal key is `(runId, stepName, inputHash)`, independent of
  the HTTP key.
- A retry after a network error is expected and must not create a second
  submission stage or a second review task.

## Contract tests

Each new route ships with handler tests that cover: unauthenticated `401`,
foreign-owner `404`, validation `400`, illegal transition `409`, success, and
idempotent replay. The ATS route tests additionally cover owner scoping, a
revoked answer omitted from reuse, and a prepared plan that never carries an
answer value.
