# Working on RoleSpec

RoleSpec is a private, single-owner job-search workspace. Follow the existing
Next.js/TypeScript feature layout; `src/app` contains routes, `src/features`
domain code, and `src/shared` common code. The extension is a separate package.

Read only the relevant code and docs. Current code, schema and tests outrank old
plans. Product boundaries are in `docs/ARCHITECTURE.md`, outstanding work in
`docs/ROADMAP.md`, and desktop operations in `docs/DESKTOP.md`.

- Preserve working workflows and make the smallest verifiable change.
- Scope user-owned resources to the resolved session user; never trust a body ID.
- Never turn a job description into evidence of the applicant's qualifications.
- All AI calls go through `src/shared/lib/ai-generate.ts`; reuse encrypted settings.
- Plain resume import must work without an AI provider and must not make AI calls.
- Keep one PostgreSQL schema and migration history. Never edit a shipped migration.
- Desktop builds use `.next-desktop`; do not overwrite a live dev server's `.next`.
- Do not commit secrets, resumes, tool caches, exports or staged desktop runtimes.
- Do not add planning diaries or duplicate project instructions.
- When subagents are authorized, use a lower-cost model for simple bounded tasks;
  reserve stronger models for difficult implementation, debugging and review.

Start with targeted tests. Before reporting completion run applicable checks:
`npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`. The extension and
desktop shell have separate checks documented in `CONTRIBUTING.md`. Report only
verification actually performed, and distinguish mocks from live provider tests.
