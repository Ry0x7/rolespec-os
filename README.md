# RoleSpec OS

![RoleSpec OS](screenshots/banner.png)

An open-source personal workspace for resumes, job discovery, applications and outreach.
Built with Next.js, React, TypeScript, PostgreSQL and a Tauri Windows shell.

[Website](https://rolespec.ry0x7.dev/) · [Download for Windows](https://github.com/Ry0x7/rolespec-os/releases/tag/v1.0.2) · [Report a bug](https://github.com/Ry0x7/rolespec-os/issues) · [AGPL-3.0-or-later](LICENSE)

## Who can use it?

- **Windows users:** v1.0.2 is available for Windows 10/11 x64 with WebView2. The installer bundles
  the app runtime and a private PostgreSQL database; no Node.js, Docker or `.env` setup is needed.
- **Developers:** run your own instance with Docker or Node.js and PostgreSQL.
- **Mac/Linux:** self-hosting is available; native desktop installers are not shipped.

RoleSpec is a **single-owner workspace**. Signed-out requests resolve to the local owner account.
Run it privately; it is not ready to serve independent users on one public instance. The Docker
example below binds the app to localhost.

The Windows installer is currently **unsigned**, so Windows may show a publisher/SmartScreen
warning. Automatic updates are inactive for v1.0.2; install newer releases manually. A clean
Windows VM walkthrough is still outstanding. See the [desktop guide](docs/DESKTOP.md).

## What it does

**Source update:** AI-free resume import is fixed in the current source. The published v1.0.2
Windows installer predates this fix; a new desktop release is needed to deliver it to installers.

- Edit master, role-family and job-tailored resumes; preview and export PDFs in four templates.
- Import text-based PDF or DOCX resumes (up to 5 MB) without an AI provider.
- Discover opportunities and track applications, follow-ups, notes and outcomes.
- With AI configured: structure and polish resumes, analyze resume quality/job matches, and draft
  cover letters and outreach.
- Clip jobs from your browser using the standalone Chrome/Edge extension.

### Resume import and AI

Resume import defaults to **no AI**. Text is extracted on the app's server (on your computer for
Windows/local installs), grouped under recognized headings, and saved as editable text sections.
Review the result before exporting. This path does not infer structured employers, roles or dates,
rewrite bullets, or run ATS analysis. Scanned/image-only PDFs need OCR before upload.

Select **Organize and polish with AI** to use a configured provider for structured import and bullet
rewriting. If you also supply a job description, RoleSpec attempts an AI job-match analysis after
saving the resume. That option sends resume text to the selected provider.

Editing and application tracking also work without AI. AI analysis and generation need a working
provider; RoleSpec does not include a managed AI service.

| AI option | Additional setup |
| --- | --- |
| Codex CLI / Claude Code | Install the vendor CLI and sign in with an eligible account |
| OpenCode free models | Install OpenCode; hosted model availability and limits can change |
| Ollama / LM Studio | Install and run a local model server |
| OpenAI / Anthropic / DeepSeek / Google APIs | Supply a provider API key; provider charges apply |

Choose and test a provider during onboarding or in Settings. CLI tools and local model servers
are not bundled. The supplied Docker configuration supports cloud API providers.

## Run it yourself

### Docker

Requires Docker with Compose.

```bash
git clone https://github.com/Ry0x7/rolespec-os.git
cd rolespec-os
cp .env.docker.example .env.docker
# Set AUTH_SECRET and ENCRYPTION_KEY in .env.docker.
docker compose up -d --build
```

Open [localhost:3000](http://localhost:3000). The database, migrations and export volumes are managed
by Compose. An API key is needed only if you enable AI features.

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

Open [localhost:3100](http://localhost:3100). The owner workspace is created automatically;
seeding is optional and intended for development. See [.env.example](.env.example) for settings
and [CONTRIBUTING.md](CONTRIBUTING.md) for development commands.

### Browser extension

```bash
cd extension
npm install
npm run build
```

Load `extension/dist` through **Load unpacked** in your browser's extension settings. See the
[extension README](extension/README.md) for connection and usage details.

## Feature tour

![Resume editor](screenshots/resume-editor.png)
![Application workspace](screenshots/workspace.png)
![Job discovery](screenshots/jobs-discover.png)

## Privacy and deployment

Your configured database stores your career information. AI prompts leave the instance when you
choose a hosted provider; configured cloud database/export storage also stores data off-device.
Stored provider API keys are encrypted. Keep your environment files and encryption keys private.
Resume scores and opportunity-risk signals are guidance, not guarantees of interviews or proof
that a listing is fraudulent.

Use a separate private instance per person. Do not publish your personal workspace as a live demo;
use screenshots or a recording with sample data for a portfolio showcase.

## Project documentation

- [Architecture and invariants](docs/ARCHITECTURE.md)
- [Roadmap and known gaps](docs/ROADMAP.md)
- [Windows runtime, troubleshooting and releases](docs/DESKTOP.md)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)

Feedback from job seekers, recruiters and developers is welcome through GitHub issues. Include
installation method, reproduction steps and expected behavior; redact personal data and secrets.
