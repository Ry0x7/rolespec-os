import { prisma } from "@/shared/lib/prisma"

/**
 * Existence + ownership check that also rejects soft-deleted resumes.
 *
 * Delete is a soft delete (`Resume.status = "ARCHIVED"`), so an id stays
 * addressable after the user removes it. Callers that only need to know "may I
 * act on this resume?" use this; callers that fetch the resume row anyway add
 * `status: { not: "ARCHIVED" }` to their own where clause instead.
 *
 * Returns null for missing, foreign, and archived resumes alike so callers can
 * keep their existing not-found error copy.
 */
export async function requireLiveResume(
  resumeId: string,
  userId: string
): Promise<{ id: string } | null> {
  return prisma.resume.findFirst({
    where: { id: resumeId, userId, status: { not: "ARCHIVED" } },
    select: { id: true },
  })
}
