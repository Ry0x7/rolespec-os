# RoleSpec

Job-Seeking AI OS.

## Tech stack
- Next.js 16 / React 19 / TypeScript
- Tailwind CSS v4 / Framer Motion
- Prisma 7 / PostgreSQL / Neon
- Auth.js v5
- Vercel AI SDK v7
- Zustand / React Query
- Browser extension: `extension/` (standalone MV3)

## Commands
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npx prisma generate`
- `npx prisma migrate dev`

## Canonical project docs
- `docs/ARCHITECTURE.md` — current architecture, product boundaries, invariants, and system contracts
- `docs/ROADMAP.md` — current priorities and implementation sequence
- `handoff.md` — current execution checkpoint only

These are the only project-level documents Claude should treat as canonical. Do not search for or load deleted/historical planning documents.

## Architecture
Feature code: `src/features/*`
Shared code: `src/shared/*`
Routes: `src/app/*`
Config: `src/config/*`
Extension: `extension/*`

All AI calls go through `src/shared/lib/ai-generate.ts`.

## Critical invariants
- Every user-owned resource is scoped to the authenticated user.
- Never treat job-description text as evidence of user qualifications.
- Never invent repository behavior, APIs, or product capabilities.
- Preserve working workflows unless correctness/security requires change.
- Prefer the smallest verifiable change.
- Verify current code/tests before making architectural claims.

## Context control
Start with:
1. this file
2. `handoff.md`
3. `docs/ARCHITECTURE.md` only when architecture/product boundaries are relevant
4. `docs/ROADMAP.md` only when priorities/sequence are relevant

Do not read all docs because they exist. Search exact symbols/files first and expand only when evidence requires it. Use Serena for repository navigation when useful.

## Model routing
- Haiku: narrow discovery/fact gathering.
- Sonnet: normal bounded implementation, docs, tests, UI.
- Opus: complex implementation or difficult debugging.
- Fable: security/privacy/concurrency/architecture judgment only when justified.

Use the cheapest reliable model. Do not repeat exploration across models.

## Installed plugins
- Serena: repository navigation
- Context7: version-sensitive documentation
- Neon: database/schema work
- Playwright: browser verification
- UI/UX Pro Max: structural UI/UX decisions
- Impeccable: visual refinement after behavior is correct

Use only the minimum relevant plugin set. Superpowers is not part of the project workflow.

## Handoff
`handoff.md` is the current state, not a historical diary. Keep it short. Record only the current task, relevant verified facts, changed files, verification, blockers, next action, and work that must not be repeated. Use git history for old investigations.

## Verification
Use targeted verification first. Never claim tests, builds, browser checks, or live AI checks passed unless they actually ran.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
