<p align="center">
  <img src="screenshots/banner.png" alt="RoleSpec OS — 2D Pixel Banner" width="100%" />
</p>

<p align="center">
  <strong>The Autonomous, Self-Hosted Job-Seeking AI Operating System.</strong><br />
  Build ATS-tailored resumes, score job matches, track applications, and draft outreach in your private workspace.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=flat-square" alt="AGPL-3.0 License" /></a>
  <img src="https://img.shields.io/badge/Next.js-16%20(React%2019)-black.svg?style=flat-square&logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Zero%20API%20Keys-Supported-success.svg?style=flat-square" alt="Zero API Keys" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED.svg?style=flat-square&logo=docker" alt="Docker Ready" />
  <a href="https://ko-fi.com/ry0x7"><img src="https://img.shields.io/badge/Ko--fi-Support-FF5E5B.svg?style=flat-square&logo=kofi&logoColor=white" alt="Support on Ko-fi" /></a>
  <a href="https://github.com/Ry0x7/rolespec-os/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome" /></a>
</p>

---

## 💡 Why RoleSpec?

Job hunting shouldn't require paying $30/month across separate resume builders, ATS keyword scrapers, job tracking spreadsheets, and email outreach tools.

**RoleSpec** is an open-source, private, all-in-one desktop and web OS that combines:
- **ATS Resume Builder** with real token-matching algorithms and real-time score auditing.
- **Zero API Key AI Engine**: Use your existing **ChatGPT Plus** or **Claude Pro** subscriptions directly via CLI — no expensive per-token API credits or credit cards needed!
- **Opportunity Pipeline**: Full Kanban & table tracking with follow-up nudges, ghost-job/scam detection, and calendar agenda.
- **Application & Cold Outreach Generator**: Context-aware cover letters and cold outreach based on your verified credentials.
- **Standalone Chrome Extension (MV3)**: 1-click job clipping from LinkedIn, Indeed, Greenhouse, Lever, and Workday directly into your dashboard.

---

## ⚡ Zero API Keys: Connect Your Existing Subscriptions

> **No API credits? No problem.** RoleSpec is built from the ground up to support native subscription CLI providers, local offline AI, and traditional cloud keys.

| Provider | What it uses | Cost / Setup |
| :--- | :--- | :--- |
| **ChatGPT via Codex CLI** | Your **ChatGPT Plus or Pro** subscription | **$0 extra.** Run `npm i -g @openai/codex && codex login` |
| **Claude via Claude Code** | Your **Claude Pro or Team** subscription | **$0 extra.** Run `claude setup-token` |
| **Ollama / LM Studio** | 100% offline local GPU/CPU models (Llama 3, Mistral, Qwen) | **Free forever & fully offline.** Zero internet needed. |
| **Cloud APIs (Optional)** | OpenAI (`gpt-4o`), Anthropic (`claude-3-7-sonnet`), DeepSeek, Google Gemini | Pay-per-token API keys saved securely under Settings. |

### How to use your ChatGPT or Claude subscription:

#### Option A: OpenAI Codex CLI (ChatGPT Plus / Pro)
1. Install OpenAI's Codex CLI globally:
   ```bash
   npm install -g @openai/codex
   ```
2. Log in with your ChatGPT account in your terminal:
   ```bash
   codex login
   ```
3. Set in your `.env` (or select in `/settings/ai`):
   ```env
   AI_PROVIDER=codex-cli
   ```

#### Option B: Claude Code CLI (Claude Pro / Team)
1. Generate an authentication token with Claude Code:
   ```bash
   claude setup-token
   ```
2. Set in your `.env` (or select in `/settings/ai`):
   ```env
   AI_PROVIDER=claude-code
   ```

---

## 🚀 Quickstart for Non-Programmers

### Method 1: Run with Docker (Recommended — 2 Minutes)

You don't need Node.js or development tools installed. You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/).

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Ry0x7/rolespec-os.git
   cd rolespec-os
   ```

2. Copy the Docker environment template:
   ```bash
   cp .env.docker.example .env.docker
   ```

3. Start RoleSpec:
   ```bash
   docker compose up -d --build
   ```

4. Open your browser at **[http://localhost:3000](http://localhost:3000)** — RoleSpec automatically logs you in to your private workspace!

---

### Method 2: Run with Node.js

#### Prerequisites
- **Node.js 22+** ([nodejs.org](https://nodejs.org/))
- **PostgreSQL** database (a free [Neon.tech](https://neon.tech) cloud database works in 30 seconds)

#### Step-by-Step

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/Ry0x7/rolespec-os.git
   cd rolespec-os
   npm install
   ```

2. Configure your environment:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in:
   - `DATABASE_URL` (your Postgres connection string)
   - `AUTH_SECRET` (generate with `openssl rand -base64 32` or any random 32-character string)
   - `AI_PROVIDER` (choose `claude-code`, `codex-cli`, `ollama`, or paste an API key)

3. Initialize your database:
   ```bash
   npx prisma migrate dev
   npx prisma db seed
   ```

4. Launch the application:
   ```bash
   npm run dev
   ```
   Open **[http://localhost:3100](http://localhost:3100)** in your browser!

---

## 📸 Feature Tour

### 🎯 ATS Scoring & Smart Resume Studio
Real Applicant Tracking Systems don't use fuzzy semantic guessing — they look for exact role competencies, measurable impact metrics, and clean typography. RoleSpec scores your resume across 5 critical dimensions and provides line-by-line Action–Result–Reason rewrites.

<p align="center">
  <img src="screenshots/resume-editor.png" alt="Resume Editor & ATS Scoring" width="90%" />
</p>

- **Master vs. Job-Tailored Resumes**: Maintain your complete career history in a Master resume, and generate focused role copies tailored to specific job descriptions with one click.
- **4 Clean Export Templates**: Minimal, Modern, Harvard, and Corporate — pixel-perfect paginated PDF exports.
- **View as ATS**: Inspect the raw, unstyled text payload parser algorithms see before a human ever reads your application.

---

### 📊 Application Pipeline & Kanban Workspace
Track every lead through 7 stages: *Interested → Applied → Screening → Interview → Offer → Rejected → Archived*.

<p align="center">
  <img src="screenshots/workspace.png" alt="Workspace Board" width="90%" />
</p>

- **Scam & Ghost-Job Detection**: Flag unrealistic compensation, suspicious external redirects, and recruitment warning signs.
- **Requirement Badges**: Automatically extracts visa sponsorship, clearance, and onsite/remote requirements from postings.
- **Follow-up Nudges**: Built-in scheduling reminds you when an application has been waiting for a recruiter reply.

---

### 🔍 Opportunity Radar & Job Board Links
Discovers jobs tailored to your career targets across LinkedIn, Indeed, Ashby, Greenhouse, Lever, Workday, and regional boards without scraping captchas.

<p align="center">
  <img src="screenshots/jobs-discover.png" alt="Job Discovery & Tracker" width="90%" />
</p>

---

### 🧩 Chrome Extension (MV3)
Save any job description into your pipeline in 1 click, inspect eligibility requirements on the fly, and draft instant cold connection notes.

```
extension/
  ├── manifest.json       # Manifest V3 extension
  ├── src/                # Standalone Vite + TypeScript build
  └── dist/               # Load unpacked into Chrome / Brave / Edge
```

To install:
```bash
cd extension
npm install
npm run build
```
Load the `extension/dist` folder in `chrome://extensions` via **Load Unpacked**.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | Next.js 16 (App Router), React 19, TypeScript |
| **Styling & UI** | Tailwind CSS v4, Radix UI Primitives, Lucide Icons |
| **Motion** | Framer Motion (Smooth layout animations & gesture physics) |
| **Database & ORM** | PostgreSQL (Neon serverless or local Docker) + Prisma 7 |
| **Authentication** | Local auto-login (single-user OS), optional GitHub OAuth & credentials |
| **AI Integration** | Vercel AI SDK v7 (`codex-cli`, `claude-code`, Ollama, LM Studio, OpenAI, Anthropic, Gemini, DeepSeek) |
| **State Management**| Zustand + TanStack React Query |
| **PDF Engine** | `@react-pdf/renderer` (Paginated vector PDF generation) |

---

## 🔒 Security & Privacy Invariants

- **100% Self-Contained**: No third-party analytics, no telemetry, no tracking pixels, and no licensing server callouts.
- **Encrypted at Rest**: All personal API credentials stored in the database are encrypted using **AES-256-GCM** with keys derived from `ENCRYPTION_KEY` or `AUTH_SECRET`.
- **User Scoping**: Every resource, resume, application, and file export is strictly isolated to the authenticated account.

---

## 🤝 Contributing

Contributions from the open-source community are very welcome!

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

Please run tests before submitting:
```bash
npm test
npx tsc --noEmit
```

---

## ☕ Support the Project

RoleSpec OS is 100% free, private, and open-source under AGPL-3.0. If RoleSpec saves you hours on your job search, helps you land interviews, or provides value to your career journey, consider supporting ongoing development:

<p align="center">
  <a href="https://ko-fi.com/ry0x7" target="_blank">
    <img src="https://storage.ko-fi.com/cdn/kofi3.png?v=3" alt="Buy Me A Coffee at ko-fi.com" height="42" />
  </a>
</p>

---

## 📜 License

RoleSpec OS is licensed under the **[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)**.

- **You are free to**: Use, modify, self-host, and inspect this software for personal or organization use.
- **Copyleft Notice**: Any modified versions made available over a network (SaaS or hosted platforms) must release the complete source code under the AGPL-3.0.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Ry0x7">Ry0x7</a> and the open-source community.<br />
  <strong>If RoleSpec helps your job hunt, please consider leaving a ⭐ on GitHub or supporting on <a href="https://ko-fi.com/ry0x7">Ko-fi</a>!</strong>
</p>
