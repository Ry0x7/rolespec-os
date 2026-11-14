# RoleSpec frontend design specification

Date: 2026-11-12. Status: implementation specification; no UI or backend changes are delivered by this document.

## 1. Product direction and authority

RoleSpec is a private, single-owner job-search workspace. The design extends its existing manual loop: **Career Profile → Discover → Qualify → Prepare → Apply → Track → Follow up → Outcome**. Assistance prepares reviewable work around that loop. It does not replace the user's records, consent or judgment.

The product's organizing idea is **an evidence-led workbench**. A user should always be able to answer three questions: Why is this opportunity worth my time? What has actually been prepared? What needs my decision? The distinctive interaction is a continuous evidence path: ranked opportunity → factor explanation → candidate evidence → resume claim → staged application. Selecting an explanation reveals its supporting material in context instead of opening a generic chat.

This is an Operate surface. Precision, legibility and reliable actions carry the identity. Reuse the existing RoleSpec shell, fonts, themes, primitives, resume editor and manual actions. No replacement brand, marketing treatment or second navigation system is required.

### Evidence read and precedence

The local checkout is the implementation authority for the [RoleSpec repository](https://github.com/Ry0x7/RoleSpec-os). This specification draws on:

- [FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md), [API_CONTRACTS.md](API_CONTRACTS.md) and [WORKFLOW_STATES.md](WORKFLOW_STATES.md): transport, payloads, state transitions and missing surfaces.
- [ARCHITECTURE.md](ARCHITECTURE.md), [ATS_SUPPORT.md](ATS_SUPPORT.md), [FEATURE_PARITY.md](FEATURE_PARITY.md), [ROADMAP.md](ROADMAP.md) and [VERIFICATION.md](VERIFICATION.md): ownership, safety boundaries, delivered behavior and verification limits.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [RESEARCH.md](RESEARCH.md): implementation history and rationale; older proposed paths and delivery claims are superseded by current handlers and contracts. [DESKTOP.md](DESKTOP.md) supplies desktop runtime context.
- Actual route pages under `src/app/(app)`, `src/config/navigation.ts`, `src/app/globals.css`, `src/shared/ui`, shell/palette components and feature components/actions for jobs, discovery, intake, career profile, resumes, workflows, ATS, submissions and settings. Concrete reuse targets appear in §15.
- The committed `screenshots/resume-editor.png`, inspected alongside current theme tokens and editor/shell source. It corroborates the existing split workbench and restrained dark chrome; it is not a fresh browser verification of this proposal.

The [Recruitt Devpost submission](https://devpost.com/software/recruit-h3lc2r), read 2026-11-12, describes intake provenance, ranking, layered research, grounded tailoring, human review, answer reuse and staged applications. Those functional ideas inform the connected experience. Its visual assets, copy, Convex architecture, pricing and autonomy claims are not adopted. Its written submission is reference material, not evidence that RoleSpec supports a feature.

Where documentation conflicts, use current code plus the normative contracts. Specific reconciliations a builder must retain:

| Topic | Implementation truth | Design consequence |
| --- | --- | --- |
| Workflow mode | Mode is fixed at creation; there is no mode-update route. Both modes initially have state `MANUAL`. | A workspace mode selector sets the next-run preference, not the mode of existing runs. |
| Workflow discovery | `discovery.executor.ts` derives queries and board links without fetching live jobs. | Label it “Prepare search links”; actual searching stays in Discover. |
| ATS preparation | Workflow `PREPARE_ATS` prepares profile fields and questions; it does not scan the employer's form. | Separate “Prepared facts” from “Detected / filled fields” reported by the extension. |
| Human checkpoint | `SUBMISSION_CONFIRMATION` in a workflow approves staging with `{ approved: true }`. | Label the action “Approve preparation”, never “I submitted”. Actual submission confirmation is a later action. |
| Resume choice | Tailoring and checkpoint approval do not write `JobApplication.resumeId`. Staging may reference the tailored draft. | Show selected application resume and staged-attempt resume separately; use the existing explicit resume-selection action. |
| Answer memory | List/edit/revoke APIs are bearer-only. The cookie review PATCH can record an ATS answer and its scope. | Web can resolve ATS tasks; complete memory management remains in the extension. No web bearer-token workaround. |
| Ranking | Persisted snapshots exist; GET returns only the latest. | Load the saved result; do not recompute on navigation or offer historical snapshot selection. |
| Ranking envelope drift | Current `saveRankingSnapshot` stores the base `RankingResult`; the POST adds warnings, poolSize, reranked and snapshotId outside that result. | On GET use wrapper `reranked`/`poolSize`; do not expect POST warnings or snapshotId inside saved `result`, despite the handoff's “exact response” wording. |
| Intake | Intake patches are distinct from `ReviewTask`; intake has cancel/retry, no pause or lease recovery. | One review destination can compose both resources without merging their lifecycles. |
| Validation | Reports are historical; editor changes do not automatically run workflow `VALIDATE` again. | Never imply an old PASS certifies a newer edited draft. |

### Hard boundaries

No automatic submission, terms acceptance, email sending, LinkedIn sending, CAPTCHA bypass, live LinkedIn scraping, hosted account/billing design, invented agent messages or fake progress. Manual editing, qualification, notes, form completion, tracking and PDF export remain usable without AI. Provider-dependent actions explain their requirement and link to configuration; they do not block manual work.

## 2. Information architecture

Keep existing URLs and bookmarks. New routes below are proposed frontend routes backed by existing capabilities, not claims that those pages already exist. `/jobs/:id` continues to mean a **JobApplication id**, while ranking `postingId` means a **Job id**.

### One shell, one primary navigation

Retain `Sidebar`, `Header`, `MobileNav`, breadcrumbs, skip link and the single command palette. Use these groups:

| Group | Navigation label | URL | Purpose |
| --- | --- | --- | --- |
| Start | Dashboard | `/dashboard` | Daily command center and latest ranked opportunities |
| Career | Career Profile, Resumes, LinkedIn | Existing URLs | Candidate truth, documents, export-based LinkedIn tools |
| Opportunities | Discover, Jobs | `/jobs/discover`, `/jobs` | Find opportunities; manage tracked applications |
| Activity | Workspace, Review, Planner | `/workspace`, `/workspace/review` (new), `/planner` | Existing board with local views; decisions; calendar/tasks/notes |
| Tools | Cover Letters | `/jobs/cover-letter` | Existing letter workflows |
| Footer | Settings | `/settings` | Existing settings tabs |

Add only **Review** to primary navigation. Keep its position and label identical in desktop navigation, mobile drawer and palette. Use longest-prefix matching so Review, Runs and run detail do not also select the Workspace item. Update page titles and breadcrumbs for the new routes.

Workspace gets a local view switch: **Board / Runs / Room**. Board stays at `/workspace`, Runs at `/workspace/runs` (new), run detail at `/workspace/runs/:runId` (new). Room is optional at `/workspace?view=room`, sharing the same records. Do not add “Agents”, “Leaderboard”, “Applications” and “Inbox” as duplicate primary destinations. Jobs is the application tracker; Dashboard owns the leaderboard.

Header: current location on the left, Quick actions and the existing owner menu on the right. An “Attention” button may expose the derived tray in §12; it is not a persistent notification inbox. Place the mode preference in Dashboard's page toolbar and the run-creation form, not beside every navigation item.

### Navigation state and deep links

- Keep existing `#decide`, `#prepare`, `#track`, `#posting` links on job detail and its research anchor. Preserve existing job-list filters, sort and return links.
- New frontend URL state: review `?status=OPEN&kind=...&task=:id`; intake selection `?intake=:runId&patch=:patchId`; run list `?state=...`; run detail `?step=TAILOR`; resume inspector `?inspector=compare|validation|history`. Only non-sensitive ids and view filters belong in URLs. Implement parsing before advertising these links.
- Open a review drawer from a page by linking to its canonical review selection. Back returns to the previous selection/scroll position. Direct loading opens the full review destination. A selection outside the loaded bounded result is unavailable until found; there is no `GET /api/review-tasks/:id` route to invent.
- Opening a new tab via a job title or source link must work. Keep actual links separate from row selection buttons and mutation buttons; avoid nested clickable rows.

## 3. Connected screen flows

### A. Preserve the manual loop

1. Complete or skip existing four-step onboarding; AI setup is optional.
2. Add career evidence manually or review imported proposals. Create/import a master resume.
3. Discover or paste a posting; save/track it through existing actions. Saving records interest, not an application submission.
4. On job detail, inspect qualification and research; choose a resume, edit or optionally tailor it. Cover letter, email and interview preparation remain accessible.
5. Open the employer site, complete and submit manually. Use the existing explicit tracker action to mark applied, or confirm a staged attempt if one exists. Do not require a workflow or stage record to track an application.
6. Work due reminders, record screening/interview/outcome and preserve the status timeline.

### B. Assisted preparation

Dashboard opportunity → tracked job detail → “Prepare with assistance” → confirm application, source resume and target role → create `AGENT_ASSISTED` run → `START` → persisted timeline → exact human questions → approve preparation → durable stage → open employer site → user submits → explicitly confirm submitted → tracker and follow-ups refresh.

If an active run already exists, “View preparation” replaces create. Never create a second run because a request is slow. On provider failure, preserve committed output and show Retry plus the manual editor fallback.

### C. Evidence and answer decisions

Attention/Review → select question → inspect application/run/preparation context → edit answer or follow the supported manual fallback → explicitly confirm scope and resolution → render returned task/run/preparation → refresh affected lists. A profile-intake proposal instead uses apply/correct/reject, then separate confirmation of imported evidence/skills in Career Profile. Neither action silently invents a qualification.

### D. Compare and prepare a resume

Job Prepare → tailored DRAFT → comparison with captured source → validation issues and evidence refs → edit/save → label previous validation as historical → preview/export → inspect real PDF and page-count warning → explicitly select the intended application resume. Returning to the job retains context through `?jobId=` and `#prepare`.

### E. Stop and continue

Pause run → confirm response state → continue editing manual artifacts if desired → Resume only if the same run should continue, with a reminder that subsequent steps may read current profile/application data. To change mode or immutable run inputs, cancel an active attempt explicitly, then create a new run. Terminal attempts remain in history.

## 4. Visual system and composition

### Existing tokens are the visual authority

Use semantic classes, not new per-screen hex values. These are observed defaults, not values to copy into components:

| Role | Dark token value | Light token value | Usage |
| --- | --- | --- | --- |
| Canvas `background` | `#09090C` | `#EDEDF2` | Main page |
| Navigation `sidebar` | `#0C0C10` | `#F7F7FA` | App navigation |
| Work surface `card` | `#131319` | `#FFFFFF` | Inspector/table surface |
| Quiet fill `muted` | `#1C1C23` | `#E3E3E9` | Selected row, grouped controls |
| Primary text `foreground` | `#FAFAFA` | `#09090C` | Content |
| Secondary `muted-foreground` | `#A9A9B6` | `#55555F` | Provenance and helper text |
| Divider `border` | `#26262E` | `#D3D3DB` | Row/panel separation |
| Accent / focus | Existing brand ramp and `ring` | Existing theme overrides | Primary action, selection and focus |

Preserve all six accent choices and dark/light/system settings. Do not reuse `rolespec-mode` for workflow mode; it already stores color mode. Success/warning/error/info use existing theme-aware Badge variants, text and icons. Unknown uses neutral plus “Unknown”; it is never green or a fabricated score of 50.

Typography: keep Space Grotesk for page/section titles, Inter for controls/body, JetBrains Mono only for compact technical identifiers. Use 24/32 px page titles, 18/26 px section titles, 16/24 px prose, 14/20 px rows/forms, 12/18 px metadata. Keep substantive questions and errors at least 14 px. Scores use tabular numerals, not oversized KPI typography. No uppercase paragraphs or tiny safety disclosures.

Spacing: 4 px base rhythm; 8 px within a control group, 12–16 px row padding, 24 px section separation, 32 px between major page regions. Preserve 6/8/12 px radius tokens. Borders group data; shadows are reserved for floating menus/drawers. No app-page glow, gradient wallpaper, glass-card grid or animated score ring. Existing marketing effects stay out of workspace surfaces.

### Layout contract

- Desktop shell retains 240 px sidebar and 56 px header. Content padding: 24 px desktop, 16 px mobile. General reading width caps at 1440 px within the content region; editor can use available width.
- At ≥1280 px, two panes are allowed when the actual content width accommodates them: roughly 60% main work / 40% inspector, 24 px gap, inspector minimum 360 px. Prefer full-width table with a drawer until both panes remain readable. Do not force a three-pane app into a 1280 px viewport with a sidebar.
- At 1024–1279 px, sidebar remains but work surfaces use one main pane and a drawer. Below 1024 px reuse the mobile navigation drawer. Below 768 px, convert ranking rows to compact semantic list items and inspectors to full-width dialogs/pages.
- At 320–430 px, each item shows title/company, score + coverage, one reason, status and one primary action; other metadata expands. Filters wrap or use a labelled filter disclosure. Page content must not scroll horizontally. Dense comparison can use a contained scroller with a stacked alternative.
- Keep one document scroll where possible. A long table may have a labelled bounded scroll region; do not nest three independently scrolling panels. Sticky controls may not cover focused fields, anchors or the mobile keyboard. Respect safe-area insets.

### Shared visual grammar

| Semantic state | Presentation | Meaning |
| --- | --- | --- |
| Ready / selected | Accent border or small selection marker | A selection, not proof of correctness |
| Running | Info icon + “Running” | Persisted `RUNNING`, not inferred activity |
| Waiting | Warning icon + “Needs your answer” | Human action required |
| Failed | Error icon + exact reason | Retry/manual path available as appropriate |
| Paused / pending / unknown | Neutral icon + explicit label | Distinct text for each state |
| Completed | Check + “Preparation complete” | Workflow output saved; does not mean submitted |
| Submitted | “Submission confirmed by you” + date | Actual positive user confirmation |

## 5. Dashboard: the job-search command center

### Hierarchy and first viewport

Top: “Home”, a short next-action sentence, mode preference, “Find opportunities” and “Track a job” (secondary). Beneath: one horizontal daily status strip for applications today, follow-ups due and the next seven days. Each metric carries a colour-coded state badge and links to the real filtered list where one exists. It is not a row of decorative metric cards, and it leads the page rather than sitting in the footer.

The workflow then runs in reading order: AI setup banner when needed, the single `NextActionCard`, getting-started guidance only while incomplete, the attention queue, **Ranked opportunities**, needs-attention decisions, then the pipeline and recent applications. Ranked opportunities remains the main work surface below daily triage, with ranked-at timestamp, pool size and “Update ranking”. On a 1440×900 desktop the status strip, next action and attention queue come first by design; a reader can reach the ranking without hunting through the bottom of the page. Do not append a second dashboard beneath the first.

Ranked row order: rank; role/company; location/work mode; **Ranking score**; **Known-factor coverage**; one explanation/unknown; application status; action. Title is a link. A separate “Why this rank” button opens the evidence inspector. Keep risk/opportunity confidence and qualification verdict visually separate from ranking score; expose them in row expansion or detail rather than stacking five badges beside every title.

Example anatomy (synthetic design data, never shipped as real results):

```text
Ranked opportunities             Ranked 12 Nov, 08:40 · 42 saved jobs
Top 20 · minimum score 40                            Update ranking
 #   Opportunity                 Rank score  Coverage   Next action
 1   Backend Engineer · Acme      82 / 100    85%        Review role
     Remote · PHP/month          Skills match; sponsorship unknown
```

### Ranking behavior

- Initial load reads `GET /api/ranking`; render `snapshot.result.entries`. The nested result's `snapshot` contains computation metadata. Do not confuse it with the outer persisted snapshot wrapper. On reload use the wrapper's `reranked`, `poolSize` and `id`; only the fresh POST response supplies its transient warnings and nullable `snapshotId`. Do not reconstruct a past fallback warning that was not persisted.
- Join `entry.postingId` to owned Job records and their application relations using the existing server-page ownership pattern or paged `/api/jobs` data. Resolve an actual application id before linking to `/jobs/:id`. For an untracked job, use the existing Track flow; never put a posting id into an application URL. Missing/deleted records remain labelled “Posting unavailable”; do not shift ranks or recalculate scores.
- Default new ranking intent: `topK: 20`, `minScore: 40`, `rerank: false`; omit `lexicalWeight` to keep the backend default. Restore parameters from the latest snapshot on later visits. These are explicit design defaults, not server-required values or Recruitt's cutoff.
- A compact settings disclosure permits top-K 1–100, minimum 0–100 and opt-in grounded AI reorder. Keep lexical weighting in the explanation, not a prominent tuning slider. Changing parameters edits the next request; only “Update ranking” issues POST. Keep previous rows visible and labelled while computing.
- Preserve response order and returned rank even after AI reorder; do not silently sort back by numeric score. If `reranked` is true, label the ordering “AI-assisted order”; score and deterministic factors still mean the same thing. Show returned warnings when reranking falls back.
- Detail explanation leads with `score`, `fitScore`, known `coverage` and a facts-checked count, then groups the seven factors into **What helped** (MATCH), **Partly matched** (PARTIAL) and **Gaps** (MISMATCH). Each factor shows a colour-coded state badge, its `reason`, evidence chips and fixed importance. UNKNOWN factors collapse behind “Not enough information” so the panel does not become a wall of text; expand it to see their reasons. Do not render raw BM25 or empty evidence strings in the primary reading path.
- No description: show “No job description was saved. Keyword matching is unavailable…” as a warning. Unknown salary/authorization remains visible; same-currency salary comparisons are the ranking authority. Display-only FX estimates elsewhere do not alter fit.
- Disclose `excluded` entries in “Outside this shortlist” with `below-threshold` / `outside-top-k` reasons and a link to all Jobs. Ranking never deletes a saved job. Local search filters only the current result and says so; it does not imply a fresh global search.
- A null snapshot shows “Rank your saved jobs” and explains required profile inputs. No saved jobs: “Find opportunities” / “Track a job”. Empty after cutoff: “No roles meet these settings” with adjust controls and all Jobs still reachable.
- `snapshotId: null` after POST: render the result with “Ranking shown for this session; it could not be saved.” Do not claim persistence or discard the last saved result on reload.
- Only latest-snapshot metadata is available. Do not design score-trend sparklines, historical comparison or a snapshot selector.

Discover remains the existing source-based search experience with query derivation, watchlists, per-source outcomes, qualification bands, dedupe, board search links and clip/save actions. “Update ranking” ranks saved jobs; “Find opportunities” goes to Discover. Neither implies an always-on background job hunt.

## 6. Manual / Agent-Assisted mode

Use the existing `SegmentedControl` at its 44 px control size, labelled **Preparation mode for new runs**, with “Manual” and “Agent-assisted”. Default Manual for a new device. An optional non-sensitive device preference may use `rolespec-workflow-mode`; it is a frontend preference, not a server setting. Explain: “This changes how your next preparation starts. Existing runs keep their mode.”

| Situation | Behavior |
| --- | --- |
| No run for selected application | Manual presents existing preparation tools and optional “Start manual checklist”; assisted presents “Prepare with assistance”. Both open a concrete creation summary before POST. |
| Existing active run | Show its actual mode/state and “View preparation”. Changing the preference leaves that run untouched. |
| User wants to take over | “Continue manually” opens existing forms/editor. Offer Pause when legal if the run is active; explain uncommitted step output will be discarded. Do not label this a mode mutation. |
| User wants a different run mode | Explain a new attempt is required. For an active run, explicitly confirm cancel before creating another; never cancel merely because a segment was selected. Completed work and artifacts remain. |
| Assisted created but not started | Run state is `MANUAL`, mode is `AGENT_ASSISTED`; display “Ready to start assistance”. If START fails, preserve the created run and offer Start again. |
| No provider or a provider fails | Manual flow stays available. Explain provider-dependent tailoring before start; offer AI settings and manual preparation. Do not claim the whole assisted pipeline can complete without AI. |

Run creation summary contains job/company, application status, source resume title/id, target role, selected mode, eleven-step overview and “You will review preparation; you submit on the employer site.” Submit only allowed fields from §16. Use one stable idempotency key per create intent; retain it across uncertain network retries. A deliberate new attempt gets a new key.

Manual checklist is optional and explicitly user-reported. `COMPLETE_STEP` records completion; it does not run research, validate a resume, generate a PDF or stage/submit an application. Link each item to its actual manual tool. The user saves their artifact first, then chooses “Mark step done”. Do not make these eleven items prerequisites for ordinary manual tracking, or require a cover letter where the user does not need one.

## 7. Job detail: decide, prepare, track

Keep `/jobs/:applicationId` as the canonical full page and reuse `JobDetailDrawer` for quick view. A leaderboard selection may open that drawer, with “Open full details”. Avoid separate full-detail implementations for Dashboard, Jobs and Runs.

### Page anatomy

Header: company and role, source/provider and captured/posted date, location/work mode/salary, existing application status, source link. Show the next action and one primary preparation control. Existing edit/delete actions remain secondary. Preserve `JobDetailSectionNav` with **Decide / Prepare / Track / Posting**; research lives within Decide at `#research`, not a competing navigation rail.

**Decide** presents:

1. Qualification verdict and exact known blockers/unknowns from the existing qualification card.
2. Ranking explanation when this posting is in the latest snapshot, clearly dated. Do not substitute `matchScore`, ATS quality or opportunity confidence for ranking score.
3. Existing resume-specific matching and `IntelligentMatchingCard`, with the resume used and checked-at time.
4. Research in three labelled sections: Requirements (required/preferred/flags/uncertainty); Company (supported facts, confidence, sources); Culture (signals, state, conflicts). Show returned researched-at, cached flag and source summary. `VERIFIED` means independently sourced according to the backend, not independently audited by RoleSpec staff. Posting-only claims say “Stated in posting”. Unknown signals say “Not established”, never “Poor culture”.

Source evidence appears inline as a short quote and source link where available; longer citation detail expands. Link only safe HTTP(S) URLs and treat all text as text. Missing citations do not acquire a synthetic source icon. An unresearched role has “Research company”; no-provider/restricted access offers posting review and editable notes without fabricating company facts.

**Prepare** groups the existing resume picker, tailor action, cover letters, email drafts, interview questions and job tasks. Add one preparation panel for the active/latest workflow. It links to the full run timeline and review checkpoint. Show “Application resume: …” separately from “New tailored draft: … (not selected)” and any staged-attempt resume. Explicit “Use this resume” uses `selectJobApplicationResume`; opening preview or approving a checkpoint never selects it.

Resume preview opens the existing responsive preview/editor surface. A stored PDF opens inline only if one exists; otherwise offer Generate PDF. A visual HTML preview is labelled as a preview, not proof of the exported page count. “Open employer application” is a normal external link; there is no web “Scan” or “Fill” control. Explain how to open the browser extension on the employer page, or download and attach manually.

**Track** shows the existing status history, dates, outcome, follow-up actions and application tasks, plus durable submission attempts and follow-ups (§11). Keep the manually editable status selector. A successful preparation must not turn that selector to APPLIED.

**Posting** preserves complete original posting text, source/provenance, dates, risk and requirement details. Long text uses readable measure with optional collapse; full content remains available and searchable. A stale listing is a freshness signal, not proof of fraud.

When a workflow exists, replace the overlapping eight-stage `JobPipelineStepper` presentation with a compact link/summary of the real eleven-step run. When no run exists, retain the manual evidence-based guide but label it “Your preparation checklist”; do not present inferred manual milestones as agent execution or percentages.

## 8. Live workflow and control behavior

### Runs and timeline layout

Runs view: rows for application/role, fixed run mode, current state, current running/waiting step, updated time and “Open run”. Query supported state/kind/limit; there is no cursor pagination. Label bounded results “Latest 50 runs” rather than “All runs”. Historical/terminal filters remain accessible; do not offer independent Research/Tailor run creation because the API accepts only `APPLICATION`.

Run detail top band contains job link, “Agent-assisted preparation” or “Manual checklist”, state, last persisted update and controls. Main column is an ordered list of all eleven steps; selected step opens a supporting evidence panel. On mobile the selected step expands inline. Event history is an accessible chronological disclosure below the work, not a terminal-like stream of invented agent reasoning.

| Backend step | Visible label | Persisted output to expose |
| --- | --- | --- |
| `PROFILE` | Check candidate profile | Readiness counts, missing fact checkpoint |
| `DISCOVER` | Prepare search links · optional | Derived queries/links, or exact skip reason |
| `RANK` | Rank opportunity | Returned score/factors/explanation where present |
| `RESEARCH` | Research role and company | Requirements/company/culture results, uncertainty |
| `TAILOR` | Draft tailored resume | Draft link, source, real attempts, needs-review metadata |
| `VALIDATE` | Check resume evidence | Validation status, issues, refs and coverage |
| `PREPARE_ATS` | Prepare application facts | Known facts, missing fields, sensitive questions; “Employer form has not been scanned” |
| `HUMAN_REVIEW` | Review preparation | Exact checkpoint and staged-evidence preview |
| `SUBMISSION_STAGING` | Stage application | Attempt id and “Nothing submitted” |
| `TRACKING` | Check tracker | Actual application status and next action; read-only step |
| `FOLLOW_UP` | Check follow-up timing · optional | Advice vs scheduled task ids/dates; `sent: false` |

Every step shows status, required/optional, attempts/maxAttempts, started/finished timestamps, lastError and available persisted summary/fallback. Expand only returned fields; step output is JSON, so use a guarded renderer for known shapes. Missing/legacy fields show “Not recorded”, not invented zeroes. Preserve unknown future step names verbatim with a neutral renderer.

Use a sentence such as “4 required steps completed; resume check running; 1 optional step skipped.” Counts derive from actual step statuses and required flags. No synthetic percentage, estimated finish time, typing agent, fabricated substage or moving progress along a timer. Pending means “Waiting to run”; retry timing is not in `WorkflowStepDTO`, so there is no client-created retry countdown.

### Legal controls

All mutations use `/api/workflows/:id/advance`; enable from the last returned state/mode. Busy disables duplicate submission only for that action. A 202 means accepted, not that a step completed.

| Actual state / mode | Primary control | Secondary controls | Guard / message |
| --- | --- | --- | --- |
| `MANUAL` + `AGENT_ASSISTED` | Start assistance (`START`) | Cancel | Starts this existing run, not another create |
| `MANUAL` + `MANUAL` | Open next manual tool / Mark step done (`COMPLETE_STEP`, stepName) | Start checklist (`START`) if not started, Cancel | No worker; save artifact separately |
| `ASSISTED` | Pause (`PAUSE`) | Cancel, open artifacts | Pause discards the current uncommitted output; saved work remains |
| `AWAITING_REVIEW` | Review question | Pause, Cancel | Resolve/dismiss via review endpoint; no Resume button here |
| `PAUSED` + assisted | Resume (`RESUME`) | Cancel, manual tools | May return to review if questions remain |
| `FAILED` + assisted | Retry (`RETRY`) | Cancel, manual fallback | Resets failed steps only; never call Resume |
| `COMPLETED` | View staged application / saved artifact | New attempt | Terminal record; new run id and intent |
| `CANCELLED` | View history | New attempt | No resume/retry on cancelled run |

Do not expose generic Skip step, Retry this successful step, drag-to-reorder, edit run inputs, switch run mode, force complete, auto-approve or send controls. Cancel uses `ConfirmDialog`: identify the role, say the attempt will stop and open tasks expire, and state that saved artifacts remain. After cancel succeeds, render its returned state; the UI cannot reverse it.

### Live transport and recovery

1. Load GET run and bounded GET events; open one cookie-authenticated EventSource for the selected assisted run. `progress` replaces the local DTO; `ping` changes connection health only. Fetch event history on meaningful persisted changes, coalesced rather than every keepalive. Dedupe history by event id.
2. The stream is not an incremental token log and has no replay cursor. On error/disconnect or its roughly six-minute closure, show “Connection interrupted — last update …”, reload GET, then reconnect if the state still needs monitoring. Preserve last known data and mark it stale. Never mark a run FAILED merely because SSE disconnected.
3. Use bounded reconnect backoff (1, 2, 5, 10, up to 30 seconds); pause automatic reconnect after repeated failure and offer Reconnect. Stop when offline/hidden; on visible/online, reload before reopening. A selected paused/manual/terminal run can use explicit refresh instead of an endless stream.
4. Close streams on route change, lock or terminal completion. Do not open one stream per row. Refresh review tasks only on review-state changes, user actions or explicit refresh; honor shared rate buckets.
5. On `409`, read the current run and explain “This preparation changed elsewhere.” Keep unsaved answer text in memory until the user closes it. On unknown POST outcome, reload before retrying; replay create with the same idempotency key.
6. Desktop work runs only while the server process is running. Say “Reopen RoleSpec to continue checking progress”, not “Your agents keep working while the app is closed.” Lease recovery is backend behavior, not a UI promise of continuous execution.

## 9. Unified review and approved-answer memory

### Review destination

`/workspace/review` provides local sections **Questions / Profile proposals / Answer memory**. Questions is the default. This is one destination with provenance-aware resource types, not a new all-purpose review table or browser-local queue.

Questions list uses `GET /api/review-tasks` with status (default OPEN), kind and limit ≤50. Each row shows exact question, blocking reason, kind, application/run/preparation identifiers and created date. Resolve company/title from owned application data when available. If absent, label “Unlinked ATS preparation” or “Standalone question”; do not guess company from question text. Show “Latest 50 matching questions” at the cap; no invented total or next-page cursor. Refresh is explicit and after mutations, not continuous shared-bucket polling.

Desktop: list plus one selected decision panel when width permits; otherwise reuse `Drawer`. Mobile: full-width detail with Back to questions. Selection remains stable after another row resolves. After successful resolution, move focus to the next open item (or empty-state heading); do not throw the user to Dashboard.

Decision panel hierarchy: exact question → role/context → why blocked → source and scope → suggested value marked “Suggestion” → editable answer → supported fallback → explicit confirm/dismiss. Never precheck approval or submission. Do not render a JSON object as if it were an answer; workflow suggested metadata often contains counts and draft ids.

| Kind | Supported UI | Result / restriction |
| --- | --- | --- |
| `SENSITIVE_ANSWER` | Explicit user-entered answer; no generated suggestion | Resolve only after review; ATS scope choice below |
| `UNKNOWN_FIELD`, `UNSUPPORTED_FIELD` | Exact question, editable supported value or “Answer on employer page” fallback | An answer does not mean the field was filled; unsupported widgets remain manual |
| `MISSING_PROFILE_FACT` | Link to exact Career Profile section or resume picker, retain return link | Save the missing data first, then resolve checkpoint; do not assume saving resumes the run |
| `RESTRICTED_ACCESS` | Source/fallback, instructions to grant site access in extension or work manually | No bypass, remote browser or web permission-grant impersonation |
| `AMBIGUOUS_TAILORING` | Validation violations, draft link if present, source comparison | Resolve acknowledges another bounded attempt; editing alone does not certify/revalidate |
| `SUBMISSION_CONFIRMATION` | Evidence bundle, draft/validation links, blocked questions, explicit “Approve preparation” | `{ action: "RESOLVE", value: { approved: true } }` approves staging only |
| `ESSAY_ANSWER` | Manual answer editor; link/instructions for optional extension draft | Essay generation is bearer-only; never web autofill or instant “Accept and send” |
| `RESUME_ATTACHMENT` | Preview/download owned resume and explain extension Attach/manual file selection | Web review PATCH cannot `ATTACH_RESUME`; do not resolve with an arbitrary string and claim upload |
| `CONFLICTING_ANSWER` | Exact question and explicit replacement confirmation | Current saved values are not in task suggestions; use extension to inspect old value before replacement |

A review-linked ATS answer defaults to **This form only** (`APPLICATION`). Optional **Future forms with this same question** sends `GLOBAL`. Explain that scope name APPLICATION is implemented against the preparation id, not every application at the same employer. Ordinary workflow answers have no reuse control and never become `AtsAnswer` merely by resolving.

Important current behavior: web `answerFromReviewTask` passes `replace: true`. Therefore ATS resolve must include an explicit confirmation that the supplied value may replace an existing answer for that question/scope. For a conflicting-answer task whose old value cannot be inspected on web, direct the user to extension memory to compare it; do not invent a compare view from absent data. Existing HTTP error mapping is not uniform across ATS and workflow errors; on an unexpected web failure retain input, refetch task/preparation context and show the returned message without assuming it was definitely a 409.

Dismiss names its effect: “Dismiss and pause preparation” for a linked waiting workflow when applicable; “Leave unanswered” for ATS-only tasks. The latter can remain reviewable after dismissal. No “Approve all”, global automatic approval, claim verification by confidence threshold or batch submission approval.

### Profile proposals in the same destination

Use `GET /api/intake` (limit ≤50), then GET selected run to show its patches. Counts are for loaded runs, explicitly labelled; the API does not supply a global pending-patch count. Reuse `IntakePanel` presentation/operations rather than copy its engine into a second queue. The profile page remains another contextual entry to the same proposals.

Each patch displays kind, source, confidence labelled “Extraction confidence”, file/URL, locator and fetched-at where supplied. Apply uses POST, Correct uses PATCH, Reject uses DELETE on that patch path. A 200 `status: CONFLICT` is a conflict result, not success. Show existing/incoming values with `KEEP_EXISTING`, `ACCEPT_INCOMING` and evidence-only `KEEP_BOTH`. Warn when a confirmed evidence row cannot be overwritten; offer existing profile editing rather than automatic unlock. Rejecting an APPLIED patch is illegal; link to edit the profile instead.

### Answer memory: complete design, correct execution surface

The Answer memory section on web explains the capability and how to open the extension's existing Autofill/review panel. Show a static informational handoff, not a fake populated web table or a button claiming to launch an unsupported extension deep link. Link to existing `/settings/api` connection instructions and display: “Manage saved answers in the RoleSpec browser extension. Answers you approve here for an ATS question use the same memory.”

Within the **extension**, design the memory list from `GET /api/extension/ats/answers`: question text, masked-by-default value with explicit Reveal, category, scope, approval date, last used and use count. Filter/search only those loaded rows; label the 200-row cap. A preparation filter includes global plus that form's answers. Application-specific values take precedence; do not infer that a global row is always used.

Edit uses POST with questionText, value, appropriate preparationId and scope. A changed answer first receives the supported conflict response where applicable; after comparing both values, explicit “Replace saved answer” resends with `replace: true`. Revoke uses DELETE `{ id }`, confirmation naming the question, and refreshes list/preparation/review tasks. The row disappears from live memory; audit provenance remains, and a preparation-linked question can reopen. Do not offer revoked-history browsing; list returns live answers only.

Question values stay out of global notifications, URLs, analytics, logs and new localStorage. Reveal and editing happen only within the owner-authenticated extension context. A full editable web memory table is a named deferred capability: it needs an approved cookie-authenticated contract, which this specification neither invents nor requires changing.

## 10. Candidate profile, intake and provenance

Keep Career Profile's contact, direction/preferences, target roles, evidence, capabilities and linked evidence. Preserve `CareerSetupWizard`, quick actions, import cards and data transfer. Reduce duplicate import prominence by making the existing unified `IntakePanel` the primary import entry and grouping legacy import actions under clearly named alternatives; do not remove their supported manual flows.

Each evidence row shows title/organization/dates, source and **Candidate / Confirmed by you**. Confirmation is a user assertion, not employer verification. User-entered evidence is already confirmed by the existing create action. Intake-applied evidence stays CANDIDATE; editing it does not confirm it. Capabilities display confirmed state, self-assessment separately from evidence-backed links, and linked evidence depth/outcome/last-used when recorded.

“View source” expands a provenance detail: actual source enum/label; safe source URL or filename; locator; fetched/captured date; patch/run id; confidence when available; correction/applied linkage where available. `EvidenceRow` currently exposes only source and optional sourceUrl, not the whole intake envelope. Render detailed provenance from the matched `IntakePatchDTO` fetched for its run; do not fabricate filename, confidence or timestamp on a profile row that lacks them. For contact/skill/target-role provenance, match `appliedTargetType` and `appliedTargetId` from loaded patches. When the source run is outside bounded results or cannot be matched, say “Detailed import source unavailable” and retain the known row source.

Do not fetch/download raw resume text or transcripts for a source drawer: those are deliberately omitted from intake DTOs. No invented immutable per-field edit history or universal evidence graph is required. Legacy/manual facts may simply say “Entered by you” without a source URL.

### Intake behavior and limits

| Input | User experience and boundary |
| --- | --- |
| Resume | Stored resume or PDF/DOCX upload. Unified intake upload: 10 MB; existing resume-parser/editor import: 5 MB. Display the actual limit for the chosen path. |
| LinkedIn | User's own PDF export, ≤5 MB; explain Save to PDF. No Connect LinkedIn/OAuth/live URL import. |
| GitHub | Public profile URL and explicit per-run consent. No private-repo access or OAuth claim. |
| Public web | URL and explicit consent; restricted/private pages get manual fallback. |
| Chat | Preview extracted proposals through `/api/intake/chat`; save transcript into a real CHAT intake only after explicit continue. Preview proposals have no persisted ids. |
| Voice | Browser transcription if supported and consented, with editable/paste transcript fallback. Send transcript, not audio; no server audio-upload or background microphone claim. |

Show actual per-source progress where `IntakeSourceRun.progress` supplies it. Keep intake progress distinct from workflow's status-only timeline. A PARTIAL run retains successful sources and pending proposals. Cancel and Retry failed sources use existing routes; never offer Pause intake. On process death, explain Cancel → Retry recovery rather than claiming workflow leases recover intake. Stop reconnecting automatically for all terminal intake statuses including PARTIAL, even if the stream remains open until its duration cap.

Unreadable/image-only documents show a field error with text/OCR guidance and manual entry. No silent OCR claim. Apply/Reject is per proposal; a profile-source success does not mean all extracted facts were applied or confirmed.

## 11. Resume comparison, validation and PDF

Retain `/resumes`, master → role family → job-tailored lineage, archive behavior and the existing editor. Desktop editor splits at 1280 px, as its source deliberately requires; narrower screens use `ResumePreviewSheet`. Do not reduce it to a generic full-page AI chat or make master resumes depend on a posting.

Extend the existing comparison drawer into one inspector with **Changes / Validation / History**, sharing the editor's selected resume. Do not stack multiple modal drawers; switching inspector content closes the previous panel while preserving unsaved editor state.

**Changes:** comparison header names source and tailored resume plus captured source version and `comparedAgainst`. Side-by-side at ample width; Original / Draft stacked pairs on narrow screens. Rewritten, removed, added and unchanged have text labels as well as colors. Do not celebrate “added” as a benefit: manual edits can introduce unsupported material. Claim rows can reveal `claimId`, item ref, evidence refs and requirement ids when the validation report contains them. Show requirement mapping with SUPPORTED / PARTIAL / UNSUPPORTED and totals. A requirement match is not a claim that the candidate has an unsupported skill.

**Validation:** display `PASS`, `NEEDS_REVIEW` or `FAIL` with report timestamp, source hash (collapsed), issues by severity and affected claim/item link where resolvable. A missing/unresolvable ref is “Reference unavailable”, not a fabricated link. No report is “Not checked”. A validator PASS means it passed those checks at that revision/time; never label “Guaranteed accurate” or “ATS accepted”. ATS quality/parse analysis remains a separate inspector/action with its original meaning.

Because the public history report does not provide a reliable current-draft-version binding, do not claim freshness from sourceHash alone. After a local save/edit/rollback, mark any displayed prior report “Previous validation — document changed”. On fresh loads where binding is unavailable, label it “Last recorded validation” with its date, not “Current version passed”. Do not add a standalone Revalidate button: no such action is exposed. A new preparation attempt can validate again through the existing pipeline, subject to its normal gates; manual editing/export remains possible.

**History:** use `getResumeHistory`; label latest 50 edit events / up to 20 snapshots. Show version-before/after, kind, summary, time and tailoring attempts. Restore selects a real snapshot descriptor and calls `rollbackTailoredResume(resumeId, snapshotId)`. Confirmation says it replaces the current tailored sections with that captured source revision and increments the version. It does not offer arbitrary undo of any edit event; historical event payloads are not full revision snapshots. Older live-source fallback is explicitly labelled, including the risk that the source has changed.

Use existing autosave/version behavior. A `conflict: true` save displays “This resume changed elsewhere” and preserves local content; offer reload only after warning about unsaved edits. Do not automatically overwrite with the new version or promise unsupported auto-merge. Before Restore/Export/Use this resume, complete pending save or show the save error.

**PDF:** HTML preview remains editable context; stored generated PDF is authoritative for download. Reuse `exportResumePdf`, existing templates, customization and owned `/api/exports/...` links. Optional “Try one-page export” uses `{ singlePage: true }`. Show real `pageCount`, `singlePageSatisfied`, returned warning and layout-attempt information only after that export. If still two pages, say so and allow download/edit; never truncate or visually crop the PDF to imply one page. Existing exports can be stale/expired; preserve stale indication and regenerate after user action. PDF render failure keeps the editor and manual retry intact. Provide Open PDF / Download when an embedded viewer is unavailable; a PDF viewer is not the only accessible way to inspect resume text.

## 12. Staging, tracking and follow-up timelines

### Evidence before approval, confirmation after submission

Before workflow approval, render the **preparation evidence preview** from returned step outputs and checkpoint metadata. This may not yet have a SubmissionAttempt id. Include ranking provenance, research uncertainty, draft id/title, recorded validation, actual selected resume and planned resume, known-fact counts and sensitive questions. Acknowledge unavailable fields. Never claim an employer scan, filled count or file upload from workflow-prepared fact counts.

Approve preparation resolves the workflow review task. Later `SUBMISSION_STAGING` creates/returns the actual durable attempt. Read it from `/api/submission-attempts`, not a fabricated `/api/submissions` route. Keep attempts grouped by actual id and source (WORKFLOW / EXTENSION / MANUAL); workflow and extension attempts are not necessarily the same attempt and must not be collapsed solely by application id.

Attempt detail lives within job Track and can be selected with a frontend `?attempt=` parameter. Show status, source, role/company, source URL, resume id/link, actual evidence keys, creation/confirmation timestamp and redacted confirmation note. Evidence is compact JSON, not a screenshot or captured employer receipt; do not promise a browser replay or complete field-value audit.

| Attempt state | Actions |
| --- | --- |
| `STAGED` | Open employer page; “I submitted this application” or “Not submitted” |
| `NOT_SUBMITTED` | “I submitted it later” (positive confirmation); retained history |
| `SUBMITTED` | Read-only confirmation; link to edit tracker if record needs correction |
| `ABANDONED` | Read-only; no reopen or confirm |

Positive confirmation uses a clear confirmation step naming the role, employer and resume, with an unchecked assertion that the user submitted on the employer site. PATCH `{ submitted: true, note? }` only after that gesture. Negative PATCH uses `submitted: false`; do not send it when a drawer merely closes. There is no general web Abandon action on submission attempts; ABANDON belongs to the extension preparation API.

On success use returned `applicationStatus`, refetch status history, attempts and follow-ups. Only INTERESTED advances to APPLIED; later tracker stages remain unchanged. `409 TERMINAL` does not offer downgrade; explain that confirmation is retained and corrections belong to the tracker. Repeated positive confirmation must not produce a second success milestone in the UI. Existing manual Mark applied remains a separate valid path, not something the UI secretly replaces with a staged attempt.

### Tracking and reminders

Retain the existing `/jobs` status filters/sort/quick view, `/workspace` kanban and `/planner` agenda/tasks/notes/goals. Keep statuses exactly INTERESTED, APPLIED, SCREENING, INTERVIEW, OFFER, REJECTED, WITHDRAWN. Run state, submission-attempt state and application state use separate labels; never add “Agent working” as a kanban application status. Kanban movement must keep its existing user-driven status behavior and provide a menu/select alternative to drag-and-drop.

Job Track groups chronological lanes: **Application history** (append-only status events), **Preparation attempts**, **Follow-ups**. It does not merge all three into one ambiguous completed-step bar. Show date-only values with calendar-date helpers and instants in the user's timezone; do not parse `YYYY-MM-DD` through local timestamp conversion and shift the day.

Durable due queue uses `GET /api/follow-ups?status=PENDING&due=1`. Each item has role, channel, due date, reason and “Mark done” / “Dismiss”. DONE means user-reported, never message delivery. Terminal cancelled reminders are read-only. Show +5 business-day EMAIL / +12 business-day LINKEDIN scheduling as weekends-excluded, holidays not modeled. Do not offer a cadence editor, per-task reschedule, snooze or undo: those task APIs do not exist.

Preserve the legacy `followUpAt` schedule/clear control as **Custom tracker reminder**. Distinguish it from the durable email and LinkedIn tasks. If dates differ, show both with labels rather than overwriting or pretending clearing the custom date dismisses durable tasks. Prefer durable reminders for the due queue; avoid duplicate attention rows when a legacy date merely mirrors the same email task.

Workflow FOLLOW_UP output with `scheduled: false` is advice, not a reminder created. After user-confirmed application/APPLIED, reload the durable tasks instead of calculating fresh dates in the browser. Preserve existing copy-only drafting via follow-up/email actions; a Copy button does not mark a reminder done.

### Recruiter outreach

Add a local **Outreach** section within Planner, backed by sequences. List named plans/contact, status and next pending touch. Creation form asks name, startOn, inline contact (or a known contactId); no standalone contact-address-book CRUD is invented. Show preview of the returned day-0 EMAIL / +5 EMAIL / +12 LINKEDIN schedule. DRAFT offers Activate/Cancel; ACTIVE offers Cancel plus pending-touch Mark done/Skip; closed plans are read-only. Last pending touch resolution follows the returned sequence state.

Touches display “Manual action · no message sent by RoleSpec” (`sent: false`). Drafting remains the existing separate copy workflow with explicit user context; do not assume an application-specific draft generator accepts an outreach sequence id. No scheduler sliders, send test, deliverability status or automatic outreach activation. List is bounded by the API and labelled accordingly.

## 13. Command palette, onboarding, attention and settings

### Command palette

Extend the existing lazy-loaded `CommandPalette` and `QUICK_ACTIONS`, not a second omnibox. Ctrl/Command+K, Escape, arrow navigation, Enter selection and shortcut help retain their behavior. Preserve typing-field shortcut suppression and mobile button access.

Add destinations Review and Runs, and contextual navigation to active preparation, job resume and due follow-ups. Commands navigate to the page that performs the action: “Review preparation”, “Prepare a tracked job”, “Update ranking” (opens Dashboard controls). Do not execute destructive actions, approval, submit confirmation or AI-spending POSTs merely by selecting a palette search result. Recents contain navigation metadata only; never index answer values, transcripts or generated private content. Do not advertise server-wide fuzzy search: the current palette searches navigation/actions/recents.

### Onboarding and activation

Reuse existing four steps: **Welcome / AI setup (optional) / Profile / Ready** and current save/test/complete actions. Welcome explains the two preparation modes and manual submission boundary. AI setup reuses `AiSetupPanel` and `ConnectionResult`; distinguish advisory diagnostics from a successful live test. Skipping AI is a visible action, not a failure.

Profile captures the fields the existing onboarding action supports. Ready links into Career Profile guided setup/intake, resume import and Discover, with a short persisted readiness checklist. Do not add an account-creation step, forced source connection, billing or an “Activate agents” switch that starts work without a tracked application. The existing onboarding/profile wizard distinction remains explicit: completing onboarding does not imply confirmed career evidence or a ready resume.

Imports can be entered from Ready through the existing Career Profile intake. The user may apply/confirm evidence and return to Dashboard; never duplicate import orchestration inside a new onboarding engine. Resume upload does not silently overwrite the master. Preserve saved onboarding draft behavior without adding provider keys or new sensitive content to it.

### Attention and notifications

Reuse `AppToaster`/Sonner for immediate action feedback. Persistent actionable information comes from ReviewTask, run state, due FollowUpTask and existing dashboard attention data. The optional header Attention tray groups those sources and links to their canonical screens; it does not create a Notification model.

No new unread/read/snooze/push/email preferences or fabricated “all caught up” global badge. The existing stored `emailNotifications` preference has no send transport in this tree; preserve its stored value when saving other preferences, but do not present it as a working delivery switch for these workflows. If queries are capped, display “50 loaded” or “At least 50 questions” when the cap is reached, never an exact global total. Loading/offline is not zero. No sensitive question values in the tray; use role and “Needs your answer”. Announce a new blocking state once, without replaying a toast on every SSE update or mounting page. Failures remain visible inline even after a toast disappears.

### Settings

Keep existing tabs: Profile, Preferences, Appearance, API access, AI provider, Usage, Your data. Settings Profile is owner identity; Career Profile is candidate evidence. Do not merge them or create team/invitation/billing settings.

AI provider gains a **Stage overrides** section using `/api/settings/ai-stages`: PROFILE, DISCOVER, RANK, RESEARCH, TAILOR, ATS, OUTREACH. Rows show inherited/default vs explicit provider/model, configured state and masked `last4`. Edit uses provider/model/new key/clear key; “Use default” DELETEs the override. Distinguish clearing the stored key from deleting the override. Explain that changing provider clears that stage's previous provider key unless a new one is supplied. Keep raw keys in the input only; never prefill from masked text or show ciphertext. Do not claim a stage-specific connection test exists.

Appearance retains all themes and system mode. Motion follows OS reduced-motion automatically; an optional device-only “Reduce interface motion” may add to the OS preference, never override an OS request for less motion. No server setting is invented for this. API access preserves existing token creation/revocation and extension connection flow. Usage shows recorded usage, not promised model prices or unlimited work. Your data preserves owner export and existing reset/deletion confirmations; export contains personal intake/workflow/answer data and should be explicitly downloaded, never automatically shared.

## 14. Optional original agent room

This is an optional presentation enhancement after the complete 2D workflow. Default view remains Board/Runs. No Three.js or React Three Fiber dependency is installed, and [FEATURE_PARITY.md](FEATURE_PARITY.md) deliberately excluded a renderer-heavy room. This specification allows a small **CSS perspective view** of existing DOM stations; it does not authorize a new renderer dependency or a second agent system.

Concept: **the evidence studio**, five labelled workstations around one application folder: Profile (PROFILE), Search (DISCOVER/RANK), Research (RESEARCH), Documents (TAILOR/VALIDATE), Review & handoff (PREPARE_ATS/HUMAN_REVIEW/SUBMISSION_STAGING/TRACKING/FOLLOW_UP). These are grouped pipeline stages, not five separately running autonomous agents. The room names the selected application and run; users choose a real run from the same Runs list.

Each station is a semantic button with a label and actual step-state summary, rendered with modest perspective/flat surfaces. Selecting a station selects the same step/evidence panel used in 2D. A small completed-document marker appears only when an artifact exists. Unknown/no run shows an honest empty studio and link to prepare a tracked job. No wandering characters, chat bubbles, job “teleportation”, imaginary research, simulated ambient work or first-person game controls.

Accessibility/failure: “2D view” is always available and equally prominent; DOM order is pipeline order. CSS transforms do not alter focus order. Keyboard can select every station and reach the same inspector; accessible labels include run and state. Under `prefers-reduced-motion`, render flat 2D automatically with static state changes. At narrow widths, high zoom, unsupported transforms, forced-colors or performance trouble, use the normal 2D view. Switching views preserves selected run/step and does not mutate anything. No essential content is only in the room, and no separate Room-only action exists.

Motion budget: no idle animation loop. A user-selected station can receive one ≤180 ms outline/opacity transition; no automatic camera movement. Implementation can use existing CSS and Lucide icons with original simple geometry. Do not make photorealistic assets or copied Recruitt apartment imagery a prerequisite for understanding work.

## 15. Component hierarchy and frontend integration

Names marked **new** are proposed feature components, not mandatory abstractions. Keep feature logic in existing feature directories. Extract a shared component only when two real surfaces need the same behavior; do not add a parallel design system or client workflow engine.

```text
AppLayout (existing auth, TimezoneSync, skip link)
├─ Sidebar / MobileNav (same navigation config)
├─ Header → CommandPalette, owner menu, AttentionTray [new, optional]
└─ PageShell
   ├─ Dashboard
   │  ├─ existing next-action / getting-started information
   │  ├─ WorkflowModePreference [new]
   │  └─ OpportunityLeaderboard [new] → RankingExplanation [new]
   ├─ Job detail (existing sections and drawer)
   │  ├─ qualification / matching / research / confidence
   │  ├─ JobResumePanel, TailorResumeButton, existing preparation tools
   │  ├─ WorkflowSummary [new] → canonical RunDetail
   │  └─ SubmissionAttemptPanel / DurableFollowUps [new]
   ├─ Workspace: existing WorkspaceBoard | RunList [new] | optional Room
   ├─ RunDetail [new]
   │  ├─ RunControls, WorkflowTimeline [new]
   │  └─ StepEvidence [new], same ReviewDecisionPanel [new], event history
   ├─ ReviewWorkspace [new]
   │  ├─ Questions → ReviewDecisionPanel
   │  ├─ Profile proposals → existing IntakePanel operations
   │  └─ Answer memory → extension handoff information
   ├─ Career Profile → existing evidence/capability/intake/forms + provenance
   ├─ ResumeEditor → existing sections/preview + comparison/validation/history
   ├─ Planner → existing agenda/tasks/notes + OutreachPlans [new]
   └─ Settings → existing forms + StageOverrides [new]
```

### Concrete reuse and change boundaries

| Existing module | Frontend work it should own |
| --- | --- |
| `src/config/navigation.ts`, `src/shared/components/{sidebar,header,mobile-nav,command-palette,breadcrumbs}.tsx` | New destinations/titles, same active-link rules and shortcuts |
| `src/shared/ui/{button,badge,segmented-control,table,input,select,textarea,drawer,dialog,confirm-dialog,skeleton,pagination}.tsx` | Existing visual/keyboard vocabulary; use house overlay/focus behavior |
| `src/features/dashboard/components/{next-action,needs-attention,getting-started,jobs-overview}.tsx` | Compose daily priorities once; extend links instead of duplicate summary cards |
| `src/features/discovery/components/discovery-view.tsx` and existing discovery actions | Actual discovery/search/watchlist/save behaviors |
| `src/features/jobs/components/{job-detail-drawer,job-detail-section-nav,job-resume-panel,job-qualification-card,company-research-panel,job-email-panel,application-status-timeline}.tsx` | Canonical job details, existing actions, expanded research and tracking |
| `src/features/intake/components/intake-panel.tsx` | Intake inputs, run progress, patch review/apply/correct/reject |
| `src/features/career-profile/components/{evidence-card,capabilities-card,profile-section-nav}.tsx` | Candidate/confirmed truth, linked evidence and source disclosure |
| `src/features/resume/components/{resume-editor,resume-comparison-drawer,resume-preview,resume-preview-sheet,editor-header}.tsx` | Existing editor, responsive preview and one inspector hierarchy |
| `src/features/resume/actions/{history,rollback,save,tailor}.ts`, existing export action | Consume existing contracts; no mutation or validator changes |
| `src/features/workflows/types.ts`, `pipeline.ts`, `schemas/workflow.schema.ts` | Import DTOs/step vocabulary; server remains state authority |
| `src/features/ranking/types.ts`, `services/ranking-snapshot.service.ts` | Exact persisted ranking shape; no frontend scorer |
| `src/features/workspace/components/workspace-board.tsx` | Preserve kanban/layout/goals/quick-add functionality and saved arrangement |
| `src/features/settings/components`, onboarding provider components | Existing identity, preferences, credentials, appearance and connection testing |
| `extension/src/autofill-panel.ts`, `ats-api.ts`, `ats-adapters.ts` | ATS gesture flow, memory management, vendor support labels and manual fallbacks |

Route pages continue the existing authenticated server-page pattern. Client islands own selection, unsaved inputs, stream lifecycle and pending actions. Reuse installed React Query where it simplifies shared data, but do not introduce a second global persisted store. Existing Zustand resume/workspace stores retain their purpose; workflow DTOs must not overwrite dirty resume-editor state on refresh.

In-memory fetched owner data is scoped to this session and cleared on lock/unmount as appropriate. Never persist workflow inputs, review answers or source documents to a new shared/local storage cache. Invalidate affected run, review list, application detail/status history, attempt list, ranking display or due tasks after their actual mutations. Do not invalidate by recomputing ranking automatically.

Read composition in authenticated server pages may join existing owned records as current pages do, selecting only fields the view needs. It must not introduce new domain mutations, API routes, model fields or background services. Existing API caching/error differences remain real; the frontend must not assume every legacy endpoint shares the new envelope or `no-store` policy.

## 16. Backend contract mapping

Browser calls use owner cookie/same-origin mutations. Never send userId. Foreign/missing resources display a neutral not-found state. Extension calls keep bearer auth in the extension; a web page must never obtain or embed a token just to call a bearer-only endpoint. Use the exported types cited in the handoff, not duplicate enum unions in new components.

| UI intent | Existing contract | Input / returned state | Frontend refresh or limit |
| --- | --- | --- | --- |
| Read leaderboard | `GET /api/ranking` | `{ snapshot: RankingSnapshotView | null }` | Latest only; render `snapshot.result` |
| Update ranking | `POST /api/ranking` | Optional `jobIds`, `topK`, `minScore`, `lexicalWeight`, `rerank`; result + warnings + nullable snapshotId | 30 requests/10 min shared GET/POST; no auto-refresh ranking |
| Find/save/qualify | Existing `discovery.actions.ts`, `job-qualification.actions.ts`, job-create/clip flow | Existing posting and qualification contracts | Keep provider failures partial and qualification separate |
| Map posting to tracked application | Existing owned page queries; `/api/jobs` returns `applications` ids/status | Job id differs from application id | Use cursor only where actually supplied |
| Create run | `POST /api/workflows` | `{ jobApplicationId, mode, kind: "APPLICATION", idempotencyKey, input?: { resumeId?, targetRole? } }` → `{ workflow }` | 20 creates/10 min; same intent key on uncertain replay |
| Run list/detail | `GET /api/workflows`; `GET /api/workflows/:id` | `{ items }`; `{ workflow }` | List state/kind/limit 1–50, no cursor |
| Control run | `POST /api/workflows/:id/advance` | `{ action, stepName? }`, legal state table §8 | 120/10 min; 200/202 are not artifact completion |
| Run live/history | `GET /api/workflows/:id/stream`; `/events?limit=...` | `progress`, `ping`, `error`; `{ events }` | SSE ~750 ms persisted reads; events ≤200; no replay controls |
| Questions list | `GET /api/review-tasks?status=...&kind=...&limit=...` | `{ items: ReviewTaskDTO[] }` | ≤50; GET and mutations share 120/10 min |
| Resolve/dismiss | `PATCH /api/review-tasks/:id` | `{ action: "RESOLVE", value, scope? }` or `{ action: "DISMISS", reason? }` → `{ task, run, preparation }` | Scope only meaningful for ATS-linked answer; no ATTACH_RESUME here |
| Approve workflow preparation | Same review PATCH | `value: { approved: true }` | Staging approval, never submitted confirmation |
| Intake list/create/upload | `GET/POST /api/intake`; `POST /api/intake/upload` | Requests per source, optional stable key; upload file → `{ run }` | List ≤50; create/upload 10/10 min; path-specific file caps §10 |
| Intake preview/live/recovery | `/api/intake/chat`; `/:id`; `/:id/stream`; POST `/:id/cancel`, `/:id/retry` | Preview vs real DTO; failed/cancelled sources retry | Chat 40/10 min; no pause or crashed-run lease recovery |
| Apply/correct/reject proposal | POST/PATCH/DELETE `/api/intake/:id/patches/:patchId` | Disposition, correction, reason as documented | Check status inside successful 200; APPLIED is not CONFIRMED |
| Candidate truth | `career-profile.actions.ts`, `career-evidence.actions.ts`, `career-capability.actions.ts`, `loadCareerProfile` | Existing profile/evidence/capability contracts | Confirm imported rows separately; source detail from intake DTO |
| Research | Server action `runCompanyResearch(jobApplicationId)` | `{ success, research, layers }`; persisted in matchResult | Requirements/company/culture; no invented HTTP research route |
| Tailor | `createJobTailoredResume(formData)` | title/sourceResumeId/jobApplicationId; success redirects to editor with job context; error/validation otherwise | DRAFT only; failure may create no resume; no auto-selection |
| Compare/history/restore | `getTailoredResumeDiff`, `getResumeHistory`, `rollbackTailoredResume` | Snapshot/live-source labels; descriptors/reports; optional snapshotId | No arbitrary event undo or standalone revalidate action |
| Save draft | `saveResume(resumeId, sections, { baseVersion? })` | New version or conflict/currentVersion | Preserve local edits on conflict |
| Select application resume | `selectJobApplicationResume` | Existing owned application/resume action | Only explicit user choice changes selected resume |
| Preview/export PDF | Existing preview; `exportResumePdf(resumeId, { singlePage? })`; owned `/api/exports/...` | pdfUrl/template; optional pageCount/singlePageSatisfied/layoutAttempts/warning | Generate by gesture; expire/stale/failure fallback |
| Stage manually | `POST /api/submission-attempts` | `{ jobApplicationId, resumeId?, evidence? }` → `{ attempt }` | Idempotent per manual application; 60 writes/10 min |
| Read/confirm attempts | GET list/detail; PATCH `/api/submission-attempts/:id` | `{ submitted: boolean, note? }` → `{ attempt, applicationStatus, submitted }` | List ≤50; submitted confirmation is one-way; no web ABANDON |
| Track statuses/history | Existing job application actions and `getApplicationStatusHistory`; `/api/applications/:id` | Existing application/status-event contracts | Keep user-driven APPLIED path and all seven statuses |
| Durable follow-ups | GET `/api/follow-ups`; PATCH `/api/follow-ups/:id` | status/jobApplicationId/due/limit; `{ action: "DONE" | "DISMISS" }` | ≤100; shared read/write 120/10 min; no reschedule route |
| Custom tracker reminder | POST/DELETE `/api/applications/:id/followup`; existing actions | Existing date/clear behavior | Does not dismiss durable channel tasks |
| Outreach plans | GET/POST `/api/outreach/sequences`; GET/PATCH `/:id`; PATCH `/api/outreach/touches/:id` | Inline contact/contactId, startOn, name, key; ACTIVATE/CANCEL; DONE/SKIPPED | List ≤100; shared 60/10 min; `sent: false` |
| Stage provider settings | GET/PUT/DELETE `/api/settings/ai-stages` | stage/provider/model?/apiKey?/clearApiKey?; masked result | PUT 30/10 min; no secret-return or stage test endpoint |
| ATS scan/prepare/fill | Extension's existing panel and `/api/extension/ats/preparations` | Server FILL/REVIEW/ATTACH_RESUME plan, live results | Bearer-only; no cookie web scanner; vendor limitations retained |
| Answer memory | Extension GET/POST/DELETE `/api/extension/ats/answers` | Scope/preparation/question/value/replace; `{ id }` revoke | Bearer-only, live rows ≤200; 80/10 min |
| Attach resume | Extension review PATCH ATTACH_RESUME or preparation PATCH; extension PDF GET | resumeId → owned rendered PDF | User gesture, live upload unverified, manual download fallback |
| Essay draft | Extension POST `/api/extension/essay-draft` | question/context/maxWords/instructions → draft, grounding, unsupportedNumbers | 10/10 min; reviewRequired true, autoFill false; manual paste |
| Onboarding/default AI | Existing onboarding and AI-setup server actions | Supported draft/complete/configure/test contracts | No account signup or new activation backend |
| LinkedIn tools | Existing `/api/linkedin/assist`, `/api/linkedin/rating`, profile import | User's own bounded PDF export; optional owned resume | No login/OAuth/profile-URL access or posting |
| Attention/activity | Existing dashboard stats/attention; GET `/api/activity`, loaded runs/tasks/follow-ups | Persisted events and derived action groups | No notification-read model; no polling every second |
| Owner data | GET `/api/account/export`, existing settings data/reset actions | Personal owner export, existing confirmed reset | Never use export as an answer-memory read API |

### Explicit capability gaps and excluded controls

Do not create controls for in-place run mode/input edits, isolated run kinds, arbitrary successful-step retry, workflow skip/reorder, universal automatic revalidation, historical ranking browsing, web answer-memory CRUD, web ATS attachment/fill, automatic send/submit, custom durable reminder cadence/reschedule, persistent notification read state, universal provenance histories, arbitrary resume-event restore or a cloud agent running after desktop closes. Their absence is a contract boundary, not a reason to fake a disabled dashboard full of future switches.

## 17. Interaction, motion and accessibility requirements

Every control has default, hover, focus-visible, pressed/selected, pending, disabled-with-reason and error behavior. Async actions keep their label context (“Pausing…”, “Saving answer…”), prevent double activation and preserve stable layout. Never optimistically show approval, submission confirmation, destructive cancellation or validation PASS before the server returns. Inline field errors connect through `aria-describedby`; move focus to the first invalid input on submit.

Reuse house Drawer/Dialog focus trapping, Escape handling, body-scroll lock and focus restoration. One decision overlay at a time; confirm dialogs name the concrete role/document/question. Close must not silently resolve, dismiss or negatively confirm. Warn before discarding dirty text. A disabled legal-transition control has an adjacent explanation or focusable help; it is not tooltip-only inaccessible information.

Semantic tables use captions/column headers; list alternatives preserve labels on mobile. Row details expand via buttons with `aria-expanded`. Step timeline is an ordered list with textual status/current-step marking; it is not an inaccessible animated Progress component. Segmented mode buttons use the existing group's `aria-pressed` behavior; do not add tab semantics without implementing the matching keyboard model. Source links have meaningful labels and external-link indication. Icons alone never communicate safety/state.

Target WCAG 2.2 AA: normal text ≥4.5:1, large text ≥3:1, active control/focus indicators ≥3:1 against adjacent colors. Existing subtle dividers are not enough as sole interactive boundaries. Check all accent themes and both color modes; theme-aware status colors take precedence over hardcoded greens/yellows. Keep actionable targets ≥44×44 px on touch; dense desktop buttons may look smaller while retaining adequate hit area. Tooltips must work on focus and have equivalent inline text for essential information.

Keyboard-only users can perform the manual loop, create/control a run, review a question, inspect/restore a resume and confirm submission. Dragging has menu alternatives. At 200% zoom and 320 CSS px width, primary actions and errors remain reachable. No hover-only evidence; text wraps, long questions/URLs do not escape containers, and title truncation has a full-text path.

Use one polite live region for meaningful persisted transitions and success; errors use appropriate alert semantics. Do not announce timestamps/keepalives or every unchanged step on SSE refresh. Keep focus where the user is working when background state changes. If a task resolves elsewhere, preserve text and explain the conflict before changing selection.

Motion communicates a change only. Use 120–180 ms color/opacity transitions, drawer movement ≤220 ms with gentle easing and no overshoot, optional one-time selected-row emphasis ≤150 ms. No staggered page loads, bouncy controls, pulsing agent lights, looping score reveals, automatic scroll to each new event or perpetually shimmering rows. Skeletons reserve space without implying work duration. With OS reduced-motion (or stronger device preference), remove transform/smooth-scroll/shimmer/camera motion and show content immediately; status text and focus remain fully functional.

## 18. Empty, failure and concurrency states

| Situation | Required response |
| --- | --- |
| First load | Region-specific static skeleton and accessible loading status; never fake rows or scores |
| No jobs / no snapshot | Existing find/track entry points; explicit Rank saved jobs after jobs exist |
| No reviews | “No open questions in this view”; retain filters and profile proposals; avoid claiming no outstanding work outside loaded scope |
| No resume / target role | Specific picker/profile link; manual path; never silently select a different source |
| No usable AI config | Existing AI guidance + manual tools; explain the action requiring a provider |
| Source/provider partially fails | Keep good results, exact warnings and manual fallback; no all-or-nothing empty dashboard |
| `400` / validation | Show returned field/general error beside the form; preserve inputs |
| `401` / workspace locks | Stop streams and clear sensitive fetched view state; use existing unlock return flow without answer text in URLs |
| `403` mutation origin | Explain request refused and offer reload; do not retry with another auth method |
| `404` | Resource unavailable/not found, link back; no cross-owner existence inference |
| `409` state/version conflict | Refetch relevant resource, preserve dirty input, explain current state; no force overwrite |
| `422` unusable artifact | Explain missing/export problem and offer existing export/editor path |
| `429` | Stop repeated reads/reconnects, keep last data, show wait/retry guidance; no countdown unless a real retry deadline is supplied |
| Server/network error | Inline error + manual retry; retain last good data marked stale; no offline mutation queue |
| PDF expired/render fails | Keep text preview/editor, offer regenerate and download when valid |
| Run stalled after restart | Reload actual run; show last update and Reconnect/manual path, never fabricate failure/progress |
| Two tabs resolve same question | Refresh returned task/run; no duplicate success or silent answer overwrite |
| Unrecognized JSON/status | Neutral “Details unavailable” with ids and manual navigation; no blank crash or guessed successful state |

## 19. Implementation order and acceptance gates

This deliverable changes documentation only. The following are requirements for the later frontend implementation, not claims of tests run or screens delivered here. No backend logic/schema changes or dependencies are required for the core design.

1. **Shell and read surfaces:** add Review/Runs frontend routes and navigation, leaderboard read/join, canonical job context and read-only run timeline. Preserve all manual links, board state and editor behaviors.
2. **Run controls and review:** create/start/control with legal transitions, SSE lifecycle/reconnect, shared decision panel and intake-proposal entry. Submission checkpoint wording must be correct before mutations are enabled.
3. **Evidence and artifacts:** layered research, detailed provenance where returned, comparison/validation/history inspector, explicit resume selection and real PDF behavior.
4. **Stage and follow up:** durable attempt evidence/confirmation, due tasks, custom-reminder distinction, outreach section, AI-stage settings and contextual palette/attention integration.
5. **Optional room:** only after the same tasks pass in 2D; no additional workflow capabilities.

Read the installed Next.js guides in `node_modules/next/dist/docs/` relevant to routes, server/client boundaries and data mutations before implementation, as required by AGENTS.md. Follow repository checks/GATES.md for actual code changes. Historical rollout/feature-flag instructions do not justify inventing a new backend flag service in this documentation task; defer production exposure of unfinished routes until their acceptance checks pass.

### Journey acceptance matrix

| Check | Observable pass condition |
| --- | --- |
| Manual, no AI | Profile → resume import/edit/export → discover/paste → qualify/notes → manual application → tracker → follow-up/outcome works without creating a run or configuring AI |
| New-run modes | Preference changes only future creates; active mode remains fixed; existing run is reused on conflict; no duplicate create after uncertain response |
| Ranking truth | Latest saved result survives reload, unknown/null data stays unknown, score/order/coverage meanings are distinct, excluded jobs stay accessible, posting/application ids link correctly |
| Assisted success | Persisted eleven steps reach checkpoint, evidence inspected, approval stages only, completed preparation leaves application INTERESTED until actual explicit user update |
| Pause/retry/reconnect | Pause shows returned state, no uncommitted artifact presented; Resume only from PAUSED, Retry from FAILED; reconnect reloads; no fake progress or duplicated events |
| Review | Workflow/ATS/intake contexts use their actual contracts; scope/replacement is explicit; no generated sensitive answers, fake uploads or unintended resume selection |
| Answer memory | Extension list/edit/conflict/replace/revoke works; revoked answer is omitted on next plan; web exposes only supported resolve/handoff behavior |
| Candidate evidence | Imported fact remains candidate until confirm; sources/corrections are visible where recorded; no guessed provenance or raw-source leak |
| Resume integrity | Diff uses captured snapshot, legacy fallback labelled, report freshness honest after edits, version conflict preserves draft, restore targets actual snapshot, one-page overflow warning matches exported PDF |
| Submission | Approve preparation never confirms submission; positive confirmation records actual attempt, status/history/reminders refresh once; terminal downgrade refused; manual Mark applied still works |
| Follow-up/outreach | Calendar dates stable across timezone boundaries; durable vs custom reminders distinct; DONE/SKIPPED are user reports; nothing is sent |
| Responsive/accessibility | Verify at 320, 390, 768, 1024, 1280 and 1440 px, 200% zoom, keyboard-only, light/dark, alternate accents and reduced motion; no clipped controls, duplicate nav or focus loss |
| Optional room | Same run/step selection and full task access in 2D; no invented independent agents, idle animation or renderer dependency |

Use focused component/route-integration tests for legal controls, stale/empty/error mapping, ranking id resolution, review scope/replacement consent, resume-validation freshness and explicit submission confirmation. Reuse existing service/route fixtures for realistic DTOs; include long questions, missing sources, null lexical score, partial intake, stale PDFs and concurrent changes. Browser verification must exercise the real rendered flows; unit tests do not prove live employer fill/attachment. Do not perform a real employer submission merely to validate UI.

### Evidence limits at handoff

This specification is grounded in source, contracts and the written reference, with an incumbent screenshot inspection. It is not a live walkthrough or accessibility certification of a built design. Existing verification records distinguish real provider-backed preparation from unverified live ATS fill/attachment and clean-machine desktop installation. Preserve those limits in product support copy; do not promote fixture-tested support to “verified live automation”.
