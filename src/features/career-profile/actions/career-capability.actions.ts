"use server"

import { revalidatePath } from "next/cache"
import { CareerEvidenceStatus } from "@/generated/prisma/enums"
import { prisma } from "@/shared/lib/prisma"
import {
  createCapabilitiesSchema,
  createCapabilitySchema,
  linkEvidenceCapabilitySchema,
} from "../schemas/career-profile.schema"
import {
  CAREER_PROFILE_PATH,
  parseDateInput,
  resolveOwnProfileId,
  trimToNull,
} from "./shared"
import type { CreateCapabilitiesResult } from "../types"

export async function createCapability(formData: FormData) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const parsed = createCapabilitySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const { name, category, selfAssessment, notes } = parsed.data

  const existing = await prisma.careerCapability.findFirst({
    where: { careerProfileId: owner.profileId, name },
    select: { id: true },
  })
  if (existing) return { error: "You already have that capability." }

  try {
    await prisma.careerCapability.create({
      data: {
        careerProfileId: owner.profileId,
        name,
        category: trimToNull(category),
        // Self-assessment is optional and is never treated as confirmation.
        selfAssessment: selfAssessment ? selfAssessment : null,
        notes: trimToNull(notes),
      },
      select: { id: true },
    })

    revalidatePath(CAREER_PROFILE_PATH)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/**
 * Bulk entry from one comma-separated field, so a user can paste a skill list
 * instead of submitting the form once per skill.
 *
 * Duplicates are filtered twice. Within the submission they are dropped
 * case-insensitively, and against what is already stored they are compared
 * case-insensitively too: `@@unique([careerProfileId, name])` backs
 * `skipDuplicates`, but that comparison is case-sensitive at the database
 * level, so "react" would otherwise slip past an existing "React".
 */
export async function createCapabilities(
  formData: FormData
): Promise<CreateCapabilitiesResult> {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const raw = formData.get("names")
  const submitted = typeof raw === "string" ? raw : ""
  const names: string[] = []
  const seen = new Set<string>()
  for (const part of submitted.split(",")) {
    const name = part.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }

  const parsed = createCapabilitiesSchema.safeParse({
    names,
    category: formData.get("category") ?? undefined,
    selfAssessment: formData.get("selfAssessment") ?? undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const existing = await prisma.careerCapability.findMany({
    where: { careerProfileId: owner.profileId },
    select: { name: true },
  })
  const existingKeys = new Set(existing.map((row) => row.name.toLowerCase()))
  const fresh = parsed.data.names.filter(
    (name) => !existingKeys.has(name.toLowerCase())
  )

  if (fresh.length === 0) {
    return { success: true as const, created: 0, skipped: parsed.data.names.length }
  }

  try {
    const result = await prisma.careerCapability.createMany({
      data: fresh.map((name) => ({
        careerProfileId: owner.profileId,
        name,
        category: trimToNull(parsed.data.category),
        // Self-assessment is optional and is never treated as confirmation.
        selfAssessment: parsed.data.selfAssessment ? parsed.data.selfAssessment : null,
      })),
      skipDuplicates: true,
    })

    revalidatePath(CAREER_PROFILE_PATH)
    return {
      success: true as const,
      created: result.count,
      skipped: parsed.data.names.length - result.count,
    }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/** Explicit confirmation toggle. There is no derived or computed strength. */
export async function setCapabilityConfirmed(id: string, confirmed: boolean) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }
  if (!id) return { error: "Not found" }

  const result = await prisma.careerCapability.updateMany({
    where: { id, careerProfileId: owner.profileId },
    data: { confirmed, confirmedAt: confirmed ? new Date() : null },
  })
  if (result.count === 0) return { error: "Not found" }

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true as const }
}

export async function deleteCapability(id: string) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }
  if (!id) return { error: "Not found" }

  const result = await prisma.careerCapability.deleteMany({
    where: { id, careerProfileId: owner.profileId },
  })
  if (result.count === 0) return { error: "Not found" }

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true as const }
}

/**
 * Links a capability to a piece of evidence. Both sides are re-read scoped to
 * the caller's own profile first, so a cross-user id on either side is refused
 * before any write — a relationship write is the one place where two ids meet
 * and is therefore checked twice.
 *
 * The evidence must additionally be CONFIRMED. An unconfirmed candidate (the
 * state a future resume import lands in) may be read, confirmed or deleted, but
 * it must not contribute depth, repetition, outcome or recency to a capability
 * before the user has vouched for it.
 */
export async function linkEvidenceToCapability(formData: FormData) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const parsed = linkEvidenceCapabilitySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const { evidenceId, capabilityId, depth, hasMeasuredOutcome, outcomeNote, lastUsedAt } =
    parsed.data

  const [evidence, capability] = await Promise.all([
    prisma.careerEvidence.findFirst({
      where: { id: evidenceId, careerProfileId: owner.profileId },
      select: { id: true, status: true },
    }),
    prisma.careerCapability.findFirst({
      where: { id: capabilityId, careerProfileId: owner.profileId },
      select: { id: true },
    }),
  ])
  if (!evidence || !capability) return { error: "Not found" }
  if (evidence.status !== CareerEvidenceStatus.CONFIRMED) {
    return { error: "Confirm that evidence before linking it to a capability." }
  }

  const existing = await prisma.careerEvidenceCapability.findFirst({
    where: { evidenceId: evidence.id, capabilityId: capability.id },
    select: { id: true },
  })
  if (existing) return { error: "That evidence is already linked." }

  try {
    await prisma.careerEvidenceCapability.create({
      data: {
        evidenceId: evidence.id,
        capabilityId: capability.id,
        depth,
        hasMeasuredOutcome: hasMeasuredOutcome ?? false,
        outcomeNote: trimToNull(outcomeNote),
        lastUsedAt: parseDateInput(lastUsedAt),
      },
      select: { id: true },
    })

    revalidatePath(CAREER_PROFILE_PATH)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function unlinkEvidenceFromCapability(id: string) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }
  if (!id) return { error: "Not found" }

  const result = await prisma.careerEvidenceCapability.deleteMany({
    where: { id, capability: { careerProfileId: owner.profileId } },
  })
  if (result.count === 0) return { error: "Not found" }

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true as const }
}
