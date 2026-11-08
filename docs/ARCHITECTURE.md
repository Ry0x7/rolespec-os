# Architecture

RoleSpec is a private, single-owner job-search workspace. The web app, Windows desktop shell and
browser extension share one set of career, resume, job and application data.

## Runtime and code layout

- `src/app`: Next.js routes and thin API handlers.
- `src/features`: domain services, actions, components and tests.
- `src/shared`: UI primitives, infrastructure, AI integration and validation.
- `src/config`: navigation and application configuration.
- `prisma`: PostgreSQL schema and the shared migration history.
- `extension`: standalone Manifest V3 browser companion, with its own dependencies/build.
- `desktop`: Tauri shell and bundled runtime resources; see [DESKTOP.md](DESKTOP.md).

The desktop shell runs a standalone Next.js build with bundled Node.js and a private PostgreSQL
cluster. It binds the server and database to loopback. Desktop builds use `.next-desktop`, separate
from a web development server's `.next`. Docker supplies PostgreSQL and applies the same migrations.
There is no desktop-only schema or separate implementation of the product.

## Product loop and entities

`Career Profile → Discover → Qualify → Prepare → Apply → Track → Follow up → Outcome`

- **Career Profile** holds the user's own history, evidence, preferences and goals.
- **Master Resume** is reusable and independent of a job description.
- **Role Family Resume** derives from the master for a class of roles.
- **Job-Tailored Resume** is an optional derivative for one application.
- **Job** is the canonical opportunity, including provenance and qualification data.
- **Application** records the user's activity and outcome against a job.

Job descriptions can influence prioritization and wording. They must never become evidence of a
qualification the user has not supplied. Resume improvements must remain reviewable and grounded
in the user's original content. Do not automatically submit applications.

## Resume import

`PDF/DOCX → validation → bounded text extraction → local import or explicit AI structuring → save`

`POST /api/resume/parse` checks owner access, rate limits, size, MIME/extension, file signatures
and DOCX archive sanity. Extraction has a timeout and a 200,000-character cap. Files are limited
to 5 MB. PDF uses `pdf-parse`; DOCX uses `mammoth`.

The default path never calls AI. It recognizes common standalone headings and maps each to its
matching resume section (summary, experience with bullets, skills, education, projects,
certifications), preserving the extracted wording. Unrecognized headings stay editable `CUSTOM`
sections using their existing `content` field. It does not invent qualifications, achievements or
dates, split fields beyond what the lines state, or promise layout preservation. Image-only scans
without readable text are rejected with guidance to use OCR.

`useAi=true` explicitly enables structured AI parsing and optional bullet polishing. The legacy
`optimizeBullets` field controls only polishing within that AI path; it cannot opt a caller into AI.
Automatic job-match analysis also requires `useAi=true` and a job description. A failed analysis
after persistence must not discard the imported resume.

## Access and privacy

There are no RoleSpec accounts, passwords, OAuth providers or registration flow. `auth()` resolves
the one owner row and every query stays scoped to that owner id; exports re-check résumé ownership
rather than relying on storage paths or unguessable URLs.

Access is decided by `src/features/auth/session.ts`:

- `local` (development default; set explicitly by the desktop runtime and Docker compose)
  passwordless, but only while the request host is loopback (`localhost`, `127.0.0.0/8` or `::1`).
  A request on a LAN, tunnel or public host is refused rather than treated as the owner.
- `unlock` (production default) requires `ROLSPEC_ACCESS_KEY` on a public host. A correct key is
  exchanged for a signed, HttpOnly, SameSite=Lax cookie. Without a usable key the workspace stays
  locked; there is no fallback that serves it unauthenticated.

`src/proxy.ts` does not perform authentication. It redirects legacy `/sign-in`-style bookmarks to the
dashboard and records the requested path so `/unlock` can return the owner there afterwards. Guards
in server components and actions redirect a locked request to `/unlock`.

Browser-extension pairing is independent: a bearer token from `/settings/api` authenticates extension
API routes even while the browser session is locked. Only token hashes are stored. External AI
providers keep their own authentication; RoleSpec never copies a CLI or OAuth session.

Database and export storage may be local or cloud-configured. Hosted AI providers receive prompt
content. Stored provider API keys are encrypted through `src/shared/lib/secret-box.ts`; credentials
must not be returned to clients or logged. Desktop secrets are created once and retained with the
data cluster outside the installation directory.

## AI setup and generation

Every model call goes through `src/shared/lib/ai-generate.ts`. Provider resolution lives in
`src/shared/lib/ai-provider.ts` and `src/shared/lib/ai-providers`.

Onboarding and Settings share plain-language provider choices, advisory diagnostics and a live
connection test under `src/features/onboarding`. A successful diagnostic does not replace the test.
Credentials use the existing encrypted `UserAiSettings` path. Diagnostics must not copy vendor auth
tokens. CLI login belongs to the vendor CLI; local models require a separately running server.

Providers include cloud APIs, Codex CLI, Claude Code, OpenCode free models, Ollama and LM Studio.
CLI tools/local servers are not bundled with the desktop installer. The supplied Docker setup uses
cloud APIs. Provider plans, model availability and limits may change; avoid fixed cost guarantees.

## Discovery and opportunity confidence

Source adapters normalize and deduplicate results into `Job`, preserving URLs, provider identity
and timestamps. One unavailable source should not fail a whole search. Public search/API/company
career paths and contextual extension capture are complementary.

Do not bypass login walls, paywalls, CAPTCHAs or anti-bot controls. Search snippets are fallback
signals; prefer the actual posting where accessible. The extension must not interfere with login
fields, password managers or unrelated browser behavior.

**Profile match** measures fit to the user's evidence. **Opportunity confidence** evaluates signals
such as provenance, freshness, completeness and an official application path. Keep these separate.
Stale or incomplete listings are not proof of fraud or dishonest hiring.

## Sources of truth

Current code, tests and shipped migrations define behavior. This document records durable
boundaries; [ROADMAP.md](ROADMAP.md) records remaining work; [DESKTOP.md](DESKTOP.md) covers desktop
operations. Keep historical investigations in git history rather than duplicate planning files.
