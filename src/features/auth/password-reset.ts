import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { prisma } from "@/shared/lib/prisma"

/**
 * Password reset tokens.
 *
 * There was no reset flow at all, so a customer who forgot their password was
 * permanently locked out of a paid account.
 *
 * Storage reuses the existing `VerificationToken` table rather than adding a
 * model, which keeps this migration-free — migrations here are applied by hand
 * (`docs/deploy-closed-beta.md` §2), so not needing one is a real advantage.
 * Rows are namespaced by an `identifier` prefix so reset tokens cannot be
 * confused with any other token that shares the table.
 *
 * Only the SHA-256 of the token is stored. A database leak then yields hashes
 * that cannot be replayed as reset links — the same reason passwords are hashed.
 * SHA-256 rather than bcrypt is correct here: the token is 32 bytes of CSPRNG
 * output, so there is no dictionary to attack and no need for a slow KDF.
 *
 * Server-only.
 */

/** Deliberately short. A reset link is a bearer credential for the account. */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000

export const PASSWORD_RESET_TTL_MINUTES = PASSWORD_RESET_TTL_MS / 60_000

const IDENTIFIER_PREFIX = "pwreset:"

/** Namespaces a user's reset tokens within the shared table. */
export function passwordResetIdentifier(userId: string): string {
  return `${IDENTIFIER_PREFIX}${userId}`
}

/** True for identifiers minted by this module. */
export function isPasswordResetIdentifier(identifier: string): boolean {
  return identifier.startsWith(IDENTIFIER_PREFIX)
}

/** Recovers the user id from an identifier produced by {@link passwordResetIdentifier}. */
export function userIdFromIdentifier(identifier: string): string | null {
  if (!isPasswordResetIdentifier(identifier)) return null
  const userId = identifier.slice(IDENTIFIER_PREFIX.length)
  return userId.length > 0 ? userId : null
}

/** 32 bytes, base64url — URL-safe so it can be a query parameter unencoded. */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex")
}

/**
 * Constant-time hash comparison, for callers that have both hashes in hand.
 * The lookup path below matches in the database and does not need this, but a
 * length check first is still required — `timingSafeEqual` throws on a mismatch.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex")
  const right = Buffer.from(b, "hex")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Mints a token for `userId` and returns the raw value — the only moment it
 * exists in plaintext. Any outstanding tokens for the same user are deleted
 * first, so requesting a second reset invalidates the first link rather than
 * leaving two live credentials.
 */
export async function createPasswordResetToken(userId: string): Promise<string> {
  const rawToken = generateResetToken()
  const identifier = passwordResetIdentifier(userId)

  await prisma.verificationToken.deleteMany({ where: { identifier } })
  await prisma.verificationToken.create({
    data: {
      identifier,
      token: hashResetToken(rawToken),
      expires: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  })

  return rawToken
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" }

/**
 * Validates a raw token and burns it.
 *
 * Single-use: the row is deleted before the caller changes the password, so a
 * link cannot be replayed even if the password update then fails. An expired row
 * is also deleted — it is spent either way, and leaving it would let a stale link
 * be probed repeatedly.
 *
 * `invalid` and `expired` are distinguished for the caller's copy only. Both are
 * safe to reveal: the token is unguessable, so telling someone their link expired
 * leaks nothing about whether an account exists.
 */
export async function consumePasswordResetToken(rawToken: string): Promise<ConsumeResult> {
  if (!rawToken || rawToken.length < 16) return { ok: false, reason: "invalid" }

  const row = await prisma.verificationToken.findUnique({
    where: { token: hashResetToken(rawToken) },
    select: { identifier: true, expires: true },
  })

  if (!row || !isPasswordResetIdentifier(row.identifier)) {
    return { ok: false, reason: "invalid" }
  }

  const userId = userIdFromIdentifier(row.identifier)
  if (!userId) return { ok: false, reason: "invalid" }

  await prisma.verificationToken.deleteMany({ where: { identifier: row.identifier } })

  if (row.expires.getTime() <= Date.now()) return { ok: false, reason: "expired" }

  return { ok: true, userId }
}

/** Housekeeping: drops expired reset rows. Safe to call from the existing cron. */
export async function pruneExpiredPasswordResetTokens(): Promise<number> {
  const { count } = await prisma.verificationToken.deleteMany({
    where: {
      identifier: { startsWith: IDENTIFIER_PREFIX },
      expires: { lt: new Date() },
    },
  })
  return count
}
