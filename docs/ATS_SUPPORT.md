# ATS support and application preparation

RoleSpec OS prepares an application; it never submits one. The browser extension
detects a form, the server re-classifies every field, the user approves the plan,
blocked questions become persistent review tasks, and the final Submit click is
always the user's own.

This page separates three facts that are often conflated:

1. **Ingestion** — whether a posting on that host can be clipped into RoleSpec OS.
2. **Form discovery** — whether the scanner can read the form's controls and labels.
3. **Verified form filling** — whether that vendor's shape is covered by maintained
   fixtures and a tested fill plan.

A vendor can support (1) without supporting (3). The extension says which mode it
is in before scanning.

## Vendor matrix

| Vendor | Ingestion | Form filling | What that means |
| --- | --- | --- | --- |
| Greenhouse | Yes | Fixture-tested | Labelled fields fill; authorization, essays and uploads go to review. |
| Lever | Yes | Fixture-tested | Radio groups, typeaheads and pay questions are recognised and never guessed. |
| Ashby | Yes | Fixture-tested | React controls are scanned; choice controls and essays always stay manual. |
| Workable | Yes | Assisted | Scanner runs; verify every value, some widgets need manual selection. |
| BambooHR | Yes | Assisted | Embedded frames are scanned individually. |
| SmartRecruiters | Yes | Assisted | Custom widgets may need manual selection. |
| Jobvite | Yes | Assisted | Verify every value before submitting. |
| iCIMS | Yes | Assisted | Some steps open in separate frames; scan each step. |
| Taleo | Yes | Manual fallback | Custom controls are not safely automatable. Use the manual path. |
| Workday | Yes | Assisted | Multi-frame, multi-step flow. Scan each step; attach the resume manually if needed. |
| Recruitee | Yes | Assisted | Verify every value before submitting. |
| Teamtailor | Yes | Assisted | Verify every value before submitting. |
| Personio | Yes | Assisted | Verify every value before submitting. |
| Any other host | No | Manual fallback | Only scan an explicitly opened form, or fill it yourself. |

The extension-side matrix is `extension/src/ats-adapters.ts`. The server keeps a
fixed vendor allowlist (`src/features/ats/services/ats-preparation.service.ts`),
normalises an unknown vendor to `generic`, and never trusts the client's
classification.

`fixture-tested` means the discovery and safety rules are pinned by maintained
markup fixtures (`extension/src/ats-fixtures.test.ts`, `extension/src/autofill-core.test.ts`,
`extension/src/autofill-page.test.ts`). It does **not** mean a live application was
filled and submitted during this build. Live ATS access was not available, so no
claim of live vendor verification is made here.

## End-to-end preparation flow

1. **Scan.** The user opens the employer's form and presses **Scan this page**.
   The extension injects the scanner into all frames on that tab and reads only
   visible, enabled control labels, names, types and options. It never reads a
   value already in a field and never reads page text outside the form.
2. **Prepare.** The panel sends the field descriptors to
   `POST /api/extension/ats/preparations`. The server stores one `AtsPreparation`
   keyed by `sha256(vendor + canonicalUrl)`, so re-scanning the same form is
   idempotent rather than duplicating a draft.
3. **Plan.** The server re-derives every field's category, sensitivity and
   question key from the label, name, type and tag. Its decisions are `FILL`,
   `REVIEW` or `ATTACH_RESUME`. Only identity, contact and link facts the owner
   already stored, or answers the owner explicitly approved, can be `FILL`.
4. **Preview and fill.** The panel explains what it can fill, the user presses
   **Fill fields**, checks the preview, then presses **Confirm fill**. Before
   writing, the panel checks that the server plan still matches the live page's
   field set (`formSignature`); a form that changed is refused instead of being
   filled with a stale plan. Writes happen per frame and dispatch `input`/`change`
   events, which is what React-based forms listen for.
5. **Review.** Every blocked field is a separate `ReviewTask` row with the exact
   question, reason, category, fallback and a suggested-value envelope that
   contains no answer text. The panel shows the persistent queue; resolving a task
   records the answer and, where the plan allows it, makes that value reusable.
6. **Resume.** If the user attached a resume, the chosen PDF is fetched through
   `GET /api/extension/resumes/:id/pdf` only after the user presses Attach. The
   panel stages a `File` into the page's file input. If the page refuses it, or
   the file input is inside a frame the extension cannot write, the same PDF is
   downloaded and the panel tells the user to select it manually. No file is
   uploaded anywhere except the employer's own form, and only on that gesture.
7. **Stage.** The `AtsPreparation` record is the staged application: vendor,
   source and canonical URL, page/job/company labels, chosen resume, server plan,
   field-level results, review task ids, counts and timestamps. If the caller
   supplied a `jobApplicationId`, the record is linked to that application; the
   extension does not create a `JobApplication` on its own.
8. **Submit manually.** While a prepared fill is active, the extension arms a
temporary submit guard: a form submit, Enter inside a form, or a click on a
submit-looking control is blocked until the user presses **Release submit guard**
(or five minutes pass). The guard never submits anything itself. The user then
reviews the actual page and clicks the employer's Submit button. RoleSpec OS has
no code path that clicks it, accepts terms, or dispatches a submit event.
9. **Confirm.** The panel asks whether the application was actually submitted.
   Only an explicit yes moves the preparation to `SUBMITTED` and, when linked,
   moves the application to `APPLIED` with a `dateApplied` and an append-only
   `ApplicationStatusEvent` (`source: EXTENSION`). A no records `NOT_SUBMITTED`
   and changes no application status. Confirmation is one-way: a later no after
   a confirmed yes returns `409 TERMINAL`; correcting the tracker is a separate
   user action. The note is redacted and length-capped.

## Field classification and sensitivity

Classification is by meaning before HTML type. The server checks the most
dangerous meanings first, so "Work email" is a contact field while "Are you
authorized to work?" is an authorization question.

| Category | Examples | Decision |
| --- | --- | --- |
| `identity` | First name, family name, full name | `FILL` from the owner's contact name |
| `contact` | Email, phone, current location | `FILL` when stored |
| `link` | LinkedIn, GitHub, portfolio | `FILL` when stored |
| `work` | Current company, current title | Review unless it is the stored current role |
| `education` | School, degree | Review |
| `compensation` | Salary expectation, desired rate | Never filled; `SENSITIVE_ANSWER` |
| `authorization` | Right to work, visa, work permit | Never filled; `SENSITIVE_ANSWER` |
| `sponsorship` | Will you require sponsorship? | Never filled; `SENSITIVE_ANSWER` |
| `demographic` | Gender, race, veteran, disability, age | Never filled; `SENSITIVE_ANSWER` |
| `legal` | Criminal history, background check, SSN/tax id | Never filled; `SENSITIVE_ANSWER` |
| `essay` | Cover letter, "Why this role?", free textarea | Never filled; `ESSAY_ANSWER` |
| `document` | Resume/CV upload, cover-letter upload | `ATTACH_RESUME` only on a user press |
| `unknown` | Unrecognised label or widget | Never filled; `UNKNOWN_FIELD` |

Additional rules:

- `select`, `radio` and `checkbox` controls are never written, even when the
  user has an approved answer for that question. They stay manual so a
  half-guessed choice cannot silently change the application.
- A typeahead that discards free text (`requiresSelection`) is never written.
- File inputs are never automated by the scanner. The separate, explicit
  attach button is the only write path.
- A field whose meaning is unclear stays `unknown`; it is not optimistically
  treated as a safe contact field.
- The server decision is authoritative. A modified extension cannot turn a
  sensitive field into a `FILL` by lying about its category.

## Review queue and approved answers

Review questions are durable rows, not transient UI rows:

- Kinds: `SENSITIVE_ANSWER`, `ESSAY_ANSWER`, `RESUME_ATTACHMENT`,
  `UNKNOWN_FIELD`, `MISSING_PROFILE_FACT`, `CONFLICTING_ANSWER`,
  `UNSUPPORTED_FIELD` and the workflow-level kinds.
- One open task per preparation, question and category. Re-scanning an unchanged
  form updates the existing task rather than duplicating it.
- Each task names the question, why it is blocked, and a manual fallback. A
  blocked field never fails the whole preparation.
- Resolving a task records the answer, the resolver and the resolution time.
  Dismissing it leaves the answer unknown; the preparation remains reviewable.
- The extension can list the queue (`GET /api/extension/review-tasks`) and read
  tasks created for a preparation in the preparation payload itself.

Approved answer memory (`AtsAnswer`):

- Per-answer approval, with a question key derived from the exact question text.
- `APPLICATION` scope is reusable only for that preparation; `GLOBAL` scope is
  reusable on future forms. An application-specific answer deliberately takes
  precedence over a global answer for that form.
- Editing an answer is explicit. A different live answer for the same key is a
  `409 CONFLICT` unless the caller sends `replace: true`, so a stale panel cannot
  silently overwrite a decision made elsewhere. The conflict also creates one
  persistent `CONFLICTING_ANSWER` task for that preparation; resolving it with a
  replacement answer clears the task.
- Revoking an answer sets `revokedAt`; the row stays for provenance, is omitted
  from future plans, and its review task is reopened when the answer belonged to
  a preparation. Revoked answers are never reused.
- Answer values are owner-scoped, excluded from the preparation plan, never
  written to logs, and never included in a review task's suggested-value
  envelope. They are stored in the local PostgreSQL database; the current schema
  does not encrypt these rows at rest. The old browser-local cache
  (`chrome.storage.local`) remains a convenience copy only.

## Staged record and statuses

`AtsPreparation` is the persistent draft. It is not a `JobApplication`; it links
to one when the caller provides it.

| Status | Meaning |
| --- | --- |
| `DRAFT` | Created with no detected fields (for example, a scan found no usable controls) |
| `READY_FOR_REVIEW` | At least one open review task remains |
| `READY_TO_SUBMIT` | No open task and at least one field is detected; the user may fill and review |
| `SUBMITTED` | The user explicitly confirmed the employer accepted the application |
| `NOT_SUBMITTED` | The user explicitly said it was not submitted |
| `ABANDONED` | The user abandoned this preparation; a submitted one cannot be abandoned |

The record keeps:

- vendor, `sourceUrl`, `canonicalUrl`, page title, job title, company name;
- the server plan and the field-level result report;
- review task ids, detected/filled/blocked counts;
- approved, filled and submitted timestamps;
- the redacted submission note;
- the chosen resume id and title.

There is deliberately no stored page HTML, no raw file bytes and no answer value
in the plan or results. The plan records a `profileKey` or `answerId` as
provenance, not the value.

## Failure behavior

| Failure | Behavior |
| --- | --- |
| Server unreachable | The panel says RoleSpec OS is offline and offers the manual path: download the PDF from Resumes and attach it yourself. |
| Form changed after planning | The stale plan is refused; the panel asks for a rescan instead of writing a mismatched field. |
| Field disappeared | That field is reported `FAILED` or `SKIPPED`; the rest of the form still fills. |
| Sensitive or unknown question | A `ReviewTask`, not a failed preparation. |
| Resume endpoint fails | The panel shows the error and keeps the manual file-selection fallback. |
| Page refuses the staged file | The PDF downloads and the panel instructs the user to browse for it. |
| No supported ATS detected | Only an explicitly opened form can be scanned; otherwise the panel states it is a manual application. |
| Duplicate scan | The same vendor + canonical URL returns the existing preparation. |
| Conflicting answer edit | The request is `409` and one `CONFLICTING_ANSWER` task is kept open until the user replaces, edits or revokes an answer. |
| Rate limit | `429 RATE_LIMITED`; the panel asks the user to wait. |
| Revoked or archived resume | `404 RESUME_NOT_FOUND`; no stale resume is attached. |

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/extension/ats/preparations` | Create or refresh one preparation and return the server plan |
| `GET` | `/api/extension/ats/preparations` | List recent preparations, optionally by application |
| `GET` | `/api/extension/ats/preparations/:id` | Read one preparation, its plan, results and open tasks |
| `PATCH` | `/api/extension/ats/preparations/:id` | Record results, attach a resume, confirm submission or abandon |
| `GET` | `/api/extension/ats/answers` | List the owner's live approved answers |
| `POST` | `/api/extension/ats/answers` | Approve or edit an answer |
| `DELETE` | `/api/extension/ats/answers` | Revoke an answer by id |
| `GET` | `/api/extension/review-tasks` | Persistent review queue |
| `PATCH` | `/api/extension/review-tasks/:id` | Resolve, dismiss or attach a resume for a task |
| `GET` | `/api/extension/resumes/:id/pdf` | Render the chosen resume for user-triggered attachment |

Every route is bearer-token authenticated, owner-scoped and rate-limited. See
[API_CONTRACTS.md](API_CONTRACTS.md) for request and response bodies.

## Safety boundaries

- The extension never clicks Submit, never accepts terms and never dispatches a
  submit event. There is no option to do so.
- CAPTCHA, anti-bot checks, authentication walls and access restrictions are
  never bypassed. A page that requires them is a manual application.
- Work authorization, sponsorship, compensation, demographic and legal questions
  are never answered automatically. They require a user-written answer, and even
  that answer is never written into a choice control.
- A saved answer is reused only for the same question key, and only after the
  owner approved it.
- The server does not accept candidate claims from the page or the extension as
  profile facts; it reads only the stored career profile.
- The scanner does not read existing form values, cookies, storage or page
  scripts.
- No application status changes except through explicit submission confirmation.

## Verification status and limits

Covered by automated tests:

- maintained Greenhouse, Lever and Ashby fixtures, including dynamic field
  signatures and frame ids;
- sensitive-field classification and choice-control restrictions;
- per-field results, review-task creation and re-scan deduplication;
- owner scoping for preparations, answers, tasks and resume PDFs;
- approval, conflict, edit, revoke and reuse of answers;
- resume attachment and the manual download fallback;
- absence of submit calls in the fill path.

Not covered by this build:

- a live end-to-end submission on a real employer ATS (no accessible account);
- Workday's multi-step navigation beyond scanning each step;
- CAPTCHA-protected or authenticated vendor portals;
- OCR for scanned/image-only resumes.

Where a vendor is listed as `assisted` or `manual`, that is a deliberate support
boundary, not an unfinished implementation. The user can always complete the form
manually, and the staged preparation stays usable as a record of what was prepared.
