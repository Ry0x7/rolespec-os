"use server"

import { revalidatePath } from "next/cache"

import {
  CareerEvidenceSource,
  CareerEvidenceStatus,
} from "@/generated/prisma/enums"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"

import { getOrCreateCareerProfileId } from "../services/career-profile.service"
import {
  capabilityKey,
  evidenceKey,
  mapResumeToCareerFacts,
} from "../services/import-resume.service"
import { CAREER_PROFILE_PATH } from "./shared"

export interface ResumeImportCounts {
  evidenceCreated: number
  evidenceSkipped: number
  capabilitiesCreated: number
  capabilitiesSkipped: number
}

export type ResumeImportResult =
  | { error: string }
  | ({ success: true; resumeTitle: string } & ResumeImportCounts)

/**
 * Imports one resume the caller owns into their Career Profile as unconfirmed
 * candidates. No AI, no auto-confirmation, and no cross-user access: the resume
 * is looked up with the session user id in the same query as its id.
 */
export async function importResumeToCareerProfile(
  formData: FormData
): Promise<ResumeImportResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const resumeId = String(formData.get("resumeId") ?? "").trim()
  if (!resumeId) return { error: "Choose a resume to import." }

  const resume = await prisma.resume.findFirst({
    where: { id: resumeId, userId: session.user.id },
    select: {
      id: true,
      title: true,
      sections: {
        orderBy: { order: "asc" },
        select: {
          type: true,
          title: true,
          order: true,
          items: {
            orderBy: { order: "asc" },
            select: { content: true, order: true },
          },
        },
      },
    },
  })
  if (!resume) return { error: "That resume does not exist." }

  const profileId = await getOrCreateCareerProfileId(session.user.id)
  const mapped = mapResumeToCareerFacts({
    resumeId: resume.id,
    resumeTitle: resume.title,
    sections: resume.sections,
  })

  try {
    const [existingEvidence, existingCapabilities] = await Promise.all([
      prisma.careerEvidence.findMany({
        where: { careerProfileId: profileId },
        select: { kind: true, title: true, organization: true },
      }),
      prisma.careerCapability.findMany({
        where: { careerProfileId: profileId },
        select: { name: true },
      }),
    ])

    const evidenceSeen = new Set(existingEvidence.map(evidenceKey))
    const freshEvidence = mapped.evidence.filter((row) => {
      const key = evidenceKey(row)
      if (evidenceSeen.has(key)) return false
      evidenceSeen.add(key)
      return true
    })

    const capabilitySeen = new Set(existingCapabilities.map((row) => capabilityKey(row.name)))
    const freshCapabilities = mapped.capabilities.filter((row) => {
      const key = capabilityKey(row.name)
      if (capabilitySeen.has(key)) return false
      capabilitySeen.add(key)
      return true
    })

    let evidenceCreated = 0
    if (freshEvidence.length > 0) {
      const result = await prisma.careerEvidence.createMany({
        data: freshEvidence.map((row) => ({
          careerProfileId: profileId,
          kind: row.kind,
          title: row.title,
          organization: row.organization,
          details: row.details,
          outcome: row.outcome,
          startDate: row.startDate,
          endDate: row.endDate,
          // The resume made the claim, so it is recorded as a document import
          // and stays a candidate until the user explicitly confirms it.
          source: CareerEvidenceSource.RESUME_IMPORT_CANDIDATE,
          status: CareerEvidenceStatus.CANDIDATE,
          metadata: row.metadata,
        })),
      })
      evidenceCreated = result.count
    }

    let capabilitiesCreated = 0
    if (freshCapabilities.length > 0) {
      const result = await prisma.careerCapability.createMany({
        data: freshCapabilities.map((row) => ({
          careerProfileId: profileId,
          name: row.name,
          category: row.category,
          // A skill written on a resume is a claim, not a self-assessment.
          confirmed: false,
        })),
        skipDuplicates: true,
      })
      capabilitiesCreated = result.count
    }

    if (evidenceCreated > 0 || capabilitiesCreated > 0) {
      revalidatePath(CAREER_PROFILE_PATH)
    }

    return {
      success: true,
      resumeTitle: resume.title,
      evidenceCreated,
      evidenceSkipped: mapped.evidence.length - evidenceCreated,
      capabilitiesCreated,
      capabilitiesSkipped: mapped.capabilities.length - capabilitiesCreated,
    }
  } catch {
    return { error: "The import failed. Please try again." }
  }
}
