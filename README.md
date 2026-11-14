# RoleSpec OS

![RoleSpec OS](screenshots/banner.png)

A private, local-first job-search workspace: resume studio, ATS matching, job discovery,
application tracking and agent-prepared applications. Published by **Chryypt Inc**.

[Website](https://rolespec.ry0x7.dev/) · [Download for Windows](https://github.com/Ry0x7/rolespec-os/releases/latest) · [Issues](https://github.com/Ry0x7/rolespec-os/issues) · [Personal-use license](LICENSE)

## What it is

RoleSpec OS is a **single-owner workspace**. It opens into your own data — no account
registration, shared tenancy or password recovery. It runs against a PostgreSQL database you
control; the Windows installer bundles one and sets it up privately on first launch.

AI is optional. Resume editing, importing, discovery and application tracking all work without
it. When enabled, the agent can research a company, tailor and validate a resume, prepare
application answers and assemble the package for your review. **It never submits an
application silently** — the final submit stays with you.

## What's new in 2.1

- **A dashboard that leads with today.** Applications, follow-ups and the next seven days sit at the top, each with a colour-coded state. The daily application goal is configurable in **Settings → Preferences**.
- **Readable ranking.** Each role shows its score, evidence coverage and a plain-language "Why this rank?" with colour-coded factor badges instead of one wall of text.
- **Phone-first board.** Navigation no longer scrolls sideways, the pipeline becomes one column at a time on a phone, and the desktop rail collapses from the mark beside the logo.
- **Lighter preparation runs.** Ranked roles and preparation runs use progressive disclosure, so long lists stop turning into a page-long scroll.
- **Dashboard visual regression.** A deterministic fixture catches card reflow at 390px and 1440px before a screenshot review.
- **Personal-use license.** Commercial use, monetization, redistribution and patent claims are no longer permitted. See [LICENSE](LICENSE).

Full notes: [RoleSpec OS v2.1.0](docs/releases/v2.1.0.md).

## Features

- **Resume studio** — master, role-family and job-tailored resumes; eight PDF templates; live preview.
- **ATS matching** — quality and job-match scores with concrete fixes and a re-analyze loop.
- **Agent-assisted apply** — research, tailor, validate, prepare ATS answers, then hand off for review.
- **Job discovery and tracking** — saved roles, applications, interviews, follow-ups and outcomes.
- **Dashboard and daily status** — today's applications, follow-ups due and the next seven days first, with a configurable daily goal and colour-coded states.
- **Pipeline board** — drag applications across seven statuses on desktop, or work one column at a time on a phone, with goals and response stats.
- **Explainable ranking** — fit score, evidence coverage and a readable "Why this rank?" breakdown for every saved role.
- **Resume import** — text-based PDF/DOCX up to 5 MB, grouped into editable sections; no AI required.
- **Browser extension** — clip a job posting from Chrome or Edge straight into your workspace.
- **Local-first by default** — offline use, zero telemetry, encrypted provider keys.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="screenshots/dashboard.png" alt="Dashboard with today's application status, next action and ranked roles" width="100%"></td>
    <td width="50%"><img src="screenshots/jobs.png" alt="Job applications board" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><img src="screenshots/resume-editor.png" alt="Resume editor with live preview" width="100%"></td>
    <td width="50%"><img src="screenshots/job-prepare.png" alt="Apply with the agent preparation panel" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><img src="screenshots/job-ats.png" alt="ATS analysis drawer" width="100%"></td>
    <td width="50%"><img src="screenshots/workspace.png" alt="Application pipeline" width="100%"></td>
  </tr>
</table>

The [hosted showcase](https://rolespec.ry0x7.dev/) renders these views as live HTML
mocks rather than downscaled captures; use **Expand** under a mock for the
full-size preview.

## Quick start

### Windows (recommended)

Download the [latest release](https://github.com/Ry0x7/rolespec-os/releases/latest) and run the
installer on Windows 10/11 x64. It bundles the app runtime, WebView2 and PostgreSQL 17, and
creates a private database cluster on first launch. No Node.js, Docker or `.env` setup is needed.

The installer is **unsigned**, so Windows SmartScreen may warn you. The installer names
**Chryypt Inc** as publisher, but that is application metadata, not a verified Authenticode
signature. Builds are installed manually; auto-update is not guaranteed for every release.

macOS and Linux can self-host; native installers are not shipped.

### Docker

Requires Docker with Compose.

```bash
git clone https://github.com/Ry0x7/rolespec-os.git
cd rolespec-os
cp .env.docker.example .env.docker
# Set AUTH_SECRET and ENCRYPTION_KEY in .env.docker.
docker compose up -d --build
```

Open [localhost:3000](http://localhost:3000). Compose publishes the port on `127.0.0.1` and
sets `ROLSPEC_ACCESS_MODE=local`.

### Node.js

Requires Node.js 22+ and PostgreSQL.

```bash
git clone https://github.com/Ry0x7/rolespec-os.git
cd rolespec-os
npm install
cp .env.example .env
# Set DATABASE_URL, AUTH_SECRET and ENCRYPTION_KEY in .env.
npx prisma migrate deploy
npm run dev -- --hostname 127.0.0.1
```

Open [localhost:3100](http://localhost:3100). The owner workspace is created automatically.
See [.env.example](.env.example) for every setting.

### Browser extension

```bash
cd extension
npm install
npm run build
```

Load `extension/dist` through **Load unpacked** in your browser's extension settings. See the
[extension guide](extension/README.md) for details.

## AI providers

| Option | Setup |
| --- | --- |
| Codex CLI / Claude Code | Install the vendor CLI and sign in with an eligible account |
| OpenCode | Install OpenCode; free hosted model availability and limits can change |
| Ollama / LM Studio | Install and run a local model server |
| OpenAI / Anthropic / DeepSeek / Google | Supply a provider API key; provider charges apply |

Choose and test a provider during onboarding or in **Settings → AI**. CLI tools and local model
servers are not bundled. Resume import defaults to **no AI** and keeps your original wording;
select *Organize and polish with AI* to send text to the configured provider.

## Privacy and security

Your database holds your career data. AI prompts leave the instance only when you choose a
hosted provider, and configured cloud database or export storage also stores data off-device.
Stored provider keys are encrypted. Keep your environment files and encryption keys private.

Passwordless owner access is limited to loopback hosts. A public deployment uses `unlock` mode
and must set `ROLSPEC_ACCESS_KEY` (16+ characters); a non-loopback request never receives
passwordless access. Use one private instance per person — never publish your personal
workspace as a live demo.

Resume scores and opportunity-risk signals are guidance, not guarantees of interviews or proof
that a listing is fraudulent.

## Documentation

- [Architecture and invariants](docs/ARCHITECTURE.md)
- [Roadmap and known gaps](docs/ROADMAP.md)
- [Release notes](docs/releases/v2.1.0.md)
- [Frontend verification and release limits](docs/FRONTEND_QA.md)
- [Windows runtime, installer metadata and releases](docs/DESKTOP.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Credits

RoleSpec OS is published by **Chryypt Inc** and developed and maintained by
[Ry0x7](https://github.com/Ry0x7). [Claude Code](https://claude.com/product/claude-code) is
acknowledged as an AI-assisted development tool; code decisions, review and maintenance remain
the maintainer's responsibility. This credit does not imply endorsement by Anthropic.

## License

RoleSpec OS is source-available under the [RoleSpec OS Personal Use License 1.0](LICENSE).
It is for **personal, non-commercial use only**. Commercial use, monetization, redistribution,
sublicensing and patent claims are not permitted. It is not an OSI-approved open-source license.

Feedback is welcome through GitHub issues; include your installation method, reproduction steps
and expected behavior, and redact personal data.
