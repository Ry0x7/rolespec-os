"use server"

import { revalidatePath } from "next/cache"

import { Prisma } from "@/generated/prisma/client"
import { SearchAlertFrequency } from "@/generated/prisma/enums"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"

import {
  presetIdSchema,
  saveDiscoveryPresetSchema,
  type SaveDiscoveryPresetInput,
} from "./schema"

export type SaveDiscoveryPresetResult =
  | { success: true; id: string }
  | { error: string }

const DISCOVER_PATH = "/jobs/discover"
const GENERIC_ERROR = "Could not save this search. Please try again."

/**
 * One saved search, created or edited by its owner.
 *
 * Roles are explicit choices in the editor. A career-path role is never added
 * just because the user approved the career suggestion: the preset records the
 * separate `includeCareerPathRoles` opt-in, and the run re-checks the role's own
 * `discoveryEnabled` flag.
 */
export async function saveDiscoveryPreset(
  input: SaveDiscoveryPresetInput
): Promise<SaveDiscoveryPresetResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  const userId = session.user.id

  const parsed = saveDiscoveryPresetSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid saved search" }
  }
  const data = parsed.data

  try {
    if (data.id) {
      const updated = await prisma.discoverySearchPreset.updateMany({
        where: { id: data.id, userId },
        data: {
          name: data.name,
          roles: data.roles,
          keywords: data.keywords,
          includeCareerPathRoles: data.includeCareerPathRoles,
          alertFrequency: data.alertFrequency,
        },
      })
      if (updated.count === 0) return { error: "Saved search not found." }
      revalidatePath(DISCOVER_PATH)
      return { success: true, id: data.id }
    }

    const created = await prisma.discoverySearchPreset.create({
      data: {
        userId,
        name: data.name,
        roles: data.roles,
        keywords: data.keywords,
        includeCareerPathRoles: data.includeCareerPathRoles,
        alertFrequency: data.alertFrequency,
      },
      select: { id: true },
    })
    revalidatePath(DISCOVER_PATH)
    return { success: true, id: created.id }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "You already have a saved search with that name." }
    }
    return { error: GENERIC_ERROR }
  }
}

export async function setDiscoveryPresetAlert(
  presetId: string,
  frequency: SearchAlertFrequency
): Promise<{ success: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsedId = presetIdSchema.safeParse(presetId)
  if (!parsedId.success || !Object.values(SearchAlertFrequency).includes(frequency)) {
    return { error: "Invalid alert setting." }
  }

  const result = await prisma.discoverySearchPreset.updateMany({
    where: { id: parsedId.data, userId: session.user.id },
    data: { alertFrequency: frequency },
  })
  if (result.count === 0) return { error: "Saved search not found." }

  revalidatePath(DISCOVER_PATH)
  return { success: true }
}

export async function deleteDiscoveryPreset(
  presetId: string
): Promise<{ success: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsedId = presetIdSchema.safeParse(presetId)
  if (!parsedId.success) return { error: "Saved search not found." }

  await prisma.discoverySearchPreset.deleteMany({
    where: { id: parsedId.data, userId: session.user.id },
  })
  revalidatePath(DISCOVER_PATH)
  return { success: true }
}
