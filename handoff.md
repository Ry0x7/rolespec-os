# Self-Hosted Open-Source Overhaul (2026-10-18)

Completed overhaul transforming RoleSpec into a clean, autonomous, self-hosted open-source operating system.

## Completed Tasks

1. **AI Providers**:
   - Enabled all 8 providers as first-class options in `/settings/ai`: `claude-code`, `codex-cli`, `ollama`, `lmstudio`, `openai`, `anthropic`, `deepseek`, and `google`.
   - Removed artificial non-admin locks, daily caps, and `ALLOW_SHARED_AI_PROVIDER` requirements.
   - Tailored UI guidance for zero-cost and CLI subscriptions (`claude setup-token`, `codex login`, local Ollama/LM Studio endpoints).

2. **Single-User Auto-Login & Auth Overhaul**:
   - Removed Google OAuth requirements and public sign-in barriers.
   - `auth()` and `requireUser()` automatically resolve to the primary local user (`owner@rolespec.local` / first DB user).
   - Removed proxy redirects off app routes; `/sign-in` and `/sign-up` redirect straight to `/dashboard`.

3. **Admin, License, and SaaS Removal**:
   - Removed all commercial license logic (`/activate`, `/settings/license`, `LicenseActivation` model, Ed25519 offline validation).
   - Removed multi-tenant admin panel (`/settings/admin/*`), admin elevation / sudo re-auth (`/admin-verify`, `admin-elevation.ts`), and audit logging.
   - Removed Sentry telemetry tracking across config and runtime.
   - Removed 6,349 lines of dead admin, license, and telemetry code.
   - Cleaned Prisma schema and regenerated client.

4. **Extension**:
   - `verifyApiToken` falls back to the local owner for unauthenticated requests, allowing seamless local extension connection without token prompts.
   - Defaulted extension host to `http://localhost:3100`.

## Verification Status

- `npx tsc --noEmit`: Clean (0 errors).
- `npm run lint`: Clean (0 errors, 0 warnings).
- `npm test`: Full test suite green (269 files, 4,616 tests passed).
- `npm run build`: Next.js production build succeeded with all 51 routes generated.
- Initial release commit updated on public clone and pushed to `Ry0x7/rolespec-os.git`.

## Next Action

- Ready for user use and local development.
