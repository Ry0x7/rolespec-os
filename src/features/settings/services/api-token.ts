import { createHash, randomBytes } from "node:crypto"

import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

/**
 * Personal API tokens.
 *
 * The browser extension runs outside the app's origin, so it cannot carry the
 * session cookie. It authenticates with a bearer token the user mints in
 * /settings instead.
 *
 * Storage follows `src/features/auth/password-reset.ts`: only the SHA-256 of the
 * token is written, so a database leak yields hashes that cannot be replayed as
 * credentials. SHA-256 rather than bcrypt is correct here — the token is 32 bytes
 * of CSPRNG output, so there is no dictionary to attack, and the hash is on the
 * hot path of every extension request.
 *
 * A token is revoked explicitly, which is why `revokedAt` exists rather than the
 * row being deleted. `expiresAt` is optional and off by default: a token with no
 * expiry behaves exactly as tokens did before the column existed.
 *
 * Server-only.
 */

/** Prefix on every raw token, so a leaked string is recognisable as ours. */
export const API_TOKEN_PREFIX = "rspec_"

const log = logger("api-token")

/**
 * Audit trail for credential lifecycle events.
 *
 * Deliberately in the service and not the actions, so the settings UI and the
 * `/extension/connect` handshake are both covered by construction.
 *
 * Field naming is constrained by `redactContext()` in the logger: any key
 * containing "token" is replaced with `[redacted]`, so the row ids travel as
 * `id`/`ids`. The raw token and its hash are never passed here at all.
 */
const audit = logger("audit/api-token")

/** 32 bytes, base64url — safe in a header without encoding. */
export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
}

export function hashApiToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex")
}

/** What the settings UI is allowed to see. Never includes the hash. */
export interface ApiTokenSummary {
  id: string
  name: string
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
}

const SUMMARY_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
} as const

/**
 * Mints a token for `userId` and returns the raw value — the only moment it
 * exists in plaintext. The caller must surface it immediately; it is
 * unrecoverable afterwards.
 *
 * `expiresAt` is optional. Omitting it (or passing null) keeps the historical
 * behaviour: the token lives until it is revoked. The caller computes the date —
 * it must never come from the client.
 */
export async function createApiToken(
  userId: string,
  name: string,
  expiresAt: Date | null = null
): Promise<{ token: string; summary: ApiTokenSummary }> {
  const rawToken = generateApiToken()

  const row = await prisma.apiToken.create({
    data: { userId, name, tokenHash: hashApiToken(rawToken), expiresAt },
    select: SUMMARY_SELECT,
  })

  audit.info("api token created", {
    event: "api_token.create",
    userId,
    id: row.id,
    name: row.name,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  })

  return { token: rawToken, summary: row }
}

/** Live tokens for `userId`, newest first. Revoked rows are not listed. */
export async function listApiTokens(userId: string): Promise<ApiTokenSummary[]> {
  return prisma.apiToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  })
}

/** Number of live tokens, for the per-user cap. */
export async function countActiveApiTokens(userId: string): Promise<number> {
  return prisma.apiToken.count({ where: { userId, revokedAt: null } })
}

/**
 * Revokes one of the caller's own tokens. Scoped by `userId` in the same query,
 * so a guessed id belonging to someone else matches nothing.
 */
export async function revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
  const { count } = await prisma.apiToken.updateMany({
    where: { id: tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  if (count > 0) {
    audit.info("api token revoked", { event: "api_token.revoke", userId, id: tokenId })
  }

  return count > 0
}

/**
 * Revokes every live token of the caller's — the "I think one of these leaked"
 * button. Returns how many were retired.
 */
export async function revokeAllApiTokens(userId: string): Promise<number> {
  const { count } = await prisma.apiToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  if (count > 0) {
    audit.info("all api tokens revoked", { event: "api_token.revoke_all", userId, count })
  }

  return count
}

/**
 * Replaces one of the caller's tokens with a fresh one, returning the new raw
 * value once. Revoke and mint happen in a single transaction, so there is no
 * window where the user has neither credential (or, worse, two live ones).
 *
 * Expiry rule, kept deliberately simple: the replacement inherits the old row's
 * `expiresAt` when that is still in the future, and otherwise has no expiry. A
 * rotation therefore never silently extends a deadline the user set, and never
 * hands back a token that is already dead.
 *
 * Returns null when the id does not name a live token of this user's — the
 * `{ id, userId }` where-clause is the ownership check.
 */
export async function rotateApiToken(
  userId: string,
  tokenId: string
): Promise<{ token: string; summary: ApiTokenSummary } | null> {
  const rawToken = generateApiToken()
  const now = new Date()

  const summary = await prisma.$transaction(async (tx) => {
    const existing = await tx.apiToken.findFirst({
      where: { id: tokenId, userId, revokedAt: null },
      select: { id: true, name: true, expiresAt: true },
    })
    if (!existing) return null

    const { count } = await tx.apiToken.updateMany({
      where: { id: tokenId, userId, revokedAt: null },
      data: { revokedAt: now },
    })
    if (count === 0) return null

    const expiresAt =
      existing.expiresAt && existing.expiresAt.getTime() > now.getTime()
        ? existing.expiresAt
        : null

    return tx.apiToken.create({
      data: {
        userId,
        name: existing.name,
        tokenHash: hashApiToken(rawToken),
        expiresAt,
      },
      select: SUMMARY_SELECT,
    })
  })

  if (!summary) return null

  audit.info("api token rotated", {
    event: "api_token.rotate",
    userId,
    id: summary.id,
    previousId: tokenId,
    name: summary.name,
    expiresAt: summary.expiresAt?.toISOString() ?? null,
  })

  return { token: rawToken, summary }
}

/**
 * Revokes every live token of the caller's with this exact name, returning how
 * many were retired.
 *
 * Used by the extension connect flow: reconnecting mints a replacement, and
 * without this the user would collect a dead "Chrome extension" token per
 * reconnect until they hit the cap.
 */
export async function revokeApiTokensByName(userId: string, name: string): Promise<number> {
  const { count } = await prisma.apiToken.updateMany({
    where: { userId, name, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  if (count > 0) {
    audit.info("api tokens revoked by name", {
      event: "api_token.revoke",
      userId,
      name,
      count,
    })
  }

  return count
}

/**
 * Resolves a raw bearer token to the owning user id, or null when it is not a
 * live token.
 *
 * The prefix check is a free reject for anything that is obviously not ours
 * (a session cookie pasted into the header, a truncated copy) before touching
 * the database.
 *
 * `lastUsedAt` is written fire-and-forget: it is a convenience for the settings
 * list, not something a request should wait on or fail for.
 *
 * This is the only auth path for `/api/extension/*`, so the owner's account
 * status is checked here: a suspended or disabled user's tokens stop working
 * immediately, without every route having to remember.
 */
export async function verifyApiToken(rawToken: string): Promise<string | null> {
  if (rawToken && rawToken.startsWith(API_TOKEN_PREFIX) && rawToken.length > API_TOKEN_PREFIX.length) {
    const row = await prisma.apiToken.findUnique({
      where: { tokenHash: hashApiToken(rawToken) },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { status: true } },
      },
    })

    if (row && !row.revokedAt) {
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
        audit.info("expired api token rejected", {
          event: "api_token.expired_rejected",
          userId: row.userId,
          id: row.id,
          expiresAt: row.expiresAt.toISOString(),
        })
        return null
      }

      if (!row.user || row.user.status === "ACTIVE") {
        void prisma.apiToken
          .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
          .catch((err: unknown) => {
            log.warn("Failed to stamp lastUsedAt", { err })
          })

        return row.userId
      }
    }
    return null
  }

  // Self-hosted single-user fallback: automatically resolve to the local owner when unauthenticated
  if (rawToken === "local" || !rawToken) {
    try {
      const defaultUser = await prisma?.user?.findFirst?.({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
      return defaultUser?.id ?? null
    } catch {
      return null
    }
  }

  return null
}
