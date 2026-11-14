import { prisma } from "@/shared/lib/prisma"

/**
 * The profile a qualification snapshot is taken against, read narrowly rather
 * than through `loadCareerProfile`, which creates the row lazily: neither a save
 * nor a re-check must be the thing that creates a profile.
 *
 * Shared rather than duplicated: the discovery save action and the job-detail
 * re-check both have to qualify against exactly the same slice, or the same
 * posting would get two different verdicts depending on where it was checked.
 * `discovery.actions` is a `"use server"` module and may only export async
 * functions, which is why this lives here.
 */
export function readQualificationProfileRow(userId: string) {
  return prisma.careerProfile.findUnique({
    where: { userId },
    select: {
      locations: true,
      openToRelocation: true,
      workModes: true,
      requiresSponsorship: true,
      experienceLevel: true,
      targetRoles: { select: { title: true, active: true } },
      capabilities: { select: { name: true, confirmed: true } },
    },
  })
}

/** What {@link readQualificationProfileRow} resolves to — null when unprofiled. */
export type QualificationProfileRow = Awaited<
  ReturnType<typeof readQualificationProfileRow>
>
