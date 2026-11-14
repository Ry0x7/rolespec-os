# Generated desktop resources

This directory is populated by `npm run desktop:stage` (or `npm run desktop:build`):

- `app/` — the Next.js standalone server, static assets, public files and Prisma migrations
- `node/` — the pinned Node runtime shipped with the desktop app
- `prisma/` — the Prisma CLI, its dependencies, the schema and migration history
- `postgres/` — pinned PostgreSQL 17 binaries (fetched by `npm run desktop:postgres`)
- `manifest.json` — app version, Node version, platform and build timestamp

They are generated build outputs and are gitignored. Do not edit files here;
change the staging script instead.
