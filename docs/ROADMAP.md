# Roadmap

Last updated: 2026-10-03 (after it. 53)

Status legend: **DONE** (verified in code + CI) · **PARTIAL** (exists, named gap) · **OPEN** (not started) · **DECISION** (user must decide before work starts).

## Goal

Make RoleSpec fully usable for one real personal job search before optimizing for beta users, public launch, billing, or scale. It should feel like one career workspace, not a set of AI tools or disconnected pages.

`Career Profile → Discover → Qualify → Prepare → Apply → Track → Follow up → Outcome → Learn`

Execution rules:

- Optimize for real personal use first; current code, schema and tests are the source of truth.
- A deeper refactor is allowed only when the current structure blocks the core workflow; preserve security and correctness invariants (owned by `docs/ARCHITECTURE.md`).
- Prefer one coherent workflow over isolated features; do not add features because a competitor has them.
- Structural UX before visual polish; verify meaningful UI changes in the real browser (Playwright); use Impeccable only after behavior and hierarchy are correct.
- Each iteration: inspect → smallest coherent change → targeted tests → browser check → update `handoff.md`.

## Scope guards

**In scope** (each traces to the Definition of Done):

- Close the remaining Enhance/re-check gaps so resume work meets the "apply or reject individual changes, and re-check the result" clause.
- Keep the Master Resume job-free; Role Family and Job-Tailored resumes derive from it; tailoring stays optional.
- Never treat job-description text as user evidence; generated claims stay grounded in Career Profile evidence.
- Discovery that surfaces relevant jobs with both profile match and opportunity confidence visible and kept separate.
- Prepare → apply → track → follow up → outcome without unnecessary page hopping or repeated data entry.
- Removing known P0/P1 workflow blockers found by browser verification.

**Out of scope / will not build:**

- autonomous spray-and-pray auto-apply
- generic AI chat
- huge template libraries
- social/leaderboards without outcome value
- enterprise work
- cosmetic feature expansion unrelated to the core workflow
- No new source adapters beyond the named PH candidates until the existing ones are live-verified.
- No new screens or features added to fill space.
- No redesign of surfaces already browser-verified unless a listed gap requires it.
- No work on items not in the Iteration queue without first adding them to Parking lot and promoting them.
- Never bypass CAPTCHAs, authentication, paywalls or anti-bot controls (`docs/ARCHITECTURE.md` "Public-web access policy"); never auto-submit applications.

### How to add work

An item enters the Iteration queue only with (a) a one-sentence done-when, (b) the Definition of Done clause it serves, and (c) a phase. Otherwise it goes to Parking lot.

## Status by area

| Area | Status | Evidence | Gap |
|---|---|---|---|
| Career Profile | DONE | `src/app/(app)/career-profile/page.tsx` | |
| Master / Role Family / Tailored resumes | DONE | `prisma/schema.prisma` | |
| Resume Quality | DONE | `src/features/resume/actions/analyze-ats.ts` | |
| Job Match | DONE | `src/features/resume/actions/analyze-ats.ts` | |
| Enhance loop | PARTIAL | `src/features/resume/components/enhance-drawer.tsx` | internal refs in reasons |
| Tailor | DONE | `src/features/resume/actions/tailor.ts` | |
| ATS staleness | DONE | `src/features/resume/lib/ats-staleness.ts` | |
| Discovery sources | PARTIAL | `src/features/discovery/constants/providers.ts` | per-source live verification not recorded |
| Dedupe / normalize | DONE | `src/features/discovery/services/normalize.service.ts` | |
| Opportunity confidence | PARTIAL | `src/features/discovery/services/opportunity-confidence.service.ts` | no listing-status or corroboration signal |
| Profile match display | DONE | `src/features/jobs/components/job-match-panel.tsx` | |
| Career-page discovery | PARTIAL | `src/features/discovery/services/careers-listing.service.ts` | watchlist is ATS slugs only |
| Dashboard next action | DONE | `src/app/(app)/dashboard/page.tsx` | |
| Application tracking | DONE | `src/app/(app)/workspace/page.tsx` | |
| Follow-up / outcome | DONE | `src/app/(app)/jobs/[id]/page.tsx` | |
| Job Detail ↔ Workspace | DONE | `src/app/(app)/workspace/page.tsx` | two linked pages by ruling (it. 37) |
| Extension | PARTIAL | `extension/public/manifest.json` | shipped `activeTab` path not live-verified |

## Phases

### Phase A — Close the personal workflow (current)

Purpose: finish the resume improvement loop and confirm the full personal journey works end to end.

Exit criteria:

- [x] Enhance suggestions survive a page reload (Revert still available), browser-verified.
- [ ] No Enhance reason text shows internal references such as "b0", unit-tested and checked on one live run.
- [ ] Applying a single suggestion and re-checking shows a score delta, browser-verified.
- [ ] A whole-resume Enhance run on a resume with a non-Experience issue returns at least one non-Experience suggestion, live-observed.
- [ ] One end-to-end walkthrough of the Definition of Done journey is browser-verified and recorded in `handoff.md` with no open P0/P1 blocker.

Items:

- **A1** Enhance suggestions and their originals persist across a reload. Done when: run Enhance, apply one, reload; the list and Revert for the applied row are still there.
- **A2** Enhance reasons never expose internal section/bullet refs. Done when: a unit test covers ref stripping and a live run shows none.
- **A3** Apply-one → re-check produces a visible score delta. Done when: browser-observed delta after one apply plus re-analyze (delta rules per it. 49 ruling unchanged).
- **A4** Whole-resume Enhance reaches non-Experience sections under the suggestion cap. Done when: a unit test proves non-Experience targets reach the request and one live run returns a non-Experience suggestion.
- **A5** End-to-end personal journey walkthrough. Done when: Career Profile → Discover → Job Detail → resume choice → apply → follow-up → outcome is browser-verified once and any P0/P1 found is queued or fixed.

Not in this phase: new discovery sources, confidence signals, Career Profile layout work, visual polish.

### Phase B — Opportunity quality + PH discovery

Purpose: make discovered jobs relevant to the user's PH market and trustworthy enough to act on. Starts only when Phase A exit criteria are all checked.

Exit criteria:

- [ ] Each existing provider has a recorded live-verification result (works / restricted / dead) in `handoff.md`.
- [ ] A discovery run for the user's target roles returns PH-relevant postings from at least one PH source, live-observed.
- [ ] Opportunity confidence includes at least one signal beyond provenance/freshness/employer/completeness, unit-tested.
- [ ] Every DECISION row below has a recorded user decision.

Items (in priority order):

- **B1** PH-first source coverage. Live-verify Kalibrr, OnlineJobs.ph and the PH ATS watchlist defaults (`src/config/discovery.ts`) for the user's target roles. Done when: results recorded per source.
- **B2** Opportunity confidence signals (direct application path, listing status, corroboration). Done when: added signals are unit-tested and shown alongside, not merged into, profile match.
- **B3** Direct company career-page discovery from target companies beyond ATS slugs. Done when: a user-named company page yields postings, live-observed.
- **B4** Search-engine/public discovery where permitted and credentials exist. Done when: one permitted path is live-verified, or it is recorded as blocked.
- **B5** Broader public ATS coverage. Done when: only after B1 results; each added ATS is live-verified.
- **B6** Robust extraction/fallbacks, including extension capture. Done when: the shipped `activeTab` extension path is live-verified on one posting.
- **B7** Provenance, observability and provider isolation. Done when: a failing provider is visible per run and does not block the others, observed.
- **B-D1 DECISION** JobStreet PH. Handoff records its API as robots-disallowed. Needs an access-policy check against `docs/ARCHITECTURE.md` "Public-web access policy" before any work.
- **B-D2 DECISION** Jooble PH. Needs a key. Needs the same access-policy check before any work.
- **B-D3 DECISION** Careerjet. Needs a key. Needs the same access-policy check before any work.

`Ry0x7/ai-job-scraper` is a reference pattern only, not a dependency. Do not copy or run it.

Not in this phase: source-count vanity, application execution work, monetization.

### Phase C — Application execution

Purpose: make preparing and following through on an application one connected surface. Starts only when Phase B exit criteria are all checked.

Exit criteria:

- [ ] Preparing an application (resume choice, materials, tailoring) needs no page other than Job Detail, browser-verified.
- [ ] Resume and material choices stay attached to the application across reloads, browser-verified.
- [ ] Follow-up and outcome can be recorded from both Job Detail and the workspace board, browser-verified.

Items:

- **C1** Application workspace as the main preparation surface. Done when: the preparation steps above complete from Job Detail.
- **C2** Resume/material choices attached to the application. Done when: choices persist and show on Job Detail and the board.
- **C3** Streamlined follow-up and outcome workflows. Done when: the follow-up and outcome criteria above are observed.
- **C4** Networking, outreach and email context where it materially helps the loop. Done when: a specific DoD clause is named before promotion.

Not in this phase: autofill/automation, managed AI, new discovery sources.

### Phase D — After personal use is solid

Purpose: features that matter only after the personal workflow meets the Definition of Done.

Exit criteria:

- [ ] Definition of Done met and recorded in `handoff.md` before any D item starts.
- [ ] Each D item has a user decision and its own exit criteria before promotion.
- [ ] No D item weakens a security or ownership invariant in `docs/ARCHITECTURE.md`.

Items:

- **D1** Managed AI / no-API-key path.
- **D2** Guided browser autofill/automation (never auto-submit).
- **D3** Broader source coverage where justified.
- **D4** Monetization.
- **D5** Support/admin.
- **D6** Public beta/onboarding.

Done when for each: defined at promotion.

Not in this phase: anything in Out of scope.

### Phase E — Distribution and first-run setup

Purpose: let a non-developer install and use RoleSpec without Docker, Node.js, a terminal or an
`.env` file, while keeping the web/Docker path and the shared domain/AI layers intact.
Full design and risk analysis: `docs/DESKTOP_ONBOARDING_PROPOSAL.md`.

Exit criteria:

- [x] First-run onboarding covers the AI requirement, a real connection test, profile, resume and a
      ready summary.
- [x] A Tauri 2 shell launches the existing standalone server with a pinned Node runtime on Windows.
- [ ] First launch initializes a private PostgreSQL 17 cluster, applies migrations and survives
      restart/update with data intact. Restart is verified; update needs the installer (E4).
- [x] CI produces a Windows installer; install, logs and uninstall are documented and tested on
      Windows (clean-VM verification is E5).
- [ ] A clean Windows VM walkthrough from download to a tracked application is recorded.

Items:

- **E1** (done) In-app onboarding + provider detection/test. Done when: a new user can choose
  ChatGPT/Claude/local/API in plain language, run a real test, see a specific failure, and skip with
  an explicit warning.
- **E2** (done) Desktop shell. Done when: the shared standalone server runs under Tauri with file
  logs and clean shutdown; no product code is forked.
- **E3** Local database lifecycle. `initdb`, start, migrate, restart and shutdown are implemented and
  verified from the desktop runtime with no user-installed Postgres. Upgrade is verified with E4.
- **E4** (done) Installer pipeline. A tagged build produces an x64 NSIS installer in CI, creates a
  draft release, and uninstall preserves `%LOCALAPPDATA%\RoleSpecData` by default. Signed builds
  (Azure Artifact Signing, OIDC) verify their signature and publish instead of drafting.
- **E5** Clean-machine verification. Done when: the success criteria in the proposal are observed on
  a fresh Windows VM and recorded in `handoff.md`.
- **E6** Signed, self-updating releases. Done when: an installed build finds, verifies and applies an
  update, and a build older than the data it finds refuses to start instead of corrupting it.

Not in this phase: managed AI, auto-apply, SQLite or a desktop-only schema, new product features.

## Iteration queue

1. **it. 54** (A1) Make Enhance suggestions and their originals survive a page reload. Done when: run Enhance, apply one, reload; the list and Revert for the applied row are still there, browser-verified.
2. **it. 55** (A2) Strip internal section/bullet refs (e.g. "b0") from Enhance reason text. Done when: a unit test covers it and one live run shows none.
3. **it. 56** (A3) Show a score delta after applying one suggestion and re-checking. Done when: browser-observed delta after one apply plus re-analyze.
4. **it. 57** (A4) Ensure whole-resume Enhance reaches non-Experience sections under the cap. Done when: unit test plus one live run with a non-Experience suggestion.
5. **it. 58** (A5) Browser-verify the full Definition of Done journey once. Done when: walkthrough recorded in `handoff.md` with no open P0/P1.

## Parking lot

- Career Profile long-form scrollspy (section nav already exists).
- LinkedIn / Portfolio tools.
- Sidebar regrouping around Career / Opportunities / Applications / Follow-up.
- Resume list visual hierarchy of Master / Role Family / Job-Tailored.
- Resume editor mobile editor-first refinements.
- Header status select "Interested" option (currently intentional: moving back is a correction via Edit).
- NextAction copy for a due-today follow-up still says "has passed".
- Export menu alignment below `md` when Export is not first on its line.
- Editor top-issue line at `lg` (layout option, not a bug).

## Definition of done

RoleSpec is personally usable when a user can maintain a canonical Career Profile, create or improve a strong Master Resume from verified evidence, discover relevant jobs, understand why they are relevant, see both profile match and opportunity confidence, open one, use an appropriate resume, optionally tailor it, prepare/apply, track the application, schedule/follow up and record the outcome without unnecessary page hopping or repeated data entry.

Resume work is complete when the user can understand the most important weaknesses in a resume, review grounded improvements, apply or reject individual changes, and re-check the result without losing the underlying career evidence or original content.

The dashboard should make the next useful action obvious. Connected screens should preserve context. Critical browser workflows must be verified. No known P0/P1 workflow blocker may remain.

## Current execution

Start with `handoff.md`. Treat current code/schema/tests as authoritative. Take the next task from the Iteration queue above.
