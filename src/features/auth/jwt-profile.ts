import type { JWT } from "@auth/core/jwt"
import type { User } from "next-auth"
import { prisma } from "@/shared/lib/prisma"

/**
 * Max age of the role snapshot stored in the JWT. Server-side changes
 * (admin edits) have no client to call `useSession().update()`, so the token is
 * re-read from the DB once it is older than this on any session refetch.
 */
export const PROFILE_TTL_MS = 60_000

export function isProfileStale(token: JWT, now: number = Date.now()): boolean {
  const refreshedAt = token.profileRefreshedAt
  return typeof refreshedAt !== "number" || now - refreshedAt > PROFILE_TTL_MS
}

/** Stamp used when the account has never had a password change recorded. */
const NO_PASSWORD_CHANGE = 0

function passwordEpoch(changedAt: Date | null | undefined): number {
  return changedAt ? changedAt.getTime() : NO_PASSWORD_CHANGE
}

/** Version assumed for a token minted before `sessionVersion` existed. */
const INITIAL_SESSION_VERSION = 0

/**
 * Refreshes the token's profile snapshot from the DB. Returns false when the
 * session must end: the row is gone (the account was deleted), the user's
 * password changed after this token was minted, their `sessionVersion` no longer
 * matches (an explicit revocation), or the account is no longer ACTIVE
 * (suspended or disabled by an admin).
 * The caller must then invalidate the session instead of handing the refreshed
 * token back. On the sign-in path (`isSignIn`) there is nothing to compare
 * against for the stamps, but a missing or non-ACTIVE account is still refused.
 */
async function readProfileIntoToken(
  token: JWT,
  userId: string,
  { isSignIn = false }: { isSignIn?: boolean } = {}
): Promise<boolean> {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      status: true,
      passwordChangedAt: true,
      sessionVersion: true,
    },
  })

  // A deleted account has no row left to check, so the session ends here rather
  // than falling through to a "USER" snapshot that keeps passing `requireUser`
  // until the JWT max age. Returning false also means `profileRefreshedAt` is
  // never re-stamped, so nothing is cached as fine for the rest of the TTL.
  if (!dbUser) return false

  // Suspended and disabled accounts lose the session outright, on the sign-in
  // path too. The moderation action also bumps `sessionVersion`, so a token
  // still inside the TTL is killed by the version check on its next refresh
  // rather than waiting for this one.
  if (dbUser.status !== "ACTIVE") return false

  const dbStamp = passwordEpoch(dbUser.passwordChangedAt)
  const tokenStamp =
    typeof token.passwordStampedAt === "number" ? token.passwordStampedAt : NO_PASSWORD_CHANGE
  if (!isSignIn && dbStamp > tokenStamp) return false

  const dbVersion = dbUser.sessionVersion ?? INITIAL_SESSION_VERSION
  const tokenVersion =
    typeof token.sessionVersion === "number" ? token.sessionVersion : INITIAL_SESSION_VERSION
  if (!isSignIn && dbVersion !== tokenVersion) return false

  token.role = dbUser.role ?? "USER"
  token.passwordStampedAt = dbStamp
  token.sessionVersion = dbVersion
  token.profileRefreshedAt = Date.now()
  return true
}

/**
 * Returns the refreshed token, or `null` when the session must end. Auth.js v5
 * treats a `null` return from the `jwt` callback as "clear the session cookies",
 * which is how a password change kicks older sessions out.
 *
 * Known limitation: a token refreshed less than `PROFILE_TTL_MS` ago is not
 * re-read, so invalidation lands up to 60s after the password change.
 */
export async function syncTokenProfile({
  token,
  user,
  trigger,
}: {
  token: JWT
  user?: User | null
  trigger?: string
}): Promise<JWT | null> {
  if (user) {
    // Sign-in path: this token is newer than any password change, so stamp the
    // current DB value in rather than comparing against it.
    token.id = user.id!
    return (await readProfileIntoToken(token, user.id!, { isSignIn: true })) ? token : null
  }
  if (trigger === "update") {
    return (await readProfileIntoToken(token, token.id as string)) ? token : null
  }
  if (token.id && isProfileStale(token)) {
    return (await readProfileIntoToken(token, token.id as string)) ? token : null
  }
  return token
}
