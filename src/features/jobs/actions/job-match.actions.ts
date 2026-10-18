"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/features/auth/config"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { rateLimited } from "@/shared/lib/errors"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import { serializeResumeForCoverLetter } from "../services/cover-letter.service"
import { analyzeJobMatchAI } from "../services/job-match.service"
import type { Section } from "@/features/resume/hooks/use-resume-store"

const log = logger("job-match-actions")

/** Sliding window for the per-user match analysis rate limit. */
const MATCH_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

export async function analyzeJobMatch(input: {
  jobApplicationId: string
  resumeId: string
}) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const schema = z.object({
    jobApplicationId: z.string().min(1),
    resumeId: z.string().min(1),
  })
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const { jobApplicationId, resumeId } = parsed.data
  const userId = session.user.id

  try {
    // ── Rate limit: max 10 match analyses per user per 10 minutes ──────────
    // Each run is a full AI round trip and nothing else caps it, so the shared
    // rate_limit_attempts table carries the window.
    const matchAllowed = await consumeRateLimit(
      RATE_LIMIT_BUCKETS.AI_JOB_MATCH,
      userId,
      MATCH_RATE_LIMIT
    )
    if (!matchAllowed) {
      const err = rateLimited("Too many match checks. Please wait a few minutes and try again.")
      return { error: err.message }
    }

    const row = await prisma.jobApplication.findUnique({
      where: { id: jobApplicationId, userId: session.user.id },
      select: {
        // `notes` is the user's own commentary, so it stays on the application.
        notes: true,
        job: { select: { companyName: true, title: true, description: true } },
      },
    })
    if (!row) return { error: "Job application not found" }

    // The posting fields come off the `job` relation now; the AI service still
    // takes the flat shape it always has.
    const job = {
      companyName: row.job.companyName,
      jobTitle: row.job.title,
      jobDescription: row.job.description,
      notes: row.notes,
    }
    if (!job.jobDescription && !job.notes) {
      return { error: "Add a job description first." }
    }

    const resume = await prisma.resume.findFirst({
      where: {
        id: resumeId,
        userId: session.user.id,
        status: { not: "ARCHIVED" },
      },
      include: {
        sections: {
          include: { items: { orderBy: { order: "asc" } } },
          orderBy: { order: "asc" },
        },
      },
    })
    if (!resume) return { error: "Resume not found" }

    const sections: Section[] = resume.sections.map((s) => ({
      id: s.id,
      resumeId: s.resumeId,
      type: s.type,
      title: s.title,
      order: s.order,
      visible: s.visible,
      items: s.items.map((i) => ({
        id: i.id,
        sectionId: i.sectionId,
        content: i.content as Record<string, unknown>,
        order: i.order,
      })),
    }))

    const resumeText = serializeResumeForCoverLetter(sections)
    const result = await analyzeJobMatchAI({
      userId,
      resumeText,
      job,
    })

    // Persisted so the panel survives a remount — it used to live only in
    // component state, so navigating away threw the analysis away. Only the
    // verdict is stored: never the resume text it was derived from.
    try {
      await prisma.jobApplication.update({
        where: { id: jobApplicationId, userId },
        data: {
          matchScore: result.matchScore,
          matchResult: {
            summary: result.summary,
            matchedKeywords: result.matchedKeywords,
            missingKeywords: result.missingKeywords,
            suggestions: result.suggestions,
          },
          matchResumeId: resumeId,
          matchCheckedAt: new Date(),
        },
      })
      revalidatePath(`/jobs/${jobApplicationId}`)
      revalidatePath("/jobs")
    } catch (err) {
      // Best effort: the user already paid for the analysis, so a failed write
      // must not turn a good result into an error toast.
      log.warn("Failed to persist job match result", { err, jobId: jobApplicationId })
    }

    return { success: true as const, ...result }
  } catch (err) {
    // The key and daily-limit messages are actionable and safe to show; anything
    // else could carry provider/infra detail, so it stays generic.
    if (err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError) {
      return { error: err.message }
    }
    return { error: "Something went wrong. Please try again." }
  }
}
