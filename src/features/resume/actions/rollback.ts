"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { logger } from "@/shared/lib/logger"
import { SectionType } from "@/generated/prisma/enums"
import { computeResumeDiff, type ResumeComparison } from "../services/resume-diff.service"
import {
  parseSourceSnapshot,
  restoreSectionsFromSnapshot,
} from "../tailoring/snapshot"
import type { ResumeSectionSnapshot } from "../tailoring/types"

const log = logger("resume-rollback")

export type ResumeDiffResult =
  | {
      success: true
      diff: ResumeComparison
      /** Which revision the tailored copy was compared against. */
      comparedAgainst: "snapshot" | "live-source"
      sourceVersion?: number
    }
  | { success: false; error: string }

interface DiffSource {
  id: string
  title: string
  sections: Array<{
    type: string
    title: string
    items: Array<{ content: Record<string, unknown> }>
  }>
}

/**
 * Compares a tailored resume with the source revision it was generated from.
 * The snapshot is authoritative: editing the source afterwards must not make an
 * old tailoring look like it changed text the candidate never saw.
 */
export async function getTailoredResumeDiff(
  tailoredResumeId: string
): Promise<ResumeDiffResult> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: "Authentication required" }

  const tailored = await prisma.resume.findFirst({
    where: { id: tailoredResumeId, userId: session.user.id },
    select: {
      id: true,
      title: true,
      sourceResumeId: true,
      sections: {
        select: {
          type: true,
          title: true,
          items: {
            select: { content: true },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  })

  if (!tailored) return { success: false, error: "Tailored resume not found" }
  if (!tailored.sourceResumeId) {
    return { success: false, error: "Resume has no source resume to compare against" }
  }

  const snapshot = await prisma.resumeSnapshot.findFirst({
    where: { userId: session.user.id, resumeId: tailored.id },
    orderBy: { capturedAt: "desc" },
    select: { sourceVersion: true, payload: true },
  })
  const snapshotPayload = snapshot ? parseSourceSnapshot(snapshot.payload) : null

  let source: DiffSource | null = null
  let comparedAgainst: "snapshot" | "live-source" = "live-source"

  if (snapshotPayload) {
    source = {
      id: snapshotPayload.sourceResumeId,
      title: snapshotPayload.title,
      sections: snapshotPayload.sections,
    }
    comparedAgainst = "snapshot"
  } else {
    // Legacy rows predate snapshots. Comparing with the live source is the only
    // option, and the result says so rather than implying it is revision-exact.
    source = (await prisma.resume.findFirst({
      where: { id: tailored.sourceResumeId, userId: session.user.id },
      select: {
        id: true,
        title: true,
        sections: {
          select: {
            type: true,
            title: true,
            items: {
              select: { content: true },
              orderBy: { order: "asc" },
            },
          },
          orderBy: { order: "asc" },
        },
      },
    })) as unknown as DiffSource | null
  }

  if (!source) return { success: false, error: "Source resume could not be found" }

  const diff = computeResumeDiff(
    source as unknown as Parameters<typeof computeResumeDiff>[0],
    tailored as unknown as Parameters<typeof computeResumeDiff>[1]
  )
  return {
    success: true,
    diff,
    comparedAgainst,
    ...(snapshotPayload ? { sourceVersion: snapshotPayload.sourceVersion } : {}),
  }
}

/**
 * Restores a tailored resume from the immutable snapshot taken when it was
 * generated. Editing the source resume afterwards no longer changes what a
 * rollback restores — that is the whole point of the snapshot.
 *
 * `snapshotId` selects a specific captured revision. Without it the newest
 * snapshot for this resume is used. Legacy tailored resumes that predate
 * snapshots fall back to the live source, and the result says so explicitly.
 */
export async function rollbackTailoredResume(
  tailoredResumeId: string,
  snapshotId?: string
): Promise<
  | {
      success: true
      restoredFrom: "snapshot" | "live-source"
      snapshotId?: string
      sourceVersion?: number
    }
  | { success: false; error: string }
> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: "Authentication required" }

  const tailored = await prisma.resume.findFirst({
    where: {
      id: tailoredResumeId,
      userId: session.user.id,
      variant: "JOB_TAILORED",
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      title: true,
      version: true,
      sourceResumeId: true,
      jobApplicationId: true,
    },
  })

  if (!tailored || !tailored.sourceResumeId) {
    return {
      success: false,
      error:
        "Tailored resume or original source not found. Rollback requires an existing source resume.",
    }
  }

  const snapshot = await prisma.resumeSnapshot.findFirst({
    where: {
      userId: session.user.id,
      resumeId: tailored.id,
      ...(snapshotId ? { id: snapshotId } : {}),
    },
    orderBy: { capturedAt: "desc" },
    select: {
      id: true,
      sourceVersion: true,
      payload: true,
    },
  })

  const snapshotPayload = snapshot ? parseSourceSnapshot(snapshot.payload) : null

  let sections: ResumeSectionSnapshot[]
  let restoredFrom: "snapshot" | "live-source"

  if (snapshot && snapshotPayload) {
    sections = restoreSectionsFromSnapshot(snapshotPayload)
    restoredFrom = "snapshot"
  } else {
    // Legacy path: no snapshot was captured for this resume. Restoring the
    // live source is still better than refusing, but the caller is told the
    // restore is not revision-specific.
    const source = await prisma.resume.findFirst({
      where: {
        id: tailored.sourceResumeId,
        userId: session.user.id,
        status: { not: "ARCHIVED" },
      },
      select: {
        id: true,
        sections: {
          select: {
            type: true,
            title: true,
            order: true,
            visible: true,
            items: {
              select: { content: true, metadata: true, order: true },
              orderBy: { order: "asc" },
            },
          },
          orderBy: { order: "asc" },
        },
      },
    })

    if (!source) {
      return { success: false, error: "Original source resume is missing or deleted." }
    }
    sections = source.sections.map((section) => ({
      type: section.type,
      title: section.title,
      order: section.order,
      visible: section.visible,
      items: section.items.map((item) => ({
        content: item.content as Record<string, unknown>,
        ...(item.metadata === undefined || item.metadata === null
          ? {}
          : { metadata: item.metadata }),
        order: item.order,
      })),
    }))
    restoredFrom = "live-source"
  }

  try {
    const newVersion = await prisma.$transaction(async (tx) => {
      await tx.resumeSection.deleteMany({ where: { resumeId: tailored.id } })

      for (const section of sections) {
        await tx.resumeSection.create({
          data: {
            resumeId: tailored.id,
            type: section.type as SectionType,
            title: section.title,
            order: section.order,
            visible: section.visible,
            items: {
              create: section.items.map((item) => ({
                content: item.content as object,
                ...(item.metadata === undefined || item.metadata === null
                  ? {}
                  : { metadata: item.metadata as object }),
                order: item.order,
              })),
            },
          },
        })
      }

      const updated = await tx.resume.update({
        where: { id: tailored.id, userId: session.user.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      })

      if (snapshot && snapshotPayload) {
        await tx.resumeSnapshot.updateMany({
          where: { id: snapshot.id, userId: session.user.id, resumeId: tailored.id },
          data: { restoredAt: new Date(), restoreCount: { increment: 1 } },
        })
      }

      await tx.resumeEditEvent.create({
        data: {
          resumeId: tailored.id,
          userId: session.user.id,
          kind: "ROLLBACK",
          versionBefore: tailored.version,
          versionAfter: updated.version,
          summary:
            restoredFrom === "snapshot"
              ? `Restored source revision ${snapshot?.sourceVersion ?? "unknown"}`
              : "Restored the live source resume (legacy, no snapshot)",
          metadata: {
            restoredFrom,
            snapshotId: snapshot?.id ?? null,
            sourceResumeId: tailored.sourceResumeId,
            sourceVersion: snapshot?.sourceVersion ?? null,
          },
        },
      })

      return updated.version
    })

    log.info("Restored tailored resume", {
      tailoredResumeId: tailored.id,
      restoredFrom,
      snapshotId: snapshot?.id,
      version: newVersion,
    })

    revalidatePath("/resumes")
    revalidatePath(`/resumes/${tailored.id}`)
    if (tailored.jobApplicationId) {
      revalidatePath(`/jobs/${tailored.jobApplicationId}`)
    }

    return {
      success: true,
      restoredFrom,
      ...(snapshot ? { snapshotId: snapshot.id } : {}),
      ...(snapshotPayload ? { sourceVersion: snapshotPayload.sourceVersion } : {}),
    }
  } catch (err) {
    log.error("Failed to rollback tailored resume", { err })
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to rollback tailored resume.",
    }
  }
}
