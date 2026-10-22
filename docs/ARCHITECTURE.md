# RoleSpec Architecture

RoleSpec is an open-source, self-hosted autonomous Job-Seeking AI Operating System, designed for a private, personal job-search workflow.

## Core product loop

`Career Profile → Discover → Qualify → Prepare → Apply → Track → Follow up → Outcome → Learn`

## Canonical entities

- **Career Profile** — canonical, user-owned career truth: evidence, capabilities, preferences and goals.
- **Master Resume** — strong reusable resume; does not require a job description.
- **Role Family Resume** — reusable variant for a class of similar roles.
- **Job-Tailored Resume** — optional derivative for one specific job/application.
- **Job** — normalized opportunity/discovery object with source/provenance and qualification state.
- **Application** — user activity/tracking record for a Job.
- **Outcome** — application result and learning signal.
- **Opportunity Confidence** — separate from profile match; evidence about whether a posting is likely to be current, actionable and worth the user's time.

## Resume architecture

`Career Profile → Master Resume → Role Family Resume → optional Job Tailoring`

The Master Resume and Role Family Resume must work without a job description. Job descriptions may influence final prioritization, wording and ATS alignment only after the user's own evidence is established.

Capability strength comes from user evidence, depth, repetition, outcomes, recency and explicit confirmation. A job description never becomes evidence of a user capability.

## Job discovery architecture

Discovery is a multi-source acquisition engine for the canonical `Job` entity, not a Remotive-only feature and not a separate scraper product.

Preferred pipeline:

`Career Profile → search strategy → source/search adapters → search/discover → fetch/scrape/extract → normalize → deterministic dedupe → Job → qualification → opportunity-confidence assessment`

### Reference implementation

`Ry0x7/ai-job-scraper` is an MIT-licensed reference for the discovery pattern. Its useful concepts include:

- derive target roles/queries from the candidate profile
- search multiple job sources
- fetch/scrape result pages
- extract individual postings from listings or single-posting pages
- normalize fields
- keep fallback search snippets when scraping fails
- deduplicate URLs/results
- pass normalized jobs to downstream scoring/review

Reimplement these concepts in RoleSpec's existing Next.js/TypeScript architecture. Do not copy the reference repository's Python/FastAPI dashboard or make it a runtime dependency.

### Sources and public-web discovery

Use replaceable adapters and a generic public-web discovery path. The absence of a public API must not, by itself, end the attempt.

Prefer a practical mix of:

- structured job APIs/feeds where available
- search-engine discovery of public job/career pages where permitted
- public ATS/career systems such as Greenhouse, Lever or Ashby where technically practical
- direct company careers/jobs pages
- other compliant public job sources relevant to the user's target markets
- contextual extension capture when automated access is unavailable or unreliable

Direct company discovery is a first-class path: use target companies, role families and profile preferences to locate public company careers/jobs pages, identify individual postings, fetch/extract them when accessible, and send them through the same normalization/deduplication pipeline.

For PH-first personal use, prioritize coverage relevant to Philippine roles and employers before optimizing global source breadth. Candidate PH sources include JobStreet PH, OnlineJobs.ph, Jooble PH, Careerjet and direct Philippine company/ATS pages, subject to access policy, live verification and source reliability.

### Public-web access policy

Goal: broad **compliant public-web discovery**, not bypassing site controls.

For each source:

`check access → attempt permitted search/fetch → extract if available → record failure/restriction → fallback`

Do not:

- bypass CAPTCHAs
- bypass login/authentication walls, paywalls or technical access controls
- evade explicit anti-bot/access controls
- impersonate users to defeat restrictions
- scrape private or access-restricted content

A source being technically difficult, API-less, or unavailable through the current adapter does not mean RoleSpec must abandon that source. Try other permitted public discovery mechanisms, direct company pages, or extension capture.

Search-result snippets are a fallback signal only. Prefer the actual public posting when accessible.

### Discovery pipeline requirements

1. Build search strategy from Career Profile, role families, target companies and user preferences.
2. Run searches across multiple source/search adapters.
3. Collect candidate URLs/results.
4. Fetch public result/posting pages where permitted.
5. Extract individual postings, not just search-result summaries.
6. Preserve provider/source, canonical URL, external id when available, timestamps and failure state.
7. Normalize fields into the canonical `Job` model.
8. Deterministically deduplicate before expensive AI.
9. Qualify against Career Profile evidence.
10. Assess Opportunity Confidence separately from profile match.
11. Let the user decide whether to save/pursue.

Source adapters should be isolated so one blocked/outage-prone provider cannot break the full run. Failures should be observable and should not poison successful sources.

Discovery never submits applications automatically.

## Opportunity Confidence

`Profile Match != Hiring Confidence`

Profile match answers:
> Does this opportunity fit the user's career profile?

Opportunity Confidence answers:
> Is there enough evidence that this posting is current, actionable and worth spending time on?

Confidence should use observable signals, not certainty claims. Examples:

- source provenance
- official company/ATS origin
- posting freshness
- direct application path
- employer/company identity
- completeness of posting
- listing status when exposed by the source
- corroboration across reputable sources
- suspicious/stale indicators

Use statuses such as `HIGH`, `MEDIUM`, `LOW`, or `UNKNOWN` rather than claiming a posting is definitely real.

A strong profile match with low opportunity confidence should not outrank a slightly weaker match with strong evidence of an actionable opportunity without making the trade-off visible.

Ghost-job detection is probabilistic triage, not a factual accusation. Do not label a company dishonest solely because a posting is stale, closes without a hire, or lacks a public hiring signal.

## Job / Application boundary

`Job = opportunity`

`Application = user's decision/activity against that opportunity`

The canonical posting lives on `Job`; application state belongs on `Application`.

## Extension

The browser extension is the contextual browser companion, not the primary discovery engine and not a second dashboard.

`Automatic discovery → web app`

`Current browser page → extension → capture/analyze/research → web app`

Use it when automated discovery cannot reliably access a source or when the user is already browsing. Supported contextual uses include job capture, networking/profile research, cold outreach and email reply assistance.

Prefer side panel, page-aware actions, context menus and keyboard shortcuts over repetitive toolbar-icon clicking.

The extension must reuse the same Job, Career Profile, Resume and Application primitives.

The extension must also be a good browser citizen: do not interfere with password managers, browser autofill, passkeys, password fields, login forms or unrelated page behavior. Never modify authentication fields or intercept normal form submission without a separately justified and verified feature.

## UX direction

RoleSpec should feel like one career workspace, not a collection of AI utilities.

Primary hierarchy:

`decide → prepare → apply → track → learn`

Use progressive disclosure. Keep primary actions visible; move analysis-heavy or secondary tools into contextual drawers/sheets when that preserves the user's editing context.

### Resume editor

- persistent app navigation
- sticky resume toolbar
- flexible full-width editor/preview workspace
- large readable preview
- optional Job Target drawer
- ATS inspector drawer
- Enhance suggestions drawer
- minimal vertical scrolling
- mobile editor-first flow with preview/analysis sheets
- job-free resume creation as the default

Do not turn it into a document-design suite or modal maze.

## User and privacy invariant

`session user → owner userId → owned Career Profile → owned resume/profile evidence → owned Jobs → owned Applications`

The self-hosted OS operates as a private, single-user system by default (auto-resolving to the local owner account). There are no administrative elevation gates, multi-tenant moderation barriers, or licensing callouts. All personal data and credentials remain strictly local.

## AI setup and connection testing

First-run onboarding and Settings share one setup layer: `src/features/onboarding/constants/ai-setup.ts`
for the plain-language choices, `src/features/onboarding/lib/provider-diagnostics.ts` for advisory
detection, and `src/features/onboarding/lib/ai-connection-test.ts` for the authoritative live test.

- Credentials still go through `UserAiSettings` and `src/shared/lib/secret-box.ts`. There is no
  second key store.
- Detection never reads or copies vendor auth files or tokens. CLI login state comes from the
  vendor's own status command; local servers come from their read-only model endpoints.
- The connection test runs through `testAiConnection()` in `ai-generate.ts`, so it uses the same
  resolver, quota reservation and usage accounting as feature calls. Detection is not a substitute
  for the test.
- `codex-cli` must use the user's installed Codex CLI, not the provider's older bundled binary, and
  must follow the CLI's configured model. ChatGPT-account model ids retire faster than releases.
- `opencode-cli` is the zero-cost hosted path: the server probes `opencode models --verbose` and
  exposes only zero-cost models from the `opencode` provider, so a retired or paid model never
  appears in a selector. Calls spawn `opencode run --format json` as a text generator. OpenCode's
  free tier rejects requests that omit the `read` tool, so `read` stays enabled while every other
  tool is disabled and the subprocess runs in an empty scratch directory with
  `external_directory: "deny"` — leaving it nothing useful to read or execute.
- Desktop distribution adds platform bootstrapping only: `desktop/` holds the Tauri 2 shell (bundled
  Node, bundled PostgreSQL 17) and `scripts/desktop/` fetches and stages those pinned runtimes. The
  shell runs the same `.next/standalone` bundle and `prisma/migrations`; domain logic, UI, AI
  providers and the Prisma schema stay shared with Docker/web. No desktop-only schema or AI path.
- Desktop data lives outside the install directory (`%LOCALAPPDATA%\RoleSpecData`): the PostgreSQL
  cluster, exports, logs and the stable `AUTH_SECRET`/`ENCRYPTION_KEY` pair. Losing that pair would
  make every stored AI key unreadable, so it is created once and never regenerated per launch.
  It is not `%LOCALAPPDATA%\RoleSpec`: that is where Tauri's per-user NSIS install places the app.

## AI and tools

All AI generation goes through `src/shared/lib/ai-generate.ts`.

- Haiku: narrow discovery/fact gathering.
- Sonnet: normal bounded implementation and UI work.
- Opus: complex implementation/debugging.
- Fable: security/privacy/concurrency/architecture judgment when justified.
- Serena: repository navigation.
- Context7: version-sensitive documentation.
- Neon: database/schema work.
- Playwright: browser verification.
- Impeccable: visual refinement after behavior is correct.

Use the smallest relevant model/tool set. Do not load the whole repository or documentation set for local work.

## Source of truth

Current code, schema/migrations and tests outrank planning text; external reference repositories are references, not product truth. This document defines durable architecture/product boundaries; `docs/ROADMAP.md` sequences work; `handoff.md` records the current execution checkpoint.
