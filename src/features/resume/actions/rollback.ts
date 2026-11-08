"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { logger } from "@/shared/lib/logger"
import { computeResumeDiff, type ResumeComparison } from "../services/resume-diff.service"

const log = logger("resume-rollback")

export async function getTailoredResumeDiff(
  tailoredResumeId: string
): Promise<{ success: true; diff: ResumeComparison } | { success: false; error: string }> {
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

  const source = await prisma.resume.findFirst({
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
  })

  if (!source) return { success: false, error: "Source resume could not be found" }

  const diff = computeResumeDiff(
    source as unknown as Parameters<typeof computeResumeDiff>[0],
    tailored as unknown as Parameters<typeof computeResumeDiff>[1]
  )
  return { success: true, diff }
}

export async function rollbackTailoredResume(
  tailoredResumeId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: "Authentication required" }

  const tailored = await prisma.resume.findFirst({
    where: {
      id: tailoredResumeId,
      userId: session.user.id,
      variant: "JOB_TAILORED",
    },
    select: {
      id: true,
      title: true,
      sourceResumeId: true,
      jobApplicationId: true,
    },
  })

  if (!tailored || !tailored.sourceResumeId) {
    return {
      success: false,
      error: "Tailored resume or original source not found. Rollback requires an existing source resume.",
    }
  }

  const source = await prisma.resume.findFirst({
    where: { id: tailored.sourceResumeId, userId: session.user.id },
    select: {
      id: true,
      title: true,
      template: true,
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

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Delete existing sections of tailored resume
      await tx.resumeSection.deleteMany({
        where: { resumeId: tailored.id },
      })

      // 2. Clone sections and items from source resume
      for (const section of source.sections) {
        await tx.resumeSection.create({
          data: {
            resumeId: tailored.id,
            type: section.type,
            title: section.title,
            order: section.order,
            visible: section.visible,
            items: {
              create: section.items.map((item) => ({
                content: item.content as object,
                metadata: item.metadata === null ? undefined : item.metadata,
                order: item.order,
              })),
            },
          },
        })
      }

      // 3. Update resume timestamp and version
      await tx.resume.update({
        where: { id: tailored.id },
        data: {
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      })
    })

    log.info("Rolled back tailored resume to source resume content", {
      tailoredResumeId: tailored.id,
      sourceResumeId: source.id,
    })

    revalidatePath("/resumes")
    revalidatePath(`/resumes/${tailored.id}`)
    if (tailored.jobApplicationId) {
      revalidatePath(`/jobs/${tailored.jobApplicationId}`)
    }

    return { success: true }
  } catch (err) {
    log.error("Failed to rollback tailored resume", { err })
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to rollback tailored resume.",
    }
  }
}
