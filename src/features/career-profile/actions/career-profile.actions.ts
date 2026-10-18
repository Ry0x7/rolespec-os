"use server"

import { revalidatePath } from "next/cache"
import { WorkType } from "@/generated/prisma/enums"
import { prisma } from "@/shared/lib/prisma"
import {
  createRoleFamilySchema,
  createTargetRoleSchema,
  updateCareerPreferencesSchema,
  updateContactInfoSchema,
} from "../schemas/career-profile.schema"
import {
  CAREER_PROFILE_PATH,
  resolveOwnProfileId,
  trimToNull,
} from "./shared"

const WORK_MODES = Object.values(WorkType)

/** Locations are one per line in the form; blank lines are dropped. */
function parseLocations(raw: string | undefined): string[] {
  if (raw === undefined) return []
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 25)
}

export async function updateCareerPreferences(formData: FormData) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const raw = Object.fromEntries(formData)
  const parsed = updateCareerPreferencesSchema.safeParse({
    ...raw,
    // Checkbox groups arrive as repeated fields, which `Object.fromEntries`
    // collapses to the last one.
    workModes: formData
      .getAll("workModes")
      .filter((v): v is string => typeof v === "string")
      .filter((v): v is WorkType => (WORK_MODES as string[]).includes(v)),
  })
  if (!parsed.success) return { error: "Invalid input", details: parsed.error.flatten() }

  const data = parsed.data

  if (
    data.salaryMin !== undefined &&
    data.salaryMax !== undefined &&
    data.salaryMin > data.salaryMax
  ) {
    return { error: "Minimum salary cannot be higher than the maximum." }
  }

  try {
    await prisma.careerProfile.update({
      where: { id: owner.profileId },
      data: {
        experienceLevel: data.experienceLevel ? data.experienceLevel : null,
        locations: parseLocations(data.locations),
        openToRelocation: data.openToRelocation ?? false,
        workModes: data.workModes ?? [],
        workAuthorization: trimToNull(data.workAuthorization),
        requiresSponsorship:
          data.requiresSponsorship === "yes"
            ? true
            : data.requiresSponsorship === "no"
              ? false
              : null,
        salaryMin: data.salaryMin ?? null,
        salaryMax: data.salaryMax ?? null,
        salaryPeriod: data.salaryPeriod ? data.salaryPeriod : null,
        salaryCurrency: data.salaryCurrency ? data.salaryCurrency : undefined,
        careerGoals: trimToNull(data.careerGoals),
      },
    })

    revalidatePath(CAREER_PROFILE_PATH)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/**
 * The resume header block. Every field clears to null when submitted empty, so
 * removing a stale phone number is the same gesture as changing it.
 */
export async function updateContactInfo(formData: FormData) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const parsed = updateContactInfoSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: "Invalid input", details: parsed.error.flatten() }

  const data = parsed.data

  try {
    await prisma.careerProfile.update({
      where: { id: owner.profileId },
      data: {
        contactFullName: trimToNull(data.contactFullName),
        contactEmail: trimToNull(data.contactEmail),
        contactPhone: trimToNull(data.contactPhone),
        contactLocation: trimToNull(data.contactLocation),
        linkedinUrl: trimToNull(data.linkedinUrl),
        githubUrl: trimToNull(data.githubUrl),
        websiteUrl: trimToNull(data.websiteUrl),
      },
    })

    revalidatePath(CAREER_PROFILE_PATH)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function createRoleFamily(formData: FormData) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const parsed = createRoleFamilySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const existing = await prisma.careerRoleFamily.findFirst({
    where: { careerProfileId: owner.profileId, name: parsed.data.name },
    select: { id: true },
  })
  if (existing) return { error: "You already have a role family with that name." }

  try {
    await prisma.careerRoleFamily.create({
      data: {
        careerProfileId: owner.profileId,
        name: parsed.data.name,
        notes: trimToNull(parsed.data.notes),
      },
      select: { id: true },
    })

    revalidatePath(CAREER_PROFILE_PATH)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function deleteRoleFamily(id: string) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }
  if (!id) return { error: "Not found" }

  // Scoped delete: an id from another account matches zero rows.
  const result = await prisma.careerRoleFamily.deleteMany({
    where: { id, careerProfileId: owner.profileId },
  })
  if (result.count === 0) return { error: "Not found" }

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true as const }
}

export async function createTargetRole(formData: FormData) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const parsed = createTargetRoleSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const { title, roleFamilyId, priority } = parsed.data

  // A role family reference is only accepted when it belongs to this profile.
  let ownedRoleFamilyId: string | null = null
  if (roleFamilyId) {
    const family = await prisma.careerRoleFamily.findFirst({
      where: { id: roleFamilyId, careerProfileId: owner.profileId },
      select: { id: true },
    })
    if (!family) return { error: "That role family does not exist." }
    ownedRoleFamilyId = family.id
  }

  const existing = await prisma.careerTargetRole.findFirst({
    where: { careerProfileId: owner.profileId, title },
    select: { id: true },
  })
  if (existing) return { error: "That target role is already on your list." }

  try {
    await prisma.careerTargetRole.create({
      data: {
        careerProfileId: owner.profileId,
        title,
        roleFamilyId: ownedRoleFamilyId,
        priority: priority ?? 0,
      },
      select: { id: true },
    })

    revalidatePath(CAREER_PROFILE_PATH)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function setTargetRoleActive(id: string, active: boolean) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }
  if (!id) return { error: "Not found" }

  const result = await prisma.careerTargetRole.updateMany({
    where: { id, careerProfileId: owner.profileId },
    data: { active },
  })
  if (result.count === 0) return { error: "Not found" }

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true as const }
}

export async function deleteTargetRole(id: string) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }
  if (!id) return { error: "Not found" }

  const result = await prisma.careerTargetRole.deleteMany({
    where: { id, careerProfileId: owner.profileId },
  })
  if (result.count === 0) return { error: "Not found" }

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true as const }
}
