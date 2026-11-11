"use server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import type { JsonValue } from "@/features/workflows/types"

export interface ResumeHistoryEntry {
  id: string
  kind: "TAILORING_APPLIED" | "MANUAL_EDIT" | "ROLLBACK" | "RESTORE"
  versionBefore: number
  versionAfter: number
  summary: string
  createdAt: string
}

export interface ResumeSnapshotEntry {
  id: string
  sourceResumeId: string
  sourceVersion: number
  hash: string
  capturedAt: string
  restoredAt: string | null
  restoreCount: number
}

export interface ResumeValidationEntry {
  id: string
  status: "PASS" | "NEEDS_REVIEW" | "FAIL"
  sourceHash: string | null
  report: JsonValue
  createdAt: string
}

export interface ResumeTailoringSummary {
  id: string
  status: string
  mode: string
  attempts: number
  createdAt: string
}

export interface ResumeHistory {
  resumeId: string
  version: number
  editEvents: ResumeHistoryEntry[]
  snapshots: ResumeSnapshotEntry[]
  latestValidation: ResumeValidationEntry | null
  tailoring: ResumeTailoringSummary | null
  requirements: JsonValue
}

/**
 * Read-only provenance for one owned resume. Snapshots deliberately omit their
 * payload: the history view needs version/hash/timestamps, while restoring uses
 * the server-side rollback action, which re-checks ownership itself.
 */
export async function getResumeHistory(
  resumeId: string
): Promise<{ data: ResumeHistory } | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Authentication required" }

  const resume = await prisma.resume.findFirst({
    where: {
      id: resumeId,
      userId: session.user.id,
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      version: true,
      editEvents: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          kind: true,
          versionBefore: true,
          versionAfter: true,
          summary: true,
          createdAt: true,
        },
      },
      snapshots: {
        orderBy: { capturedAt: "desc" },
        take: 20,
        select: {
          id: true,
          sourceResumeId: true,
          sourceVersion: true,
          hash: true,
          capturedAt: true,
          restoredAt: true,
          restoreCount: true,
        },
      },
      validations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          sourceHash: true,
          report: true,
          createdAt: true,
        },
      },
      tailoringRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          mode: true,
          attempts: true,
          requirementMap: true,
          createdAt: true,
        },
      },
    },
  })

  if (!resume) return { error: "Resume not found" }

  return {
    data: {
      resumeId: resume.id,
      version: resume.version,
      editEvents: resume.editEvents.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
      snapshots: resume.snapshots.map((snapshot) => ({
        ...snapshot,
        capturedAt: snapshot.capturedAt.toISOString(),
        restoredAt: snapshot.restoredAt ? snapshot.restoredAt.toISOString() : null,
      })),
      latestValidation: resume.validations[0]
        ? {
            ...resume.validations[0],
            report: resume.validations[0].report as JsonValue,
            createdAt: resume.validations[0].createdAt.toISOString(),
          }
        : null,
      tailoring: resume.tailoringRuns[0]
        ? {
            id: resume.tailoringRuns[0].id,
            status: resume.tailoringRuns[0].status,
            mode: resume.tailoringRuns[0].mode,
            attempts: resume.tailoringRuns[0].attempts,
            createdAt: resume.tailoringRuns[0].createdAt.toISOString(),
          }
        : null,
      requirements: (resume.tailoringRuns[0]?.requirementMap ?? []) as JsonValue,
    },
  }
}
