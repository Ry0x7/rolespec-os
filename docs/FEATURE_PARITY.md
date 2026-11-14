# Feature Parity: Recruitt → RoleSpec OS

Updated: 2026-11-14. Compares the workflow demonstrated by Recruitt
(<https://devpost.com/software/recruit-h3lc2r>) with what RoleSpec OS actually
does today. Scope is functional parity of the job-search workflow, not
proprietary code, copy or visual assets. The release audit behind the current
statuses is [VERIFICATION.md](VERIFICATION.md); that file distinguishes runtime
verification from code-and-test evidence.

## Status legend

| Status | Meaning |
| --- | --- |
| **Implemented** | The behavior exists end-to-end in shipped code and is covered by tests. A file or screen existing is not enough. |
| **Partial** | Part of the behavior exists; the missing part is named in the gap column. |
| **Missing** | No implementation of the behavior in the product. |
| **Not ported** | Deliberately excluded. The reason is recorded; it is not a backlog item. |
| **Roadmap-only** | Appears only in Recruitt's "What's next" list, so it is not a parity requirement. |

Evidence is a repository path, not a screenshot claim. `#L` anchors are avoided
because they drift; the named module and its tests are the durable evidence.

The intake rows (F01–F09) were re-read against the unified intake implementation
and its tests on 2026-11-11. A row is only `Implemented` when the whole path
exists: adapter, canonical validation, persistence, explicit review and the
supporting test. Deliberate limits remain in the gap column rather than being
hidden by the status change.

## Feature matrix

### Intake and the candidate profile

| ID | Recruitt feature | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| F01 | Six intake adapters run in parallel and stream progress events into one profile | Implemented | `src/features/intake/services/intake-run.service.ts`, `src/features/intake/adapters/registry.ts`, `src/app/api/intake/[id]/stream/route.ts`, `src/app/api/intake/__tests__/route.test.ts` | Six adapters share one run and one patch schema; sources execute in parallel and the SSE route emits persisted progress. Intake remains request-scoped and is intentionally not a `WorkflowRun`: a process death still leaves `RUNNING`, and Cancel → Retry is its recovery path. The leased workflow worker is used for the assisted application pipeline, not for intake. |
| F02 | Resume PDF parsing with candidate facts | Implemented | `src/features/intake/services/intake-upload.service.ts`, `src/features/intake/adapters/resume.adapter.ts`, `src/features/resume/services/import-resume-text.ts`, `src/features/resume/services/__tests__/import-resume-text.test.ts` | Deterministic PDF/DOCX extraction maps normalized experience, education, projects, certifications, skills and contact facts to candidate patches. Image-only scans still require OCR; the route says so rather than inventing text. |
| F03 | LinkedIn profile intake | Implemented | `src/features/intake/adapters/linkedin.adapter.ts`, `src/features/career-profile/services/import-linkedin.service.ts` | Export-only: the user supplies their own PDF/text export, and the adapter never signs in, fetches a profile URL or bypasses a login wall. Optional AI structuring has a deterministic fallback. |
| F04 | GitHub intake with repository summaries | Implemented | `src/features/intake/adapters/github.adapter.ts`, `src/features/career-profile/services/web-presence.service.ts`, `src/features/career-profile/services/__tests__/web-presence.service.test.ts` | Public profile, owned non-fork repositories, descriptions, primary language, topics, stars and last-push time produce project evidence and skill patches. No commit history, README or private repository access; consent is required per run. |
| F05 | Personal site / web intake | Implemented | `src/features/intake/adapters/web.adapter.ts`, `src/features/career-profile/services/web-presence.service.ts`, `src/features/career-profile/services/__tests__/web-presence.lookup.test.ts` | One public page is fetched through the existing DNS-pinned, redirect-revalidating SSRF guard. Projects, description and a closed technology vocabulary become candidates. No multi-page crawl. |
| F06 | Chat intake adapter | Implemented | `src/features/intake/adapters/chat.adapter.ts`, `src/features/intake/services/chat-extraction.service.ts`, `src/app/api/intake/chat/route.ts`, `src/features/intake/services/__tests__/chat-extraction.service.test.ts` | Deterministic first-person extraction always runs; optional AI structuring is grounded to user turns and falls back on provider failure. The extractor is deliberately narrow, and `/api/intake/chat` is a non-persisted preview. |
| F07 | Voice intake adapter (ElevenLabs) | Implemented | `src/features/intake/adapters/voice.adapter.ts`, `src/features/intake/services/chat-extraction.service.ts` | Voice facts arrive as a browser speech transcript or pasted text; audio is never uploaded or sent to a server-side speech provider. This is functional parity through a client interface, not an ElevenLabs integration. Text fallback is always available. |
| F08 | Per-fact provenance with source and status | Implemented | `prisma/schema.prisma`, `src/features/intake/services/intake-apply.service.ts`, `src/features/intake/services/__tests__/intake-apply.service.test.ts` | Every patch carries source, adapter locator/URL/file, confidence and status; applied evidence stores the envelope in `metadata`. Contact, skill and target-role provenance lives on the linked `IntakePatch`, not on a new per-field column. Applied evidence remains `CANDIDATE`. |
| F09 | Merge all sources into one profile with conflict handling | Implemented | `src/features/intake/lib/patch-fingerprint.ts`, `src/features/intake/services/intake-apply.service.ts`, `src/features/intake/__tests__/patch-fingerprint.test.ts` | Normalized fingerprints identify a claim across sources; an exact-claim key adds dates, details and outcome for evidence, so only byte-equivalent claims are deduped. A collision with different details or dates stays in the queue and becomes a persisted conflict with explicit `KEEP_EXISTING` / `ACCEPT_INCOMING` / `KEEP_BOTH` review. Near-duplicates with different titles or organizations are not fuzzy-merged; they stay separate review rows. |

### Discovery, ranking and fit

| ID | Recruitt feature | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| F10 | ATS and board ingestion (Ashby plus public boards) | Implemented | `src/features/discovery/services/adapters/index.ts`, `src/features/discovery/services/adapters/ashby.adapter.ts` | Eleven adapters ship, including Ashby, Greenhouse, Lever, Workday, BambooHR and regional boards. Ingestion is read-only and rate-bounded. |
| F11 | Normalize, canonicalize and dedupe postings | Implemented | `src/features/discovery/services/normalize.service.ts`, `prisma/schema.prisma` | A per-user unique canonical URL plus source-id fallback prevents duplicates. |
| F12 | Score each role against the candidate profile | Implemented | `src/features/discovery/services/qualify.service.ts`, `src/features/jobs/services/intelligent-matching.service.ts` | Deterministic qualification runs on every candidate; the AI match is a separate, optional deeper pass. Kept deliberately honest about unknowns. |
| F13 | BM25 keyword ranking with corpus statistics | Implemented | `src/features/ranking/bm25.ts`, `src/features/ranking/services/ranking.service.ts`, `src/features/discovery/actions/discovery.actions.ts` | Real Okapi BM25 (`k1 = 1.2`, `b = 0.75`) over normalized descriptions with IDF, term-frequency saturation and length normalization. Discovery ranks the pool with it; a posting without a description gets `null`, not zero. Deliberate limit: corpus statistics are per run, not a stored index; `/api/ranking` persists the returned result as a `RankingSnapshot`, but discovery itself does not create a snapshot. |
| F14 | LLM confidence score in the discovery ranking | Implemented | `src/features/discovery/actions/discovery.actions.ts`, `src/features/ranking/services/rerank.service.ts`, `src/app/api/ranking/route.ts`, `src/features/discovery/actions/__tests__/discovery.actions.test.ts` | Discovery accepts an opt-in `aiRerank` flag and reranks the deterministic shortlist through structured output with grounded quotes and a deterministic fallback; saved jobs use the same guarded rerank. The pass is optional and budgeted, so an AI-free run or an unconfigured provider keeps the deterministic order and returns a warning rather than failing discovery. |
| F15 | Leaderboard of best-fit roles, top 40 with a cutoff | Implemented | `src/features/ranking/services/ranking-snapshot.service.ts`, `src/app/api/ranking/route.ts`, `src/features/ranking/components/opportunity-leaderboard.tsx`, `src/app/(app)/dashboard/page.tsx`, `prisma/schema.prisma` (`RankingSnapshot`) | A 0-100 composite of BM25 and seven factors, configurable `topK` (1-100) and `minScore`, with every excluded row reported by id and reason. Each ranking response is persisted as a `RankingSnapshot` and the dashboard renders the saved leaderboard with score, evidence coverage and a colour-coded "Why this rank?" explanation. The shortlist is user-configurable rather than fixed at 40. |
| F16 | Board search links and saved searches | Implemented | `src/features/discovery/services/board-search-links.service.ts`, `src/features/discovery/services/derive-queries.service.ts` | Query derivation and per-board links exist. Search links are generated from the profile, not stored as named searches. |
| F17 | Fit badges next to job titles on supported boards | Implemented | `extension/src/badge-core.ts`, `extension/src/badge-registration.ts` | Per-site opt-in, closed shadow DOM, cached verdicts, no form listeners. |

### Research

| ID | Recruitt feature | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| F18 | Extract what the job actually requires | Implemented | `src/features/jobs/services/job-requirements.service.ts`, `src/features/jobs/services/interview-questions.service.ts` | Deterministic eligibility flags plus employer-question extraction. Posting text is never treated as evidence about the candidate. |
| F19 | Research what the company does | Implemented | `src/features/jobs/services/company-research.service.ts`, `src/features/jobs/actions/company-research.actions.ts` | Fetches public sources and only keeps verified citations; ungrounded facts are withheld rather than asserted. |
| F20 | Culture layer as a distinct research output | Implemented | `src/features/jobs/services/three-layer-research.service.ts`, `src/features/jobs/actions/company-research.actions.ts` | A labelled culture layer with seven signals (remote policy, async, flexible hours, four-day week, work-life balance, learning budget, transparent pay). Each is `VERIFIED` only from an independent quoted source, `STATED_IN_POSTING` when only the posting says it, `UNKNOWN` otherwise; contradictory claims become an explicit conflict. Gap: no dedicated UI block yet. |
| F21 | Research citations for every stored fact | Implemented | `src/features/jobs/services/company-research.service.ts`, `src/features/jobs/services/three-layer-research.service.ts`, `src/features/jobs/actions/company-research.actions.ts` | Citations record verification and confidence; the three-layer payload stores `companyResearch` plus `researchLayers` in `matchResult`. Independent hosts are counted separately from the posting host, and a fact with no verified source is withheld or downgraded. |
| F22 | Provider-agnostic routing per stage | Implemented | `src/shared/lib/ai-stages.ts`, `src/shared/lib/ai-provider.ts`, `src/shared/lib/ai-generate.ts`, `src/app/api/settings/ai-stages/route.ts`, `prisma/schema.prisma` (`UserAiStageSetting`) | A user can pin provider, model and an encrypted key per workflow stage; the resolver falls back to the user's default, then the deployment default, when a stage has no override. `PUT`/`DELETE /api/settings/ai-stages` manage the overrides and tracked calls forward the stage through reservation, usage and fallback. |

### Tailoring and anti-fabrication

| ID | Recruitt feature | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| F23 | Tailored resume per role | Implemented | `src/features/resume/actions/tailor.ts`, `src/features/resume/services/tailor-resume.ts`, `src/features/resume/tailoring/tailoring.service.ts` | Manual action and workflow service create a `JOB_TAILORED` DRAFT with source lineage. The workflow draft is reviewable but is never auto-selected for the application. |
| F24 | Deterministic anti-fabrication validator on every output | Implemented | `src/features/resume/tailoring/claim-validator.ts`, `src/features/resume/tailoring/evidence-map.ts`, `src/features/workflows/executors/validate.executor.ts` | Every rewrite is compared to the captured source: fabricated metrics/dates, unsupported scope, invented proper nouns, implied credentials, implied seniority, skill-set changes, added roles and added achievement bullets fail closed. `VALIDATE` re-runs the check against the STORED draft and appends a `ResumeValidation` row. |
| F25 | Banned cliché list enforced | Implemented | `src/shared/lib/prompts/human-voice.ts`, `src/features/resume/tailoring/claim-validator.ts`, `src/features/resume/tailoring/__tests__/claim-validator.test.ts` | The prompt forbids the list and the claim validator now rejects a generated cliché deterministically, with the ATS carve-out for terms the posting itself uses. A rejected generation is repaired or fails closed; it is never persisted as a clean draft. |
| F26 | Keyword coverage score for tailored output | Implemented | `src/features/resume/tailoring/evidence-map.ts`, `src/features/resume/tailoring/types.ts` | Requirement-to-evidence mapping persists per-requirement `SUPPORTED`/`PARTIAL`/`UNSUPPORTED` verdicts and up to three source refs; the validation report stores the coverage totals on the tailoring run and workflow output. |
| F27 | Single-page tailored PDF | Implemented | `src/features/export/services/single-page.ts`, `src/features/export/actions/export-pdf.ts` | Optional `singlePage` export re-renders the SAME template with compact density/margins, 0.9 scale and snug leading, counts real PDF pages with pdf-parse, and returns a warning instead of truncating content when one page is impossible. |
| F28 | Bounded retry, then hard-fail rather than submit | Implemented | `src/features/resume/tailoring/tailoring.service.ts`, `src/features/resume/services/tailor-resume.ts` | Initial generation plus at most two repair passes (three total) carry exact validation failures back to the model. If all three still fail, no resume is created; the run is `NEEDS_REVIEW` and the workflow pauses with a manual fallback. |

### Application forms, review and submission

| ID | Recruitt feature | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| F29 | ATS field discovery and classification by answerability | Implemented | `src/features/ats/lib/field-classifier.ts`, `extension/src/autofill-page.ts`, `extension/src/ats-adapters.ts` | Scans visible enabled controls in all frames and classifies by meaning before HTML type: identity, contact, links, work, education, compensation, authorization, sponsorship, demographic, legal, essay, document and unknown. The server re-classifies every field and rejects a client-supplied category. |
| F30 | Safe factual fields auto-filled | Implemented | `src/features/ats/lib/field-classifier.ts`, `extension/src/autofill-panel.ts` | The server plan only marks stored identity/contact/link facts or explicitly approved answers `FILL`; the panel previews, checks the live field signature, then writes only after a second confirm. `select`, radio, checkbox, file, essay and typeahead controls are never written. |
| F31 | Sensitive questions routed to a review queue | Implemented | `src/features/ats/services/ats-preparation.service.ts`, `extension/src/autofill-panel.ts` | Work authorization, sponsorship, pay, demographics, legal history, essays, uploads and unknown fields always become persistent `ReviewTask` rows with the exact question, reason and manual fallback. A conflicting replacement creates one `CONFLICTING_ANSWER` task instead of silently overwriting the saved answer. A blocked field never fails the preparation. |
| F32 | Approved answers cached and reused across forms | Implemented | `src/features/ats/services/ats-preparation.service.ts`, `src/shared/lib/answer-crypto.ts`, `scripts/encrypt-ats-answers.ts`, `prisma/schema.prisma` (`AtsAnswer`) | Owner-scoped `AtsAnswer` rows with `APPLICATION`/`GLOBAL` scope, explicit replace, non-destructive revoke and reuse by derived question key. Values are stored as AES-GCM envelopes; legacy plaintext rows remain readable and are re-encrypted on edit, and the backfill script converts the rest. The extension cache is only a convenience copy. |
| F33 | Optional AI essay drafts with mandatory review | Implemented | `src/app/api/extension/essay-draft/route.ts`, `src/features/jobs/services/essay-draft.service.ts`, `src/app/api/extension/essay-draft/__tests__/route.test.ts` | Essays are detected and queued as `ESSAY_ANSWER` tasks; the bearer endpoint drafts from confirmed profile/resume facts only, grounds every employer term, reports unsupported numbers, and returns `reviewRequired: true` / `autoFill: false`. The draft is shown verbatim for editing and never written to a form. Gap: no first-party UI for the draft yet. |
| F34 | Tailored resume uploaded into the form | Partial | `src/app/api/extension/resumes/[id]/pdf/route.ts`, `extension/src/autofill-panel.ts`, `extension/src/autofill-page.ts` | The user chooses a resume and presses Attach; the server renders the owned PDF and the panel stages a `File` into the page's input on that gesture. If the page refuses it, the same PDF downloads for manual selection, and the chosen id/title is persisted. Gap: attachment on a live employer page was not verified, and some vendors require manual file selection. |
| F35 | Submission staged with captured evidence | Implemented | `prisma/schema.prisma` (`SubmissionAttempt`), `src/features/submissions/services/submission.service.ts`, `src/app/api/submission-attempts/route.ts`, `src/app/api/submission-attempts/[id]/route.ts`, `src/features/workflows/executors/staging.executor.ts` | One durable `SubmissionAttempt` is created by both the workflow `SUBMISSION_STAGING` step and a confirmed ATS preparation, with application, resume, source URL, compact evidence and timestamps; no page HTML or answer values. `PATCH /api/submission-attempts/:id` with an explicit `submitted` boolean is the only path to `SUBMITTED`; it moves `INTERESTED` to `APPLIED`, writes a status event and schedules follow-ups atomically. A confirmed submission is terminal. |
| F36 | Submit is always gated, dry-run by default | Implemented | `extension/README.md`, `extension/src/autofill-panel.ts`, `extension/src/autofill-page.ts` | The extension never clicks submit or accepts terms. Tests assert the fill path dispatches no submit or click on the submit control. The final action is the user's. |
| F37 | Review queue as a product surface | Implemented | `src/app/(app)/review/page.tsx`, `src/features/review/components/review-workspace.tsx`, `src/features/workflows/services/workflow.service.ts`, `extension/src/autofill-panel.ts`, `src/app/api/extension/review-tasks/route.ts`, `src/app/api/review-tasks/route.ts` | The extension side panel shows one persistent queue across scans, with per-answer approve/edit/revoke, provenance, scope and dismiss. The first-party `/review` screen adds Questions, Profile proposals and an Answer-memory handoff; tasks remain durable server rows. Answer-memory editing is still extension-only rather than a writable web table. |
| F38 | A specific review task instead of aborting the workflow | Implemented | `src/features/workflows/services/workflow-worker.ts`, `src/features/workflows/executors/human-review.executor.ts`, `src/features/ats/services/ats-preparation.service.ts` | A workflow step that needs a human returns `WAITING_FOR_USER` with a persisted task and fallback; an ATS field becomes a task without failing the preparation. Neither path resumes into submission. |
| F39 | Approve once, then reuse the answer | Implemented | `src/features/ats/services/ats-preparation.service.ts`, `src/app/api/extension/ats/answers/route.ts`, `extension/src/autofill-panel.ts` | Server-side approval records scope, source, `approvedAt`, `useCount` and `revokedAt`; a conflicting live answer returns `409` unless replacement is explicit; revocation reopens the question. Application-scoped answers win over global ones. |
| F40 | Audit trail of application progress | Implemented | `prisma/schema.prisma`, `src/features/jobs/actions/job-application.actions.ts`, `src/features/workflows/services/workflow.service.ts` | `ApplicationStatusEvent` is append-only and records source; `WorkflowEvent` adds the append-only agent/step trace with redacted messages. Neither is a replay UI (F56). |

### Follow-ups and outreach

| ID | Recruitt feature | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| F41 | Email follow-up scheduled at +5 business days | Implemented | `src/features/jobs/services/follow-up-task.service.ts`, `src/app/api/follow-ups/route.ts`, `src/shared/lib/dates.ts` | A durable `FollowUpTask` is created for `EMAIL` at +5 weekday business days when an application reaches `APPLIED`, with the due day, reason, source and completion state persisted. The API lists due/all tasks and lets the user complete or dismiss one; sending remains manual. |
| F42 | LinkedIn follow-up at +12 business days | Implemented | `src/features/jobs/services/follow-up-task.service.ts`, `src/features/jobs/services/follow-up-email.service.ts` | The same scheduling service creates a `LINKEDIN` task at +12 weekday business days, with its own reason and completion state. The existing LinkedIn drafting remains separate; nothing is sent automatically. |
| F43 | Manual follow-up trigger | Implemented | `src/features/jobs/actions/follow-up-email.actions.ts`, `src/features/jobs/components/job-email-panel.tsx` | The user generates and copies a draft; sending remains manual. |
| F44 | Automatic scheduling when an application is sent | Implemented | `src/features/jobs/services/follow-up-task.service.ts`, `src/features/submissions/services/submission.service.ts`, `src/features/jobs/actions/job-application.actions.ts` | The `APPLIED` transition, whether from the tracker, a confirmed submission or the workflow, creates both durable reminders inside the same transaction. A user-set `followUpAt` is never overwritten; the legacy tracker field is aligned with the email task only when empty. |
| F45 | Recruiter outreach and follow-up as first-class workflows | Implemented | `src/features/jobs/services/outreach-sequence.service.ts`, `src/app/api/outreach/sequences/route.ts`, `src/app/api/outreach/sequences/[id]/route.ts`, `src/app/api/outreach/touches/[id]/route.ts` | A named sequence persists a contact and scheduled EMAIL/LINKEDIN touches at 0/+5/+12 business days, with idempotent creation, activate/cancel lifecycle and per-touch `DONE`/`SKIPPED` reporting. Drafting remains separate and no message is sent; `sent: false` is explicit in the DTO. |

### Product surface

| ID | Recruitt feature | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| F46 | Dashboard leaderboard sorted by tailoring score | Implemented | `src/features/ranking/components/opportunity-leaderboard.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/features/ranking/services/ranking-snapshot.service.ts`, `src/app/api/ranking/route.ts` | Dashboard renders the persisted top-K with score, evidence coverage, status and a progressive "Why this rank?" disclosure. The API still reports a cutoff and every excluded row; the job list can additionally sort by stored match score and confidence. |
| F47 | Command palette | Implemented | `src/shared/components/command-palette.tsx`, `src/config/navigation.ts` | Keyboard-driven navigation and quick actions, with recents and shortcut help. |
| F48 | Guided multi-step onboarding | Implemented | `src/features/onboarding/components/onboarding-wizard.tsx`, `src/features/onboarding/actions/ai-setup.actions.ts` | Four steps (welcome, AI setup with inline test, profile, ready) versus Recruitt's five. The workflow outcome is equivalent; provider setup is optional. |
| F49 | 3D agent room | Not ported | Audited: no Three.js or React Three Fiber dependency in `package.json` | Presentation, not workflow. It would add a large renderer and asset surface with no functional benefit. |
| F50 | Hosted multi-tenant accounts and pricing tiers | Not ported | `README.md`, `docs/ARCHITECTURE.md` | RoleSpec is explicitly a single-owner workspace with loopback-or-unlock access. Hosted accounts are a business decision outside this plan. |

### Safety and honesty invariants

| ID | Recruitt feature | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| F51 | Never fabricate candidate qualifications | Implemented | `src/shared/lib/evidence-grounding.ts`, `src/features/resume/tailoring/claim-validator.ts`, `src/features/resume/actions/tailor.ts`, `src/features/intake/services/chat-extraction.service.ts` | Grounding is enforced in prompts and re-checked deterministically; unsupported suggestions are discarded and a whole-document failure blocks persistence. Intake extractors use only explicit user/document statements and write candidates, never confirmed facts. |
| F52 | Never silently submit an application | Implemented | `extension/README.md`, `extension/src/autofill-panel.ts`, `src/features/jobs/components/job-email-panel.tsx` | No submit path exists. The UI states that sending and submitting are user actions. |
| F53 | Missing information produces a review task, not a workflow abort | Implemented | `src/features/workflows/executors/profile.executor.ts`, `src/features/workflows/executors/tailor.executor.ts`, `src/features/workflows/services/workflow-worker.ts` | A missing target role, missing resume or unanswerable field returns `WAITING_FOR_USER` with a specific question and fallback; the run is `AWAITING_REVIEW`, not `FAILED`. Restricted access is a `RESTRICTED_ACCESS` task. |
| F54 | Restricted access produces a supported manual fallback | Implemented | `extension/src/site-access.ts`, `src/features/discovery/actions/discovery.actions.ts` | A per-origin grant is offered, manual entry is always available, and discovery does not bypass login walls or CAPTCHAs. |

## Recruitt roadmap (not parity requirements)

These appear only in Recruitt's own "What's next". They are recorded so the plan
does not quietly turn them into commitments. RoleSpec may adopt some later for
its own reasons.

| ID | Recruitt roadmap item | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| F55 | Validated Greenhouse/Lever fill paths | Partial | Recruitt Devpost "What's next"; `extension/src/ats-adapters.ts`, `extension/src/ats-fixtures.test.ts` | Greenhouse, Lever and Ashby have maintained vendor-shaped fixtures covering labelled fields, radio groups, typeaheads, pay and uploads. On 2026-11-12 a real public Lever application page was fetched and scanned by the extension code: 24 fields were discovered and the plan contained 6 safe fills and 18 review fields, 13 of them sensitive. Actual fill and resume upload on a live employer page were not performed, so filling remains fixture-tested rather than live-validated. |
| F56 | Replayable application traces | Roadmap-only | Recruitt Devpost "What's next"; RoleSpec substrate is `src/features/workflows/services/workflow.service.ts` | `WorkflowEvent` now provides a durable, ordered step trace with timestamps and redacted metadata; `GET /api/workflows/:id/events` reads it. A replay UI is not scheduled. |
| F57 | Confidence-gated auto-submit | Roadmap-only | Recruitt Devpost "What's next"; RoleSpec rule is `extension/README.md` | Explicitly excluded by RoleSpec's no-silent-submit invariant. Do not implement. |
| F58 | Recruiter outreach scheduling as its own workflow | Implemented | Recruitt Devpost "What's next"; `src/features/jobs/services/outreach-sequence.service.ts`, `src/app/api/outreach/sequences/route.ts` | A persisted contact/sequence/touch schedule now exists, with manual completion and no outbound transport. Gap: no first-party UI and no automatic send by design. |
| F59 | Hosted launch with paid tiers | Roadmap-only | Recruitt Devpost "What's next" | Out of scope for a single-owner workspace. No billing or tenancy in this plan. |
| F60 | One-click end-to-end auto-submission with no per-step confirmation | Missing | `extension/README.md`, `docs/ARCHITECTURE.md`, `src/features/workflows/executors/human-review.executor.ts` | Recruitt's assisted flow still ends in human review. RoleSpec intentionally has no silent-submit path: staging records evidence and stops, and every submission remains a user action. This gap will not be closed. |

## Evidence and audit method

- Every path in the matrix was opened and read, not inferred from its filename.
  Where behavior is absent, the row says what was searched.
- "Implemented" requires a shipped code path plus a test that exercises it. Where
  only a component or prompt exists without the surrounding flow, the row is
  **Partial**.
- The audit deliberately separates three things Recruitt also separates:
  **profile fit** (does the role fit the candidate), **opportunity confidence**
  (is the posting worth time), and **research grounding** (is a company fact
  supported by a fetched source).
- Scores are never treated as facts. A missing input lowers confidence or returns
  "unknown"; it does not become a neutral 50.

## Audit limits

- Recruitt's live product was not available for interaction, so its behavior is
  taken from its written submission. Internals such as exact prompts, scoring
  weights and queue implementation are not public and are not copied.
- RoleSpec behavior is judged from source and unit tests. A full end-to-end
  browser walkthrough of the current app was not part of this audit; the roadmap
  already lists that as outstanding verification.
- The extension's field classifier was exercised against a real public Lever
  application page on 2026-11-12 (24 fields; 6 safe fills, 18 review rows, 13
  sensitive), but no value was written and no resume was uploaded on that live
  page. Its persistent review queue, resume fallback and "never submit" rule are
  covered by maintained vendor fixtures and unit tests; see
  [ATS_SUPPORT.md](ATS_SUPPORT.md) for the support matrix and its limits.
- Recruitt's pricing and hosted-account claims are product claims, not technical
  capabilities, and are not evaluated.
