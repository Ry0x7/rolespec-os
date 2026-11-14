import type { RankingProfile } from "../types"
import { prisma } from "@/shared/lib/prisma"

/**
 * The profile slice ranking reads. Deliberately a narrow select rather than
 * `loadCareerProfile`, which creates the singleton row lazily: ranking a saved
 * job must not be the thing that creates a profile.
 *
 * Only CONFIRMED evidence contributes query terms. Candidate education or
 * imported claims stay out until the user confirms them.
 */
export async function readRankingProfile(userId: string): Promise<RankingProfile> {
  const profile = await prisma.careerProfile.findUnique({
    where: { userId },
    select: {
      locations: true,
      openToRelocation: true,
      workModes: true,
      requiresSponsorship: true,
      experienceLevel: true,
      salaryMin: true,
      salaryMax: true,
      salaryPeriod: true,
      salaryCurrency: true,
      targetRoles: {
        where: { active: true },
        select: { title: true },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      },
      capabilities: { select: { name: true, confirmed: true } },
      evidence: {
        where: { status: "CONFIRMED" },
        select: { title: true, details: true },
      },
    },
  })

  return {
    targetRoleTitles: profile?.targetRoles.map((role) => role.title) ?? [],
    locations: profile?.locations ?? [],
    openToRelocation: profile?.openToRelocation ?? false,
    workModes: profile?.workModes ?? [],
    requiresSponsorship: profile?.requiresSponsorship ?? null,
    experienceLevel: profile?.experienceLevel ?? null,
    salaryMin: profile?.salaryMin ?? null,
    salaryMax: profile?.salaryMax ?? null,
    salaryPeriod: profile?.salaryPeriod ?? null,
    salaryCurrency: profile?.salaryCurrency ?? null,
    capabilities: profile?.capabilities ?? [],
    evidence: (profile?.evidence ?? []).map((entry) => ({
      title: entry.title,
      details: entry.details,
      confirmed: true,
    })),
  }
}
