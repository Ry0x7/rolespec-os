# Research: Recruitt workflow reproduction

Updated: 2026-11-11. Scope: the technical and product references that decide how
Recruitt's workflow is reproduced in RoleSpec OS. This file records what was read,
what it establishes, and the decision taken. It does not restate code behavior;
[FEATURE_PARITY.md](FEATURE_PARITY.md) holds the audit and
[ARCHITECTURE.md](ARCHITECTURE.md) the target design.

## Method

1. Read the public Recruitt submission and separated **demonstrated** claims from
   its own **"What's next"** list. Both are recorded below so the plan never
   treats a roadmap item as a parity requirement.
2. Audited the RoleSpec tree by reading the implementation, not by trusting file
   or screen names. Every matrix row cites a path that exists at the time of
   writing; the gate ledger checks those citations.
3. Checked current official documentation for each technology the plan depends
   on. Where a source is versioned, the version read is recorded. Claims that
   could not be verified are labeled as unverified rather than repeated. The
   unified-intake implementation was then re-read against its source, routes and
   migration before this file was updated; no behavior is claimed from a plan.
4. Prefer extending an existing module. A new dependency needs a portability
   argument for the packaged Windows build, not only a feature argument.

## Recruitt: demonstrated vs roadmap

Source: Devpost submission, <https://devpost.com/software/recruit-h3lc2r>
(read 2026-11-11). The project describes itself as Next.js 16 + React 19 +
Convex, with K2 Think V2, OpenAI and Gemini as interchangeable providers.

**Demonstrated in the submission**

- One candidate profile built by six intake adapters: GitHub, LinkedIn, resume
  PDF, web, chat and voice. Each yields progress events and profile patches with
  provenance.
- Ashby board ingestion, then ranking by BM25 keyword matching plus LLM
  confidence, presented as a leaderboard of the best-fit roles (top 40, cutoff
  70).
- Three-layer research per role: job requirements, what the company does, and
  culture, with model reasoning and web search.
- Resume tailoring per role with a hard anti-fabrication validator, banned
  clichés and keyword-coverage scoring; failures retry at temperature 0 and then
  fail rather than submit a dishonest resume.
- ATS form filling with field classification by answerability: safe facts
  auto-filled, derived data mapped, sensitive questions sent to a dead-letter /
  review queue, essays drafted only with mandatory review.
- Submission staged with captured evidence, dry-run by default; the submission
  step is always gated.
- An answer approved once is cached for future forms.
- Follow-ups auto-scheduled at +5 business days (email) and +12 business days
  (LinkedIn), with generated drafts and manual triggers.
- A review-queue screen, a dashboard leaderboard, a command palette, a 5-step
  onboarding flow, and a 3D agent room.

**Recruitt's own "What's next" (not parity requirements)**

- Validated fill paths for Greenhouse and Lever (ingestion-only at submission
  time).
- Replayable application traces for auditing agent decisions.
- Confidence-gated auto-submit above a score threshold.
- Recruiter outreach and follow-up scheduling as first-class workflows.
- Launching the hosted product with the pricing tiers already on its landing page.

**What is deliberately not reproduced**

- Convex as a backend. RoleSpec is PostgreSQL/Prisma on both web and the
  packaged desktop runtime; adding a second database is a portability and
  operational regression, and Recruitt's real-time behavior can be met with
  persisted runs plus revalidation.
- A hosted multi-tenant account system, billing tiers, or a 3D room. RoleSpec is
  an explicit single-owner workspace. These are product-surface choices, not
  workflow capabilities.
- A headless cloud browser (Browserbase/Playwright) for intake or submission.
  The packaged app must not depend on a remote browser service, and filling a
  third-party form headlessly removes the user gesture that makes the current
  extension safe.
- Reproducing K2 Think V2 specifically. The requirement is provider-agnostic
  stage routing with honest degradation, which the existing provider layer
  already provides with more providers.

## Technical references

Each row records what the source establishes and the decision it supports. URLs
were read on 2026-11-11.

| ID | Source | What it establishes | Decision |
| --- | --- | --- | --- |
| R1 | Robertson et al., *Okapi at TREC-3* — <https://www.microsoft.com/en-us/research/publication/okapi-at-trec-3/> | Origin of the Okapi BM25 ranking function. | Implement BM25 as a documented, testable formula rather than an ad-hoc keyword count. |
| R2 | Lucene `BM25Similarity` — <https://github.com/apache/lucene/blob/main/lucene/core/src/java/org/apache/lucene/search/similarities/BM25Similarity.java> | Production formula: `Σ IDF(t)·tf·(k1+1)/(tf + k1·(1−b+b·dl/avgdl))`, `IDF = log(1+(N−n+0.5)/(n+0.5))`. | Use exactly this formula, with `k1 = 1.2` and `b = 0.75`. |
| R3 | Lucene 10.5.1 `BM25Similarity` docs — <https://lucene.apache.org/core/10_5_1/core/org/apache/lucene/search/similarities/BM25Similarity.html> | `k1` controls term-frequency saturation, `b` controls length normalization; defaults 1.2 and 0.75. | Expose both as constants with a versioned ranking profile, not user-facing knobs. |
| R4 | PostgreSQL 18, Ranking Search Results — <https://www.postgresql.org/docs/current/textsearch-controls.html> | `ts_rank`/`ts_rank_cd` use no global corpus information: no IDF, no average document length, and all matches are scored. | Do not present `ts_rank` as BM25. Use it only as an optional candidate prefilter if the pool grows. |
| R5 | ParadeDB — <https://github.com/paradedb/paradedb> | `pg_search` adds real BM25 through a Tantivy index access method. | Rejected as the primary engine; see the portability row below. |
| R6 | ParadeDB deployment/extension docs — <https://www.paradedb.com/docs/operate/deploy/self-hosted/extension> | Requires PostgreSQL 15–18, superuser, `shared_preload_libraries`, and (since 0.25) pgvector; prebuilt binaries target Linux/macOS, not Windows. | Cannot ship in the bundled Windows PostgreSQL 17 cluster. A user-installed extension would make behavior environment-dependent. |
| R7 | PGXN `pg_search` README — <https://www.pgxn.org/dist/pg_search/0.26.5/pg_search/README.html> | Community edition is AGPL-3.0 with a commercial edition; not available on managed services that do not ship it. | Keep ranking in application code so web, Docker and desktop behave identically. |
| R8 | pg-boss — <https://github.com/timgit/pg-boss> | PostgreSQL-backed job queue, Node 22.12+, PostgreSQL 13+, `SKIP LOCKED` claims, at-least-once delivery. | Viable fallback if the small workflow table becomes too limited; not needed for phase 1. |
| R9 | pg-boss job options — <https://pgboss.io/api/jobs> | Retries default 2, configurable backoff, expiration and heartbeats; handlers must tolerate repeats. | Any worker design must have idempotent steps and explicit retry limits. |
| R10 | Graphile Worker requirements — <https://worker.graphile.org/docs/requirements> | PostgreSQL 12+, Node 22.18+, PostgreSQL holds the jobs. | Second viable fallback; same idempotency constraint. |
| R11 | Graphile Worker error handling — <https://worker.graphile.org/docs/error-handling> | A force-killed worker can leave jobs locked for up to four hours. | A desktop app must reclaim stale leases faster than that on restart, so the workflow table stores its own lease deadline. |
| R12 | PostgreSQL `SELECT` / `FOR UPDATE SKIP LOCKED` — <https://www.postgresql.org/docs/current/sql-select.html> | Competing consumers can claim distinct rows without blocking. | Evaluated; the delivered worker uses one conditional `updateMany` claim per run, which is atomic for the row and needs no raw SQL. `SKIP LOCKED` remains the fallback if multi-row claiming is ever needed. |
| R13 | Prisma 7 transactions — <https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions> | `$transaction([...])` is a fixed sequential batch; interactive transactions are for dependent reads/writes. | Use interactive transactions when a state change and its audit row must commit together. |
| R14 | Prisma 7 PostgreSQL adapter — <https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql> | Prisma 7 requires a driver adapter for direct connections; the repo already uses `@prisma/adapter-pg`. | No new database driver. Follow the existing `src/shared/lib/prisma.ts` path. |
| R15 | Chrome `sidePanel` API — <https://developer.chrome.com/docs/extensions/reference/api/sidePanel> | MV3, `sidePanel` permission, Chrome 114+, `open()` needs a user gesture. | Keep the existing side-panel architecture and manifest minimum. |
| R16 | Chrome declare permissions — <https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions> | `optional_host_permissions` are granted at runtime from a user gesture. | No new install-time host permissions; keep per-origin grants. |
| R17 | Chrome `scripting` API — <https://developer.chrome.com/docs/extensions/reference/api/scripting> | `registerContentScripts()` from Chrome 96, `persistAcrossSessions` defaults true. | Keep runtime registration for fit badges; no static content scripts. |
| R18 | Chrome Storage API — <https://developer.chrome.com/docs/extensions/reference/api/storage> | `storage.session` is memory-only and not exposed to content scripts; `storage.local` persists. | Verdict cache stays in `storage.session`; approved answers need an explicit persistence decision. |
| R19 | Chrome content-script manifest reference — <https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts> | Content scripts are classic scripts; no module type. | The badge bundle remains an IIFE; do not convert it to ESM. |
| R20 | OWASP Browser Extension Vulnerabilities Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html> | Extension storage is not encrypted; avoid persisting sensitive data; prefer session storage. | Local approved answers are a per-machine convenience, not secure storage. Server persistence must be opt-in and encrypted. |
| R21 | OWASP ASVS — <https://asvs.owasp.org/> | Current stable is ASVS 5.0.0 (30 May 2025); V6 Authentication, V7 Session Management, V8 Authorization. | Cite requirements as `v5.0.0-8.x`; every new route scopes by the resolved owner id. |
| R22 | OWASP ASVS v5.0.0 V8 — <https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x17-V8-Authorization.md> | Authorization must be enforced server-side at every access. | New workflow/review/submission rows are owner-scoped through a composite or `userId` filter on every read and write. |
| R23 | OWASP Top 10 for LLM Applications 2025 — <https://genai.owasp.org/llm-top-10/> | LLM01 Prompt Injection, LLM06 Excessive Agency and LLM09 Misinformation are the relevant classes. | Treat posting and page text as untrusted, keep tools narrow, and never let a model write a submission. |
| R24 | OWASP LLM06:2025 Excessive Agency — <https://genai.owasp.org/llm-risk/llm062025-excessive-agency/> | Mitigations: minimize functionality/permissions/autonomy, human approval for high-impact actions, downstream mediation. | A workflow may draft and stage; it may never submit, accept terms, or answer a sensitive question. |
| R25 | Ashby public job posting API — <https://developers.ashbyhq.com/docs/public-job-posting-api> | Keyless `GET /posting-api/job-board/{name}` returns title, location, workplace type, description, compensation, URLs. | Extend the existing Ashby adapter rather than adding a second Ashby client. |
| R26 | Greenhouse job board API — <https://docs.greenhouse.io/job-board.html> | Public `GET /v1/boards/{token}/jobs`, `?content=true` for descriptions. | Existing adapter already covers this shape; no authenticated employer API is needed. |
| R27 | Lever postings API — <https://github.com/Lever/postings-api> | Public `GET /v0/postings/{site}?mode=json`, rate limit only on application POSTs. | Existing adapter remains sufficient for ingestion. |
| R28 | Workable jobs API — <https://workable.readme.io/reference/jobs> | Requires a bearer token; 10 req/10s for account tokens. | Do not claim Workable ingestion without a user-supplied token; keep it out of phase 1. |
| R29 | SmartRecruiters Posting API — <https://developers.smartrecruiters.com/docs/posting-api> | Public postings endpoint with a documented rate limit. | Candidate for a later adapter; not required for parity of the demonstrated workflow. |
| R30 | Workday developer documentation — <https://developer.workday.com/documentation/pyd1580334491723> | REST APIs are tenant-scoped and OAuth-authenticated; no public global job-board API. | Keep the existing conservative Workday handling; do not build an authenticated tenant integration. |
| R31 | PostgreSQL versioning policy — <https://www.postgresql.org/support/versioning/> | PostgreSQL 14–18 are supported as of 2026. | Target the bundled PostgreSQL 17 and the Docker/self-host minimum, not an EOL version. |
| R32 | Tauri capabilities — <https://tauri.app/security/capabilities/> | Capabilities gate which commands and windows the desktop shell exposes. | Any new loopback endpoint or shell action must be added deliberately, not by widening the capability file. |
| R33 | Next.js `after` — <https://nextjs.org/docs/app/api-reference/functions/after> | `after()` schedules work to run after the response has been sent, within the request's lifetime. | Intake creates rows and returns `202`, then runs adapters with `after()`; no detached process or second server. |
| R34 | OWASP SSRF Prevention Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html> | Validate URLs, allowlist schemes/hosts, reject private addresses and revalidate redirects. | Reuse `fetchPublicUrl` and `scanPortfolio`; the intake web adapter adds no raw fetch path. |
| R35 | MDN Web Speech API — <https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API> | Browser speech recognition produces a text transcript and is not available in every browser. | Voice intake consumes a client transcript; the UI exposes a paste/type fallback and the server never receives audio. |
| R36 | GitHub REST users — <https://docs.github.com/en/rest/users/users> | Public user metadata includes login, name, bio and public repository count. | The existing GitHub scan reads only these public fields; no token or private scope. |
| R37 | GitHub REST repositories — <https://docs.github.com/en/rest/repos/repos> | Public repository metadata includes description, language, topics, stars and last push. | Project evidence and language/topic skills come from this metadata; forks and archived repositories are skipped. |
| R38 | OWASP ASVS v5.0.0 V8 — <https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x17-V8-Authorization.md> | Authorization must be enforced server-side at every access. | Every intake read/write is filtered by the resolved owner id, including source-run and patch traversal; a foreign id is 404. |

## Decisions

**Decision:** Ranking is a pure TypeScript BM25 implementation over the current
candidate pool, computed after deterministic qualification. Corpus statistics are
the pool's own (`N`, per-term `n`, `avgdl`), the profile supplies the query terms,
and the response carries a snapshot with the corpus statistics, query terms and
parameters that produced it. This keeps desktop, Docker and hosted behavior
identical, needs no extension, no superuser and no new service, and is testable
against known fixtures. `pg_search` was rejected because it does not ship for
Windows and would make the same profile rank differently on different machines
(R5–R7). The snapshot is returned, not persisted; a stored leaderboard would be a
new table and is not claimed here.

**Decision:** Do not use PostgreSQL `ts_rank` as the ranking score. It has no IDF
or average document length and its output is not comparable across queries (R4).
It may later serve as a cheap prefilter, never as the documented score.

**Decision:** The composite is `lexicalWeight × normalized BM25 + (1 −
lexicalWeight) × seven-factor score`, default 0.4. The factors are `SKILLS`,
`EXPERIENCE`, `LOCATION`, `WORK_MODE`, `SALARY`, `AUTHORIZATION`, `FRESHNESS`.
`UNKNOWN` earns no points and lowers `coverage`; it is never rounded up to a
match, which keeps a thin posting from outranking a complete one by saying less.
A missing profile answer (sponsorship, salary, seniority) stays null rather than
being inferred. A posting with no description has a null lexical score, not zero.
This follows the same conservative rule as the existing qualification service:
a false `BLOCKED` or a false `MATCH` is costlier than an honest `UNKNOWN` (R36).

**Decision:** Salary comparison is only performed in the same currency and with a
readable period, annualizing hourly at 2,080 hours and monthly at 12. No FX rate
is assumed: a PHP posting and a USD preference produce `UNKNOWN`, because a
stale or invented rate would silently mis-rank a job. The schema can store only
`USD` and `PHP`, so every other currency parses its amount but stays incomparable.

**Decision:** The LLM rerank is optional, bounded to the top 20 by default and 40
maximum, and may only reorder with a verbatim quote from the posting. Unknown ids,
ungrounded quotes and any provider failure are discarded or returned with a
warning, leaving the deterministic order. The model cannot change a factor state,
a score or a stored qualification. Structured output plus a deterministic
validator is the same approach the tailoring and company-research paths use (R14,
R16–R17).

**Decision:** Research is three separately labelled layers: requirements, company
facts and culture. A culture claim is `VERIFIED` only when an independent fetched
source quotes it, `STATED_IN_POSTING` when only the posting says it, and `UNKNOWN`
when nothing does. `sourceSummary` counts distinct hosts excluding the posting
host, so "independent verification" is measured by host, not by number of
citations. Irreconcilable claims become an explicit conflict instead of a silent
pick, and a 30-minute in-process cache avoids re-fetching the same company for a
retry while staying compatible with the single-owner desktop runtime (R34–R37).

**Decision:** Durable execution is a PostgreSQL-backed `WorkflowRun` /
`WorkflowStep` pair driven by an in-process worker inside the existing Next.js
server. `FOR UPDATE SKIP LOCKED` was evaluated; the implemented claim is a
conditional `updateMany` on `(id, state = ASSISTED, leaseExpiresAt free or
expired)`, which returns `count = 1` for exactly one worker and avoids raw SQL
while keeping the same atomic claim. Each run holds a 60-second lease renewed
every 20 seconds, a `RUNNING` step is returned to `PENDING` after an expired
lease with its interrupted attempt refunded, and steps are unique on
`(runId, name)` with an idempotency key. This works in the packaged Windows app
with no Redis, no separate daemon and no cloud queue (R8–R13, R31).

**Decision:** Do not add Convex, Redis, BullMQ, a cloud workflow service, or a
second database. A new infrastructure dependency must first prove it runs inside
the Tauri-packaged Windows runtime and preserves the single PostgreSQL schema and
migration history. None of the researched options clears that bar better than the
workflow table.

**Decision:** Keep the single-owner model. Recruitt's hosted accounts, pricing
tiers and team surface are not workflow features and are explicitly out of scope.
Every new table is still owner-scoped so a future multi-tenant change would not
require a data rewrite (R21–R22).

**Decision:** AI remains optional at every stage. Manual qualification, manual
research notes, manual tailoring, manual form filling, and manual follow-up must
all work with no provider configured. Every AI step has a deterministic fallback
or an explicit "needs your input" outcome.

**Decision:** Reproduce the review queue as a first-class server-side
`ReviewTask`, not only as extension-local UI. A task names the exact question, the
reason it could not be answered, a suggested value when one is grounded, and the
supported manual fallback. Resolving a task is an owner action with an audit row
(R20, R24).

**Decision:** Answer reuse is opt-in per answer and stored encrypted server-side
using the existing `secret-box` path, with the extension keeping only a cache.
OWASP is explicit that extension storage is unencrypted; a shared answer cache is
useful enough to keep, but it must not be silently persisted as plaintext (R20).

**Decision:** Never auto-submit, never accept terms, and never answer work
authorization, sponsorship, compensation, demographic, legal-history or
disability questions automatically. The submission record is a staging record
with evidence and an explicit "I submitted this myself" confirmation. This is both
the product rule and the OWASP excessive-agency mitigation (R23–R24).

**Decision:** Anti-fabrication is enforced by deterministic validators after model
output, not only by prompt wording. A rewrite that introduces an employer, skill,
metric, credential or date absent from the candidate's own text is discarded and
recorded. One bounded repair attempt is allowed; a second failure ends that step
in `FAILED` with a specific message, never a silent downgrade.

**Decision:** Follow-up timing is business-day arithmetic stored as a due date,
using the Recruitt cadence (+5 business days email, +12 business days LinkedIn)
as a default that the user can change. The app surfaces a due task and drafts the
message; it never sends email or LinkedIn messages itself.

**Decision:** ATS form filling stays extension-only and gesture-driven. No
headless browser, no remote browser service, no static host permissions. The
extension may stage a resume file for upload and read field labels, but the user
performs the upload and the submit (R15–R19).

**Decision:** Provider routing is per stage through the existing user AI settings
(`UserAiSettings`), not a process-wide environment variable. A stage records which
provider and model produced its output so a re-run is explainable. Adding K2 Think
V2 specifically is not required for parity.

**Decision:** All six intake sources produce one canonical `IntakePatch` event
(`CONTACT`, `EVIDENCE`, `SKILL`, `TARGET_ROLE`) with source, confidence and a
provenance envelope. Adapters never write Prisma and never produce a
source-specific table. This is what makes one review queue, one conflict rule and
one apply path possible.

**Decision:** Intake is a bounded, request-scoped run, not a second general
workflow engine. The route persists `IntakeRun`/`IntakeSourceRun`, schedules the
parallel adapters with Next `after()` (R33), streams persisted progress, and
offers explicit cancel/retry. It uses PostgreSQL plus the existing Next server,
with no Redis, Convex, BullMQ or daemon. The P1 `WorkflowRun` remains the
substrate for pauses, leases and application steps; intake must not grow a
competing worker.

**Decision:** Duplicate claims are matched by a normalized fingerprint: field and
value for contact, kind/title/organization for evidence, alias-folded name for
skills and title for target roles. In-run dedupe uses a stricter exact-claim key
that also includes evidence dates, details and outcome, so only equivalent
claims collapse; a same-role claim with different dates survives and becomes a
persisted `IntakeConflict` when applied against the existing profile. The
highest-confidence exact duplicate inside a run is kept and the other carries an
audit reason. Near-duplicates with different titles are not fuzzy-merged because
a wrong merge is harder to notice than an extra review row. See
`FEATURE_PARITY.md` F09.

**Decision:** Intake source content is server-side run state, not part of the
profile DTO. `IntakeSourceRun.input` holds resume text or a chat/voice transcript
so retry survives a restart; raw file bytes and audio are never stored, and the
API never returns the input. Applied evidence keeps provenance in `metadata`;
contact, skill and target-role provenance remains queryable through the linked
`IntakePatch`.

**Decision:** LinkedIn is user-export-only and voice is client-transcript-only.
The LinkedIn adapter never signs in, scrapes a profile URL or bypasses an access
restriction; the voice adapter never uploads audio or depends on ElevenLabs. Both
paths fall back to deterministic text extraction and, if that is insufficient, to
the manual profile form. Optional AI is grounded to the user's own statements and
any provider failure degrades with a warning.

**Decision:** GitHub and web intake reuse the existing SSRF-safe fetcher and add
per-run consent, not a new HTTP client. Private addresses, credentials in URLs,
unsupported content types and redirects into private space are rejected before
content is read (R34, R36–R37).

**Decision:** A tailored resume is restorable from an immutable `ResumeSnapshot`
of the exact source revision, hashed as canonical JSON (sorted keys, no volatile
fields). Storing only `sourceResumeId` would make rollback follow later edits to
the source, which is the opposite of a version-specific restore; storing a diff
would make restoration depend on a chain that can be broken by later edits. The
snapshot payload is written once and never updated, while `restoredAt` and
`restoreCount` record restores without rewriting it (R14, R16–R17).

**Decision:** Tailoring is fail-closed on unsupported claims, with an initial
generation plus at most two repair passes. Repair receives the exact validation
messages and rejected suggestions; there is no unbounded retry. If all three
generations still contain an unsupported claim, no resume row is created and the
workflow pauses with a human-review question. This follows the existing
grounding rule that a false claim on an application is worse than an honest gap,
and keeps provider cost bounded in the packaged desktop runtime (R14, R16–R17).

**Decision:** Single-page export measures the real rendered PDF with `pdf-parse`
and tries at most three tighter presentation configurations of the SAME template.
It never truncates grounded content to force a page count. If one page remains
impossible, the tightest render is returned with an explicit warning, because a
silent content cut is a content-integrity failure (R14, R16–R17).

## Open questions

- Whether a later phase should offer pg-boss instead of the in-house claim loop.
  The deciding measurement is worker restart behavior on the packaged Windows
  build, which needs a real install test.
- Whether one-page tailoring should hard-truncate. Current evidence favors
  measuring and warning: silently deleting grounded content is worse than a
  two-page resume the user can see.
- Whether exact fingerprint matching should gain fuzzy title/organization
  matching. The current rule prefers an extra review row over a plausible wrong
  merge; the deciding evidence would be real duplicate rates from user runs.
- Whether intake runs need a lease/reclaim loop like P1, or whether Cancel →
  Retry is enough for a single-owner desktop app. The deciding test is a Windows
  process kill during a live GitHub or AI-backed run, not a synthetic unit test.
