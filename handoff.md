# Desktop Distribution & First-Run Onboarding (2026-10-19)

## Current task

Make RoleSpec usable by non-developers without forking the architecture. The full proposal is in
`docs/DESKTOP_ONBOARDING_PROPOSAL.md`. Milestone 1 (in-app onboarding + AI detection/test) is done.
Milestones 2–6 (Tauri shell, local PostgreSQL lifecycle, Windows installer, clean-machine test,
docs polish) are not implemented.

## Verified facts

- The app is a Next.js server with Prisma/PostgreSQL. A desktop build must run the server; the
  existing `.next/standalone` output (Docker) is the intended artifact.
- SQLite is not viable without schema divergence: the schema uses PostgreSQL enums, `Json`,
  `@db.Text`, and `pg_advisory_xact_lock` for AI quota. Desktop will bundle PostgreSQL 17 instead.
- `ai-sdk-provider-codex-cli` bundles an old `@openai/codex` (0.144.6) and preferred it over the
  user's installed CLI (0.163.0). The bundled build rejected current ChatGPT-account models.
  Fixed: the provider now uses the installed CLI (`resolveInstalledCodexPath`) and follows
  `CODEX_CLI_MODEL` → `~/.codex/config.toml` top-level `model` → fallback `gpt-6.1-sol`.
- `/settings/ai` previously showed deployment config as "Active"; it now uses the per-user resolver.
- Onboarding now has 7 steps: welcome, capabilities/AI requirement/privacy, AI choice, real test,
  profile, resume, ready. AI setup reuses `UserAiSettings` + AES-256-GCM; no second credential path.
- Resume import is not embedded in the wizard. The step opens `/resumes` in a new tab and offers
  "Check again"; upload still runs through the existing `/api/resume/parse` AI path.

## Changed files

- `docs/DESKTOP_ONBOARDING_PROPOSAL.md` (new)
- `src/features/onboarding/constants/ai-setup.ts` (new)
- `src/features/onboarding/lib/provider-diagnostics.ts` (new)
- `src/features/onboarding/lib/ai-connection-test.ts` (new)
- `src/features/onboarding/services/ai-setup.service.ts` (new)
- `src/features/onboarding/actions/ai-setup.actions.ts` (new)
- `src/features/onboarding/components/ai-setup-panel.tsx`, `connection-result.tsx`,
  `onboarding-wizard.tsx`
- `src/app/onboarding/page.tsx`, `src/app/(app)/settings/ai/page.tsx`
- `src/shared/lib/ai-generate.ts`, `src/shared/lib/ai-provider.ts`,
  `src/shared/lib/ai-providers/{constants,codex-cli,codex-paths}.ts`,
  `src/features/settings/services/user-ai-settings.service.ts`
- Tests: `src/features/onboarding/**/__tests__`, `src/shared/lib/ai-providers/__tests__`,
  updated `src/shared/lib/__tests__/ai-provider.test.ts`
- `README.md` (two paths + honest AI requirement), `handoff.md`

## Verification (ran, not assumed)

- `npx tsc --noEmit`: pass.
- `npm run lint`: pass, 0 warnings.
- `npm test`: 273 files / 4,668 tests pass.
- `npm run build`: pass (all routes).
- Browser walkthrough against a scratch PostgreSQL 17 container: completed all 7 steps, finished at
  `/dashboard`, `/onboarding` now redirects to `/dashboard`, target role and AI choice persisted.
- Live AI test: Codex CLI path passed in 7.6s with `gpt-6.1-sol`; the earlier failure was captured
  as a specific model error, then fixed. `ai_usage_events` recorded both attempts.
- Fake-key/401, missing CLI, stopped local server, and missing model paths are unit-tested; they were
  not exercised against real accounts.

## Next action

Milestone 2: Tauri 2 shell that launches `.next/standalone` with a pinned Node runtime on Windows.
Do not build the installer before the local database lifecycle (M3) is designed and tested.

## Do not repeat

- Do not add SQLite or a second schema/migration history.
- Do not introduce a second AI credential store or read vendor auth files/tokens.
- Do not claim a downloadable desktop installer exists; none is published.
- Do not commit `.freebuff/` or the verification screenshots unless intentionally publishing docs.
