# Roadmap and known gaps

Updated: 2026-11-12. This is a remaining-work list, not a claim that every user
journey has been verified. The product is a private, single-owner workspace;
feedback and portfolio showcasing do not require a hosted service.

## Available today

- Career profile, master/role-family/job-tailored resumes, PDF export, ATS
  analysis and application tracking.
- Optional AI analysis, enhancement, matching, essay drafting and outreach
  through user-configured providers, with deterministic/AI-free fallbacks.
- Per-stage AI provider/model/key overrides and optional grounded reranking.
- Browser extension for clipping postings, fit badges, assisted ATS preparation,
  persistent review tasks, review-only essay drafts and user-triggered resume
  attachment.
- Unified intake: resume, LinkedIn export, GitHub, public web, chat and voice
  transcript, with provenance and explicit conflict review.
- BM25 ranking with seven-factor matching, persisted ranking snapshots,
  three-layer research and optional grounded reranking.
- Evidence-checked tailoring with source snapshots, deterministic cliché
  rejection, version-specific rollback and a single-page PDF option.
- Durable application workflow backend with manual and agent-assisted modes,
  review checkpoints, SSE progress, retry/cancel and restart recovery.
- One durable `SubmissionAttempt` per workflow or ATS preparation, with explicit
  user-only confirmation, tracker transition and follow-up scheduling.
- Automatic +5 business-day email and +12 business-day LinkedIn follow-up tasks,
  plus named outreach sequences with manual touches. Nothing is sent
  automatically.
- Encrypted ATS answer memory, server-side review queue and a documented
  extension API.
- Docker/Node self-hosting and a freshly rebuilt Windows x64 v1.0.5 NSIS
  installer. The installer has not been installed or code-signed in this audit.

## Verified runtime evidence

- A real provider-backed workflow completed on 2026-11-12 through the production
  build and the local API: profile → discover → rank → research → tailor →
  validate → prepare ATS → human review → staging → tracking → follow-up. The
  fresh run took two tailoring attempts, produced a `PASS` validation with
  evidence references, staged a `SubmissionAttempt` and left the tracker at
  `INTERESTED` with `submitted: false`.
- A real public Lever application page was scanned with the extension's field
  classifier: 24 fields, 6 safe fills, 18 review fields, 13 sensitive. No value
  was written and no resume was attached on the live page.
- A fresh unsigned installer was built from current staged resources:
  `RoleSpec_1.0.5_x64-setup.exe`, 104.94 MiB, on 2026-11-12. It was not installed
  or upgraded. See [VERIFICATION.md](VERIFICATION.md) for commands and logs.

## Next verification work

1. **Clean Windows install and upgrade.** Install the freshly rebuilt unsigned
   installer on a clean Windows 11 VM, exercise onboarding without AI, PDF/DOCX
   import, edit/export, application tracking, close/reopen, in-place upgrade and
   uninstall. Record Windows/WebView2 versions and whether SmartScreen blocks
   the unsigned build.
2. **Live ATS fill and attachment.** On accessible Greenhouse, Lever and Ashby
   employer pages, verify dynamic fields, the fill plan, field-level results,
   user-triggered resume upload and the manual file-selection fallback. The
   current live evidence is discovery and planning only; fixtures are not a
   substitute for a real fill.
3. **Broader frontend qualification.** The workflow timeline, review queue,
   dashboard leaderboard and tabbed layouts are implemented. Extend the
   [frontend QA](FRONTEND_QA.md) to fresh onboarding, native WebView, other
   browsers, screen readers and successful owned-source intake.
4. **Production load/soak.** Re-run concurrency and large-pool benchmarks on the
   target deployment, including workflow ticks, cancellation, provider timeouts
   and restart recovery under load. The 2026-11-12 baseline is in
   [VERIFICATION.md](VERIFICATION.md); it is a synthetic single-process run, not
   a capacity guarantee.
5. **AI-free and failure paths.** The AI-free manual workflow, the AI-disabled
   assisted fail-closed path, expired-lease recovery and cancellation were walked
   on 2026-11-13 (see [VERIFICATION.md](VERIFICATION.md)). Remaining: cancel
   during an actual provider call, recovery under load, and broader
   device/provider combinations.
7. **Discovery coverage.** Record which sources work, restrict access or are
   unavailable; verify Philippine coverage before adding adapters. Do not turn a
   heuristic listing signal into a factual claim.
8. **Extension regression.** Verify active-tab capture, site grants and badge
   behavior on supported boards; confirm login forms, password managers and
   unrelated page behavior remain unaffected.
9. **Signed release decision.** Authenticode signing and reputation are still
   required to remove SmartScreen warnings. Updater signatures are separate
   from Windows publisher identity.

## Known product decisions still open

- No dashboard leaderboard UI; ranking is API/discovery ordering only.
- No first-party workflow or web review screen.
- No automatic submission, email sending or outreach sending; all remain user
  actions by design.
- No multi-tenant accounts, hosted billing or SaaS isolation.
- Live employer-page resume attachment remains vendor- and page-dependent; the
  manual file-selection fallback is the supported path when staging fails.

## Distribution limits

- Native desktop packaging is Windows x64 only; Mac/Linux users need self-hosting.
- Releases are unsigned. SmartScreen and Smart App Control may block them; the
  metadata names Chryypt Inc, but only Authenticode signing and reputation can
  establish a verified publisher.
- Authenticode signing is not configured. The updater's own signatures are
  separate from Windows publisher identity.
- A clean-machine install/upgrade of the 2026-11-12 build is still outstanding.
  Runtime, data paths and troubleshooting are in [DESKTOP.md](DESKTOP.md).
- CLI and local-model AI options still require separate installation and
  configuration.

## Shared hosted service: deferred

Loopback deployments open directly as the single owner. In production, any
non-loopback host — LAN, tunnel or public — requires the signed-cookie key gate
(`ROLSPEC_ACCESS_MODE=unlock`) and stays locked until the operator's key is
entered. Independent hosted accounts would require multi-tenant isolation,
per-user job ownership, export access and credential boundaries. No SaaS,
billing or agent-run expansion is included in this cleanup.

## Product boundaries

- Keep master resumes job-independent and tailoring optional.
- Never invent qualifications from a job description.
- Keep application state separate from the canonical opportunity.
- Keep profile fit separate from opportunity confidence.
- No automatic application submission, email sending or bypassing site access
  controls.
- Preserve one PostgreSQL schema/migration history across desktop and web.
- Favor finishing the personal workflow over adding screens, templates or
  generic AI chat.

## Definition of done

A user can maintain career evidence, import/create a resume, review grounded
improvements, discover and evaluate opportunities, prepare an application, track
follow-ups and record an outcome without losing context or original content.
Core editing, text import and tracking remain usable without AI. The workflow
and review surfaces have real UI, the external journeys above have runtime
evidence, and no known blocking issue remains in the journey being promoted.
