# syntax=docker/dockerfile:1

# Debian slim, not alpine: sharp 0.34.5 (transitive dep of the Next image
# optimizer) ships glibc prebuilds, and musl would force a source build.
ARG NODE_IMAGE=node:22-bookworm-slim

# ─────────────────────────────────────────────
# deps — node_modules only, cached on the lockfile
# ─────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# playwright is a runtime dependency of the local dev scripts only. Never pull
# ~500MB of browsers into a build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
# prisma/ and prisma.config.ts are needed at install time, not just at build
# time: the `postinstall` script runs `prisma generate`, which reads both.
# Generation needs no DATABASE_URL.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ─────────────────────────────────────────────
# builder — prisma client + Next standalone output
# Also the image used by the one-off `migrate` compose service, which needs
# the prisma CLI (a dependency, not a devDependency) and prisma/.
# ─────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Selects `output: "standalone"` in next.config.ts. Vercel never consumes
# .next/standalone, so the setting is gated on this flag rather than always on.
ENV DOCKER_BUILD=1

# NEXT_PUBLIC_* is inlined into the client bundle at build time, so it cannot be
# supplied at runtime — it has to be a build ARG.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

# Sentry source map upload self-disables without SENTRY_AUTH_TOKEN
# (see next.config.ts), so no Sentry secrets are required to build.
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
ENV SENTRY_ORG=${SENTRY_ORG}
ENV SENTRY_PROJECT=${SENTRY_PROJECT}

ENV NODE_ENV=production
RUN npm run build

# ─────────────────────────────────────────────
# runner — standalone server, non-root
# ─────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# WORKDIR is the standalone root on purpose: the PDF export resolves the Inter
# webfonts through `path.join(process.cwd(), "node_modules", "@fontsource", ...)`
# (src/features/export/templates/pdf/setup.ts), and output tracing places them
# under the standalone root. Running from anywhere else throws at export time.
WORKDIR /app

# `node` (uid 1000) ships with the base image.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Local export storage (used when BLOB_READ_WRITE_TOKEN is unset). Created here,
# owned by `node`, so the named volume mounted over it inherits that ownership
# on first use — otherwise Docker creates it root-owned and exports fail.
RUN mkdir -p /app/data/exports && chown node:node /app/data /app/data/exports

USER node

EXPOSE 3000

# curl/wget are absent from the slim image; node's global fetch is not.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
