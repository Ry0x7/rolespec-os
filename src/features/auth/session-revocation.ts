import { prisma } from "@/shared/lib/prisma"

/**
 * Revokes every existing session for a user by bumping their `sessionVersion`.
 * Tokens carrying the old value fail the check in `jwt-profile.ts` on their next
 * refresh, which makes the `jwt` callback return null and clears the cookies.
 *
 * Same known lag as the password-change check: a token refreshed less than
 * `PROFILE_TTL_MS` ago is not re-read, so revocation lands up to 60s later.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  })
}
