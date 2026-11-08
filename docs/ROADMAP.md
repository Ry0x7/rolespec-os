# Roadmap and known gaps

Updated: 2026-11-08. This is a remaining-work list, not a claim that all user journeys have been
verified. The current product is a private, single-owner workspace; feedback and portfolio
showcasing do not require converting it into a hosted service.

## Available today

- Career profile, master/role-family/job-tailored resumes, PDF export and application tracking.
- Optional AI analysis, enhancement, job matching and outreach through user-configured providers.
- Browser job capture through the standalone extension.
- Docker/Node self-hosting and a published Windows x64 v1.0.3 installer.
- Guided AI setup with diagnostics and a connection test.

v1.0.3 includes AI-free resume text import, structured into the matching resume sections with the
extracted wording preserved. See [README](../README.md) for the exact local-import behavior and
platform requirements.

## Next verification work

1. **Clean Windows install:** exercise download, install, onboarding without AI, PDF/DOCX import,
   edit/export, application tracking, close/reopen and uninstall on a fresh Windows VM. Confirm
   data retention and record the Windows/WebView2 versions and release tested.
2. **Resume improvement loop:** verify that applied suggestions and Revert survive reload, reason
   text contains no internal IDs, re-analysis shows the score change, and whole-resume enhancement
   reaches issues outside Experience. Separate unit-test evidence from real provider/browser runs.
3. **Full personal workflow:** walk through profile → resume → discover → qualify → prepare →
   apply → follow up → outcome with sample data. Close any blocking issue before promoting broad
   readiness claims.
4. **Discovery:** record which existing sources work, restrict access or are unavailable. Verify
   Philippine coverage before adding more adapters. Listing status/corroboration remains a gap in
   opportunity confidence; do not turn a heuristic signal into a factual claim.
5. **Extension:** verify the shipped active-tab capture path against supported job sites and confirm
   that login forms, password managers and unrelated page behavior remain unaffected.

## Distribution limits

- Native desktop packaging is Windows x64 only; Mac/Linux users need self-hosting.
- v1.0.3 is unsigned unless release signing is configured, and an unsigned build carries no
  `latest.json`. Users must update manually.
- Installer signing and the GitHub-hosted updater need end-to-end verification before enabling
  automatic updates. Updater signatures alone do not provide a Windows verified publisher.
- A clean-machine walkthrough is still outstanding. Desktop developer-machine checks are not a
  substitute. Runtime, data paths and troubleshooting are in [DESKTOP.md](DESKTOP.md).
- CLI and local-model AI options still require separate installation and configuration.

## Shared hosted service: deferred

Loopback deployments open directly as the single owner. In production, any non-loopback host — LAN,
tunnel or public — requires the signed-cookie key gate (`ROLSPEC_ACCESS_MODE=unlock`) and stays locked
until the operator's key is entered, so it does not serve the owner workspace anonymously. Independent
hosted accounts would still require multi-tenant isolation, per-user job ownership, export access
and credential boundaries. No SaaS, billing or agent-run expansion is included in this cleanup.

## Product boundaries

- Keep master resumes job-independent and tailoring optional.
- Never invent qualifications from a job description.
- Keep application state separate from the canonical opportunity.
- Keep profile fit separate from opportunity confidence.
- No automatic application submission or bypassing site access controls.
- Preserve one PostgreSQL schema/migration history across desktop and web.
- Favor finishing the personal workflow over adding screens, templates or generic AI chat.

## Definition of done

A user can maintain career evidence, import/create a resume, review grounded improvements, discover
and evaluate opportunities, prepare an application, track follow-ups and record an outcome without
losing context or original content. Core editing, text import and tracking remain usable without
AI. Meaningful UI/provider/installer workflows have actual verification evidence, and no known
blocking issue remains in the journey being promoted.
