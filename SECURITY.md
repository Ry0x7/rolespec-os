# Security policy

RoleSpec stores a user's resume, contact details, application history and — optionally — encrypted
AI provider credentials. Reports about authentication, authorization, or secret handling are
especially welcome.

## Reporting a vulnerability

**Please do not open a public issue, discussion, or pull request for a security problem.**

Use GitHub's private reporting flow:
<https://github.com/Ry0x7/rolespec-os/security/advisories/new>

That opens a private advisory visible only to you and the maintainer, and is also where a fix and
an advisory can be coordinated. If the form is unavailable, contact [@Ry0x7](https://github.com/Ry0x7)
privately through GitHub and share only enough detail to establish contact.

Never paste real secrets, tokens, `.env` contents, database dumps, or another person's data into a
report. Redact and describe instead.

## What to expect

- Acknowledgement within **3 business days**.
- An initial assessment (affected component, severity, whether a CVE is warranted) within 7 days.
- Credit in the advisory once a fix ships, unless you ask to stay anonymous.
- This is a volunteer project: there is no bounty and no guaranteed fix deadline. A clear report
  with reproduction steps gets a fix fastest.

Please give the maintainer a reasonable window to ship a fix before publishing details.

## Supported versions

| Version | Supported |
| :--- | :--- |
| `main` (self-hosted, Docker, Node) | ✅ |
| Latest desktop release (`v1.0.x`, Windows) | ✅ |
| Older desktop releases | ❌ upgrade to the latest release |
| Forks and modified deployments | ❌ report upstream only if the issue reproduces here |

## Scope

In scope:

- **Authentication and authorization** — session handling, sign-up/invite flow, and any route that
  returns user-owned data (resumes, jobs, applications, exports, AI settings).
- **Cross-user access** — reading or mutating another account's resource by guessing an id, or a
  download URL that works without the owner's session.
- **Secrets at rest and in transit** — API key encryption (`src/shared/lib/secret-box.ts`),
  `AUTH_SECRET`/`ENCRYPTION_KEY` handling, secrets reaching logs, client bundles or exports.
- **The desktop shell** — local server exposure beyond loopback, the PostgreSQL cluster's trust
  authentication, the update channel (signature verification, downgrade guard), and process
  containment.
- **The browser extension** — `host_permissions`, content-script injection, and the messages it
  accepts from pages or from the app.
- **Server-side request handling** — SSRF in URL fetching, prompt-injection paths that let untrusted
  page or job text become instructions, and path traversal in file handling.
- **Build and release pipeline** — workflow permissions, artifact signing, and anything that could
  publish a tampered installer.

Out of scope:

- Misconfiguration of your own deployment (database reachable from the internet, missing
  `AUTH_SECRET`, TLS terminated incorrectly, a shared admin password).
- SmartScreen warnings or "unknown publisher" prompts on unsigned builds — the release process and
  its current limitations are documented in the README.
- Denial of service against your own instance, rate-limit tuning, and brute force without a
  demonstrable bypass.
- Dependency advisories already visible on the repository's Dependabot alerts with no patched
  version available upstream. A report that a *fix* is possible is welcome.
- Vulnerabilities in third-party services (Neon, Vercel Blob, AI providers) — report those to the
  vendor.
- Reports produced solely by an automated scanner without a demonstrated impact.

## Product security invariants

These are the properties the project intends to hold; a report that shows one of them is false is
in scope:

1. Every user-owned resource is scoped to the authenticated user, on read and on write.
2. Generated export files are served only through `/api/exports`, which checks the session and
   resume ownership; stored blobs are private and storage layout is not access control.
3. Job-description text is never treated as evidence of the user's qualifications.
4. AI provider credentials are encrypted at rest and are never returned to the client in clear.
5. The desktop app is not reachable from the network: the server binds loopback, and PostgreSQL
   uses `trust` authentication on `127.0.0.1` only.
6. Desktop updates are installed only after the artifact's signature and version are verified
   against the public key compiled into the app.
