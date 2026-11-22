"use server"

import { revalidatePath } from "next/cache"
import { Prisma } from "@/generated/prisma/client"
import { resolveOwnProfileId } from "@/features/career-profile/actions/shared"
import { prisma } from "@/shared/lib/prisma"
import { CAREER_PATH_CATALOG } from "../data/occupations"

const CAREER_PROFILE_PATH = "/career-profile"
const UNKNOWN_ROLE_ERROR = "Unknown career path role."
const GENERIC_ERROR = "Something went wrong. Please try again."

export type ApproveCareerPathRoleResult =
  | { success: true; alreadyExists: boolean }
  | { error: string }

/**
 * Adds a catalogue role to the existing Target Roles list.
 *
 * Approval is intentionally a one-row write: it never edits evidence,
 * capabilities or capability links. A recommendation is a suggestion; only the
 * user's decision to target the role is persisted.
 */
export async function approveCareerPathRole(
  occupationId: string
): Promise<ApproveCareerPathRoleResult> {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  if (typeof occupationId !== "string") return { error: UNKNOWN_ROLE_ERROR }
  const id = occupationId.trim()
  if (id.length === 0 || id.length > 100) return { error: UNKNOWN_ROLE_ERROR }

  const occupation = CAREER_PATH_CATALOG.occupations.find((row) => row.id === id)
  if (!occupation) return { error: UNKNOWN_ROLE_ERROR }

  try {
    // The unique index is on the exact title, so an existing row is matched on
    // the canonical catalogue title rather than a user-typed variant.
    const existing = await prisma.careerTargetRole.findFirst({
      where: { careerProfileId: owner.profileId, title: occupation.title },
      select: { id: true },
    })
    if (existing) return { success: true, alreadyExists: true }

    const top = await prisma.careerTargetRole.findFirst({
      where: { careerProfileId: owner.profileId },
      orderBy: { priority: "desc" },
      select: { priority: true },
    })

    const family = CAREER_PATH_CATALOG.families.find(
      (row) => row.id === occupation.familyId
    )
    // Only link a family the profile already has. Creating one here would make
    // a recommendation quietly restructure the user's own taxonomy.
    const roleFamily = family
      ? await prisma.careerRoleFamily.findFirst({
          where: {
            careerProfileId: owner.profileId,
            name: family.label,
          },
          select: { id: true },
        })
      : null

    await prisma.careerTargetRole.create({
      data: {
        careerProfileId: owner.profileId,
        title: occupation.title,
        roleFamilyId: roleFamily?.id ?? null,
        priority: Math.min(999, (top?.priority ?? 0) + 1),
        // Approval adds the role to Target Roles; it does not opt the role into
        // discovery. Searching for it stays a separate, explicit decision.
        source: "CAREER_PATH",
        discoveryEnabled: false,
      },
      select: { id: true },
    })

    revalidatePath(CAREER_PROFILE_PATH)
    return { success: true, alreadyExists: false }
  } catch (error) {
    // Two tabs can approve the same role at once; the unique index decides, and
    // the losing request simply observes that the role is already there.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: true, alreadyExists: true }
    }
    return { error: GENERIC_ERROR }
  }
}
