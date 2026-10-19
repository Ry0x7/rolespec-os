# Desktop Distribution & First-Run Onboarding — Implementation Proposal

Status: proposal accepted for Milestone 1 implementation (2026-10-19).
Scope: distribution, desktop usability, first-run onboarding, AI-provider setup.
Explicitly out of scope: new product features, managed/hosted AI, auto-apply.

---

## 1. Current-state assessment

Verified against code, schema, tests and build config on 2026-10-19.

**Application shape**

- Next.js 16 App Router, React 19, strict TypeScript. `src/app` routes, `src/features/*`, `src/shared/*`.
- `next.config.ts` emits `.next/standalone` only when `DOCKER_BUILD=1`. The standalone output plus
  `node server.js` is already the deployment unit used by the Docker image, so a desktop runtime can
  run the exact same artifact instead of a second build.
- Prisma 7 with `@prisma/adapter-pg` (`src/shared/lib/prisma.ts`) and a required `DATABASE_URL`.
  The schema uses PostgreSQL enums (`UserRole`, `GoalPeriod`, `ExperienceLevel`, …), `Json` columns,
  `@db.Text`, and `pg_advisory_xact_lock` for the AI daily-quota reservation
  (`src/shared/lib/ai-generate.ts`). PostgreSQL is load-bearing, not incidental.
- Auth.js v5, but the product is single-user by default: `auth()` in `src/features/auth/config.ts`
  resolves the existing session or the oldest local user, creating `owner@rolespec.local` if the DB
  is empty. There is no sign-in wall in the normal path.
- Docker: `docker-compose.yml` runs Postgres 17, a one-off `prisma migrate deploy`, then the app.
  The app service pins `AI_PROVIDER=openai` because `claude-code`/`codex-cli` spawn subprocesses and
  `ollama`/`lmstudio` expect a host server, none of which work inside the container.
- CI: typecheck, lint, test, build and audit in `.github/workflows/ci.yml`.

**AI layer (as it actually works)**

- Every AI call funnels through `src/shared/lib/ai-generate.ts`; provider construction lives in
  `src/shared/lib/ai-provider.ts` and `src/shared/lib/ai-providers/*`.
- Eight providers exist: `openai`, `anthropic`, `deepseek`, `google`, `ollama`, `lmstudio`,
  `claude-code`, `codex-cli`.
- Per-user provider/model/key is stored on `UserAiSettings`; API keys are AES-256-GCM encrypted via
  `src/shared/lib/secret-box.ts` and decrypted only at call time. This is the existing secure path
  and must be reused, not replaced.
- `claude-code` uses the Claude Agent SDK/provider and inherits the CLI's own authentication;
  `codex-cli` spawns `codex exec` with `sandboxMode: "read-only"`. Both are marked `localOnly`.
- `localOnly` is only rejected when `VERCEL` is set. A desktop/self-hosted runtime is exactly where
  these providers are supposed to work.
- AI-dependent workflows are broad: resume parse/tailor/enhance, ATS scan, job match, cover letter,
  cold/outreach/reply email, interview questions, job-risk, LinkedIn rating/assist, portfolio rating,
  career import, profile enhance. RoleSpec does not work fully without a provider.
- Failure surfaces exist (`AiKeyRequiredError`, `AiDailyLimitError`) but the settings save action
  returns generic "Something went wrong", and there is no provider health check anywhere.

**Onboarding today**

- `/onboarding` gates on `PlayerProfile.onboardedAt`, and the wizard has two steps: marketing copy and
  current/target role + goal. It then tells the user to add an API key at `/settings/ai`.
- No AI choice, no detection, no connection test, no resume step, no desktop-aware copy.
- `/settings/ai` exposes the raw eight-provider list and terminal commands (`npm i -g @openai/codex`,
  `claude setup-token`) with no explanation of which subscription is required, and no way to verify
  that a choice actually works.

**What actually blocks a non-technical Windows user today**

1. No installer. The only paths begin with `git clone`, `npm install`, or Docker Desktop.
2. Node.js 22, PostgreSQL, `AUTH_SECRET`, `DATABASE_URL` and `.env` editing are prerequisites.
3. Prisma migration commands must be run from a terminal.
4. AI setup is a provider-name dropdown; CLI subscription setup and local servers are described in
   developer language.
5. Nothing verifies the AI configuration, so the first real failure appears inside a resume workflow
   as a generic error.
6. There is no server/process lifecycle: the user must keep a terminal running.

---

## 2. Main onboarding friction points

| # | Friction | Where | Milestone |
|---|---|---|---|
| F1 | Install requires git/Docker/Node | distribution | M2–M5 |
| F2 | Database and secrets require `.env` | distribution | M3 |
| F3 | AI choice is a provider list, not a goal | `/settings/ai`, `/onboarding` | M1 |
| F4 | No detection of CLI/local providers | — | M1 |
| F5 | No real connection test or specific errors | — | M1 |
| F6 | CLI subscription requirements are unexplained | settings copy | M1 |
| F7 | Onboarding does not connect AI or resume work | `/onboarding` | M1 |
| F8 | Generic failure copy hides the cause | settings actions | M1 |
| F9 | No process/log/uninstall story | — | M2–M5 |
| F10 | README's "quickstart for non-programmers" still starts with git clone | README | M6 |

---

## 3. Recommended desktop architecture

**Choice: Tauri 2 shell + the existing Next.js standalone server as a managed sidecar.**

Reasons:

- The Next app is a server application (Prisma, Auth.js, server actions, API routes, PDF rendering).
  Any wrapper must run that server. Tauri and Electron differ only in what supervises it.
- Tauri produces a normal per-user NSIS installer, starts without a terminal, uses the system
  WebView2 (present on Windows 11 and virtually all updated Windows 10), and adds a small shell
  rather than a second browser runtime.
- The Rust surface is deliberately small: single instance, sidecar spawn, readiness poll, log
  redirection, graceful shutdown, updater hook. It does not reimplement product logic.
- The existing `DOCKER_BUILD=1` standalone output is reused verbatim, so web, Docker and desktop run
  the same server bundle and the same Prisma migrations. There is no "desktop fork".
- Electron was evaluated and rejected as the default: it bundles Chromium (~+120 MB), adds a second
  Node/Chromium security surface, and its main advantage (JS process management) is not worth the
  footprint for a local single-user app. It remains the fallback if Tauri's sidecar lifecycle proves
  unreliable on real Windows machines.
- A pure "browser + local server launcher" was rejected: it cannot provide a normal installer,
  window lifecycle, logs or uninstall behavior.

**Runtime composition (installed app)**

```
RoleSpec.exe (Tauri shell)
├── WebView2 window ──► http://127.0.0.1:<port>
├── resources/node/node.exe          (pinned Node 22 LTS, not user-installed)
├── resources/app/server.js          (.next/standalone + static + public + prisma assets)
├── resources/postgres/bin/*         (PostgreSQL 17 binaries, initdb/pg_ctl/postgres)
└── %LOCALAPPDATA%\RoleSpecData\
    ├── data\pg\                     (cluster; preserved across updates)
    ├── data\exports\                (EXPORT_STORAGE_DIR)
    ├── config\secrets.json          (AUTH_SECRET / ENCRYPTION_KEY, ACL-restricted)
    └── logs\rolespec.log            (rotating; shell + server + postgres)
```

- Port: prefer a fixed `3100`, fall back to an OS-assigned free loopback port if occupied; pass the
  chosen origin to Next via `PORT`, `HOSTNAME=127.0.0.1`, `NEXT_PUBLIC_APP_URL` (built value must
  match, so build the desktop bundle with the default origin and only fall back when necessary).
- Secrets: generated once with `crypto.randomBytes(32)`, stored outside the app directory so
  uninstall/update does not rotate them. They are injected into the child process environment only;
  never logged, never sent to the webview.
- Database: `initdb` on first launch into `data\pg` with `--auth=trust` bound to `127.0.0.1` only
  (local single-user machine), then start `postgres` on `127.0.0.1:<port>`; run
  `prisma migrate deploy` with the bundled CLI before the app server starts.
- Logs: one file per launch appended with rotation at ~5 MB × 3; the shell records spawn/exit codes
  and the server's stdout/stderr. A "Open logs" item in the app menu.
- Shutdown: window close → `SIGTERM`/`taskkill` the Node child, wait bounded, then `pg_ctl stop -m fast`;
  a Windows Job Object guarantees no orphaned postgres if the shell crashes.
- Updates: Tauri updater against GitHub Releases. App data is outside the install directory, so
  updates preserve DB, exports and secrets; migrations run on the next launch. Downgrades are not
  supported once a migration has applied.
- Installer: unsigned builds are blocked by SmartScreen. Code signing is a release prerequisite, not
  a code task; the build pipeline will produce both signed (release) and unsigned (local test) artifacts.

---

## 4. Database strategy

| Option | Assessment |
|---|---|
| **A. Bundle/manage PostgreSQL** | **Chosen.** Same engine major (17) and the exact existing schema/migrations. Advisory locks, enums, `Json`, `@db.Text` and query semantics are preserved. Cost: ~300–350 MB installer growth and a process to supervise. |
| B. SQLite desktop mode | Rejected. Prisma SQLite does not support the schema's enums or `Json`; it would force string columns, application-level enum validation, and a second migration history. `pg_advisory_xact_lock` has no equivalent. That is real schema divergence and two data layers — exactly what the brief forbids. |
| C. Keep PostgreSQL, automate through installer/runtime | **Chosen, concretely:** `initdb` + `pg_ctl`, data in `%LOCALAPPDATA%`, bundled `prisma migrate deploy`, no Docker and no user-installed Postgres. |
| D. PGlite (WASM Postgres) | Rejected for now. It is real Postgres, but Prisma needs a pg-wire shim/socket server, advisory-lock and extension behavior is not guaranteed, and every app start would depend on that shim. Revisit only if installer size becomes a hard constraint. |

Consequences: pin PostgreSQL 17 for the desktop line; cross-major upgrades require `pg_upgrade` in a
later milestone and must be tested, not assumed. The web/Docker path keeps its own managed Postgres
and is untouched.

---

## 5. AI setup strategy

Four plain-language choices, mapped onto the existing eight providers:

| Choice | Provider | Authentication | Detection before test |
|---|---|---|---|
| Use ChatGPT | `codex-cli` | ChatGPT Plus/Pro via official Codex CLI (`codex login`) | `codex --version`; `codex login status` exit code |
| Use Claude | `claude-code` | Claude Pro/Team via official Claude Code (`claude auth login`) | `claude --version`; `claude auth status` exit code / `CLAUDE_CODE_OAUTH_TOKEN` |
| Use local AI | `ollama`, `lmstudio` | No account; local server | HTTP `GET /api/tags` or `/v1/models`; model list |
| Use an API key | `openai`, `anthropic`, `google`, `deepseek` | Provider API key | Key present; live minimal generation |

Rules:

- Reuse `saveUserAiSettings` for credentials so keys stay AES-256-GCM encrypted. Never add a second
  storage path. Never log, echo or return a key.
- Never read, copy, parse or manipulate Codex/Claude auth files. Only invoke the vendors' own status
  commands and use their exit codes; a signed-out result points the user at the official login flow.
- Detection is advisory; the connection test is authoritative. The test performs one minimal,
  budgeted generation through `ai-generate.ts` (new usage feature `settings.ai_connection_test`), so
  quota, logging and provider resolution behave exactly like real feature calls.
- Errors are classified and actionable: not installed, not signed in, local server not running, no
  model installed, model missing, key missing, key rejected, rate limited, timed out, daily cap.
  Generic "Something went wrong" is not acceptable in this flow.
- No automatic model download. Local setup may offer a copyable `ollama pull` command and, later, an
  explicit consent dialog showing model size.
- CLI installation is guided, not silent. The app detects, then links to the official install guide
  and shows the official login command. Bundling vendor CLIs is a separate licensing/support decision.
- The desktop build can keep all providers enabled. Docker continues to pin cloud-only providers;
  its current constraint is correct and stays.

---

## 6. Files/modules that need changes

**Milestone 1 (this proposal's implementation)**

- `src/features/onboarding/constants/ai-setup.ts` — grouped choices, requirement copy, provider map.
- `src/features/onboarding/lib/provider-diagnostics.ts` — CLI/local/API detection with timeouts.
- `src/features/onboarding/lib/ai-connection-test.ts` — preflight + live test + error classification.
- `src/shared/lib/ai-generate.ts` — `settings.ai_connection_test` usage feature and a bounded test call.
- `src/features/onboarding/actions/ai-setup.actions.ts` — `inspect`, `configureAndTest`, `testSaved`.
- `src/features/onboarding/components/onboarding-wizard.tsx` — 7-step first-run flow.
- `src/app/onboarding/page.tsx` — server-loaded diagnostics/status for the wizard.
- Tests under `src/features/onboarding/**/__tests__`.
- `README.md`, `handoff.md`.

**Later milestones (no schema change expected)**

- `desktop/` (Tauri 2): `src-tauri/`, `binaries/`, `resources/`, `tauri.conf.json`, NSIS config,
  Rust supervisor and updater.
- `scripts/desktop/` — fetch/pin Node and PostgreSQL 17 binaries, stage standalone assets, verify
  resource manifest, run migrations against a scratch cluster.
- `.github/workflows/desktop.yml` — Windows x64 build, artifact, optional signing, smoke test.
- `postinstall`/build hook for `DOCKER_BUILD`-equivalent desktop output (reuse standalone).
- `src/shared/lib/runtime-environment.ts` (small capability helper) only if server code must know it
  is desktop; domain logic must not branch on it.

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Windows PATH from Explorer lacks npm-global `codex`/`claude` shims | Detection and CLI calls fail even though the user is set up | Resolve expected install locations (`%APPDATA%\npm`, `%LOCALAPPDATA%\Programs`) plus PATH; report "installed but not on the app's PATH" separately |
| CLI login state lives in the user profile | A packaged app may run under a different environment | Run sidecars as the same user; never use a service account; status command inherits `HOME`/`USERPROFILE` |
| PostgreSQL port/cluster conflicts, antivirus, permissions | App will not start | Loopback-only, user-writable data dir, port probe/fallback, explicit recovery screen with log path |
| Installer size (~400 MB) | Download friction | Lazy model downloads are already excluded; document size; consider PostgreSQL-only-on-first-run packaging later |
| SmartScreen / unsigned binary | Users cannot install | Code signing required for release; unsigned only for local verification |
| Update applies a migration then user downgrades | DB incompatible | One-way version guard; block downgrade and show a clear message |
| Process orphan after crash | Port/DB lock on next launch | Windows Job Object + stale PID/port recovery |
| AGPL distribution | Compliance | Publish corresponding source and offer it from the installer/app |
| Duplicate desktop data layer | Maintenance drift | Hard rule: one Prisma schema, one migration history, one AI layer; desktop only supplies bootstrapping |

---

## 8. Migration implications

- **No schema change** for Milestone 1. `UserAiSettings` already stores provider/model/encrypted key.
- Desktop reuses `prisma/migrations`; first launch creates a new cluster and applies the full history.
- Existing self-hosted data is not moved automatically. A later import path (pg_dump/restore) is
  documented, not invented.
- Secrets: a desktop install must persist `AUTH_SECRET`/`ENCRYPTION_KEY` across updates or stored API
  keys become unreadable. This is part of the shell contract, with a test that simulates an upgrade.
- Single-user auth stays as-is. Desktop does not remove ownership checks from shared code; a future
  multi-user web deployment must still be safe.

---

## 9. Test strategy

- **Unit:** provider metadata mapping; detection parsing of CLI status/HTTP responses; error
  classification; wizard step decisions. All external commands and fetch calls mocked.
- **Action:** auth refusal, key encryption path (assert plaintext never written), preflight failure
  blocks the live call, classified error returned, success returns provider/model/latency.
- **Component:** AI choice → provider → test states; explicit "continue without AI" warning.
- **Integration:** standalone server against a disposable Postgres, `/api/health` ready, onboarding
  page renders, `/settings/ai` unchanged.
- **Browser (Playwright):** first-run journey with a stub provider endpoint (Ollama-compatible) and
  with a missing CLI, verifying the specific error copy.
- **Desktop (later):** Rust unit tests for port/readiness/shutdown decisions; packaging smoke test on
  a clean Windows VM: install, launch, onboard, create resume, close, reopen, uninstall with data
  retained. No test is reported as passing unless it actually ran; signed-installer checks require a
  certificate and may remain blocked.

---

## 10. Phased implementation plan

**Milestone 1 — In-app onboarding + provider detection/test (this change)**
Entry: proposal written. Exit: a new user can choose an AI path in plain language, see real detection
state, run a real connection test with specific errors, skip with an honest warning, and finish setup.
Typecheck, lint and tests green.

**Milestone 2 — Desktop runtime shell**
Entry: M1 merged. Exit: Tauri shell launches the existing standalone server with a bundled Node
runtime on a developer Windows machine, logs to file, shuts down cleanly; no product code forked.

**Milestone 3 — Local database/runtime lifecycle**
Entry: M2. Exit: first launch initializes a private PostgreSQL 17 cluster, applies migrations, and the
app survives restart/update with data intact; no Docker, no user Postgres, no `.env`.

**Milestone 4 — Windows installer + pipeline**
Entry: M3. Exit: CI produces an NSIS x64 installer from a tagged build; install/uninstall work; logs
and data locations documented; signing wired and verified where a certificate exists.

**Milestone 5 — Clean-machine test**
Entry: M4. Exit: on a fresh Windows VM, download → install → onboard → AI test → import resume →
tailor/analyze → track application → close/reopen with data intact, all recorded.

**Milestone 6 — Documentation and error polish**
Entry: M5 findings. Exit: README has distinct "Download RoleSpec" and "Run it yourself" paths, AI
requirement stated accurately, onboarding errors reviewed against real failures, support/log guidance
published.

---

## Explicit non-goals

- No managed AI service, no hidden proxy, no "AI-free" marketing.
- No auto-apply and no CAPTCHA/auth bypass.
- No SQLite fork or desktop-only schema.
- No weakening of encrypted credential storage, ownership checks or grounding rules.
