import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"

export const CAREER_PROFILE_PATH = "/career-profile"

export const NO_PROFILE_ERROR =
  "Your career profile is not ready yet. Reload the page and try again."

/**
 * Resolves the signed-in user's own Career Profile id.
 *
 * Every mutation in this feature starts here, so a child id supplied by the
 * client is only ever used together with this profile id. A row belonging to
 * another account cannot match, which is what keeps a hand-crafted POST to a
 * Server Action from touching someone else's data.
 */
export async function resolveOwnProfileId(): Promise<
  { profileId: string } | { error: string }
> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const profile = await prisma.careerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!profile) return { error: NO_PROFILE_ERROR }

  return { profileId: profile.id }
}

/**
 * `<input type="date">` submits "" when cleared and `yyyy-mm-dd` otherwise.
 *
 * Callers must have validated the string with the schema's `calendarDate`
 * first; this only converts. It re-checks the round trip anyway rather than
 * trusting `new Date`, which rolls an impossible date forward instead of
 * failing, and builds the instant in UTC because the columns are `@db.Date`.
 */
export function parseDateInput(value: string | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null

  const [year, month, day] = match.slice(1).map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  const roundTrips =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day

  return roundTrips ? parsed : null
}

export function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
