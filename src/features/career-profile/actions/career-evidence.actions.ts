"use server"

import { revalidatePath } from "next/cache"
import {
  CareerEvidenceSource,
  CareerEvidenceStatus,
} from "@/generated/prisma/enums"
import { prisma } from "@/shared/lib/prisma"
import {
  createEvidenceSchema,
  updateEvidenceSchema,
} from "../schemas/career-profile.schema"
import {
  CAREER_PROFILE_PATH,
  parseDateInput,
  resolveOwnProfileId,
  trimToNull,
} from "./shared"

export async function createEvidence(formData: FormData) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const parsed = createEvidenceSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const { kind, title, organization, details, outcome, startDate, endDate } = parsed.data

  const start = parseDateInput(startDate)
  const end = parseDateInput(endDate)
  if (start && end && end < start) {
    return { error: "The end date cannot be before the start date." }
  }

  try {
    await prisma.careerEvidence.create({
      data: {
        careerProfileId: owner.profileId,
        kind,
        title,
        organization: trimToNull(organization),
        details: trimToNull(details),
        outcome: trimToNull(outcome),
        startDate: start,
        endDate: end,
        // Provenance is server-decided, never taken from the request: anything
        // typed here by the signed-in user is first-party and therefore already
        // confirmed. Resume-origin rows are the only CANDIDATE source, and no
        // code path in this slice creates them.
        source: CareerEvidenceSource.USER_ENTERED,
        status: CareerEvidenceStatus.CONFIRMED,
        confirmedAt: new Date(),
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
 * Corrects the editable fields of a row the caller owns.
 *
 * `source`, `status` and `confirmedAt` are never written here: fixing a typo in
 * a confirmed row must not silently re-confirm it, and must not let a candidate
 * promote itself by being edited. `confirmEvidence` stays the only promotion.
 */
export async function updateEvidence(formData: FormData) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const parsed = updateEvidenceSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const { id, kind, title, organization, details, outcome, startDate, endDate } = parsed.data

  const start = parseDateInput(startDate)
  const end = parseDateInput(endDate)
  if (start && end && end < start) {
    return { error: "The end date cannot be before the start date." }
  }

  try {
    const result = await prisma.careerEvidence.updateMany({
      where: { id, careerProfileId: owner.profileId },
      data: {
        kind,
        title,
        organization: trimToNull(organization),
        details: trimToNull(details),
        outcome: trimToNull(outcome),
        startDate: start,
        endDate: end,
      },
    })
    if (result.count === 0) return { error: "Not found" }

    revalidatePath(CAREER_PROFILE_PATH)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/**
 * The one and only way a CANDIDATE becomes CONFIRMED. It requires an explicit
 * user action on a row the user owns; nothing parses, imports or promotes
 * automatically.
 */
export async function confirmEvidence(id: string) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }
  if (!id) return { error: "Not found" }

  const result = await prisma.careerEvidence.updateMany({
    where: {
      id,
      careerProfileId: owner.profileId,
      status: CareerEvidenceStatus.CANDIDATE,
    },
    data: { status: CareerEvidenceStatus.CONFIRMED, confirmedAt: new Date() },
  })
  if (result.count === 0) return { error: "Not found" }

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true as const }
}

export async function deleteEvidence(id: string) {
  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }
  if (!id) return { error: "Not found" }

  const result = await prisma.careerEvidence.deleteMany({
    where: { id, careerProfileId: owner.profileId },
  })
  if (result.count === 0) return { error: "Not found" }

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true as const }
}
