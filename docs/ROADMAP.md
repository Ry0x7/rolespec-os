# Roadmap and known gaps

Updated: 2026-11-11. This is a remaining-work list, not a claim that every user
journey has been verified. The product is a private, single-owner workspace;
feedback and portfolio showcasing do not require a hosted service.

## Available today

- Career profile, master/role-family/job-tailored resumes, PDF export, ATS
  analysis and application tracking.
- Optional AI analysis, enhancement, matching and outreach through user-configured
  providers, with deterministic/AI-free fallbacks.
- Browser extension for clipping postings, fit badges, assisted ATS preparation,
  persistent review tasks and user-triggered resume attachment.
- Unified intake: resume, LinkedIn export, GitHub, public web, chat and voice
  transcript, with provenance and explicit conflict review.
- BM25 ranking with seven-factor matching, three-layer research and optional
  grounded reranking.
- Evidence-checked tailoring with source snapshots, version-specific rollback
  and a single-page PDF option.
- Durable application workflow backend with manual and agent-assisted modes,
  review checkpoints, SSE progress, retry/cancel and restart recovery.
- Docker/Node self-hosting and a published Windows x64 v1.0.5 installer.
- Machine-readable account export covering intake, workflows, review tasks,
  ATS records, tailoring history, activity and AI usage metadata.

The phase-1–7 backend is implemented in this source tree. The published v1.0.5
installer predates these additions; a new installer must be built and verified
before claiming them in a release. The new workflow and review APIs do not yet
have first-party UI. See [FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md) and
[VERIFICATION.md](VERIFICATION.md).

## Next verification work

1. **Clean Windows install and upgrade.** Exercise download, install, onboarding
   without AI, PDF/DOCX import, edit/export, application tracking, close/reopen
   and uninstall on a fresh Windows VM. Record Windows/WebView2 versions. A
   developer-host v1.0.4 → v1.0.5 upgrade was exercised; a clean-VM walkthrough
   and Authenticode-signed release remain outstanding.
2. **Live agent-assisted run.** Execute profile → discover → rank → research →
   tailor → validate → prepare ATS → human review → staging → tracking →
   follow-up against a real provider, including pause/cancel mid-call, provider
   failure, retry with backoff and restart recovery. Unit tests exist; this
   journey does not yet have a provider-backed run.
3. **Live ATS validation.** Verify Greenhouse, Lever and Ashby forms on real
   employer pages, including dynamic fields, resume attachment and the manual
   file-selection fallback. Fixtures are not a substitute.
4. **Review and workflow product surface.** Build the workflow timeline, review
   drawer and `/workspace/review` queue described in
   [FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md). Keep statuses persisted facts, not
   simulated progress.
5. **Answer privacy.** Encrypt `AtsAnswer` values at rest and decide whether
   `ReviewTask.answer` needs the same treatment.
6. **Follow-ups.** Add business-day +5 email and +12 LinkedIn recommendations, a
   durable due-task record, and a manual send/copy path. Do not auto-send.
7. **Full personal workflow.** Walk through profile → resume → discover →
   qualify → prepare → apply → follow up → outcome with sample data, then repeat
   with AI disabled.
8. **Discovery coverage.** Record which sources work, restrict access or are
   unavailable; verify Philippine coverage before adding adapters. Do not turn a
   heuristic listing signal into a factual claim.
9. **Extension regression.** Verify active-tab capture, site grants and badge
   behavior on supported boards; confirm login forms, password managers and
   unrelated page behavior remain unaffected.

## Known product decisions still open

- The LinkedIn page still offers a rating action whose endpoint returns
  `404 FEATURE_DISABLED`. Restore the feature intentionally or hide the action.
- No AI essay drafting. Essays are queued for human review; adding drafts would
  require verbatim review, profile grounding and a fail-closed validation pass.
- No dashboard leaderboard or persisted ranking snapshot. Ranking is available
  through the API and discovery ordering, not a dedicated screen.
- Provider selection is per user, not per workflow stage.
- No generic `SubmissionAttempt`; the extension's `AtsPreparation` and the
  workflow's `SUBMISSION_STAGING` output are separate evidence records.

## Distribution limits

- Native desktop packaging is Windows x64 only; Mac/Linux users need self-hosting.
- Releases are unsigned. SmartScreen and Smart App Control may block them; the
  metadata names Chryypt, but only Authenticode signing and reputation can
  establish a verified publisher.
- Authenticode signing is not configured. The updater's own signatures are
  separate from Windows publisher identity.
- A clean-machine walkthrough is still outstanding. Runtime, data paths and
  troubleshooting are in [DESKTOP.md](DESKTOP.md).
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
