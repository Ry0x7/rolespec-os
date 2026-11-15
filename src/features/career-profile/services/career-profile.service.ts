import { prisma } from "@/shared/lib/prisma"

/**
 * The Career Profile is a per-user singleton, so it is created lazily on first
 * read rather than at sign-up — existing accounts are backfilled by the
 * migration, and a brand-new account gets its row the first time it opens the
 * workspace.
 */
export async function getOrCreateCareerProfileId(userId: string): Promise<string> {
  const existing = await prisma.careerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (existing) return existing.id

  const created = await prisma.careerProfile.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  })
  return created.id
}

/**
 * Resolves the profile id for a *write*. Returns null when the caller has no
 * profile, so an action can refuse instead of silently creating one.
 */
export async function findCareerProfileId(userId: string): Promise<string | null> {
  const profile = await prisma.careerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  return profile?.id ?? null
}

/**
 * Every child read/write goes through the owning profile's `userId`, never
 * through the child id alone — an id belonging to another account simply does
 * not match, so it behaves like "not found" rather than leaking or mutating.
 */
export async function loadCareerProfile(userId: string) {
  const id = await getOrCreateCareerProfileId(userId)

  return prisma.careerProfile.findFirstOrThrow({
    where: { id, userId },
    include: {
      roleFamilies: { orderBy: { name: "asc" } },
      targetRoles: {
        orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
      },
      evidence: {
        orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
        include: {
          capabilityLinks: {
            select: {
              id: true,
              capabilityId: true,
              depth: true,
              hasMeasuredOutcome: true,
              outcomeNote: true,
              lastUsedAt: true,
            },
          },
        },
      },
      capabilities: {
        orderBy: [{ confirmed: "desc" }, { name: "asc" }],
        include: {
          evidenceLinks: {
            select: {
              id: true,
              evidenceId: true,
              depth: true,
              hasMeasuredOutcome: true,
              outcomeNote: true,
              lastUsedAt: true,
              evidence: { select: { id: true, title: true, kind: true, status: true } },
            },
          },
        },
      },
    },
  })
}

export type LoadedCareerProfile = Awaited<ReturnType<typeof loadCareerProfile>>
