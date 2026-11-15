"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { JobRiskSource } from "@/generated/prisma/enums"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { rateLimited } from "@/shared/lib/errors"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import { updateJobApplicationWithJob } from "../services/job-record.service"
import { assessJobRiskAI } from "../services/job-risk-ai.service"

/** Sliding window for the per-user on-demand risk check. */
const RISK_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

/**
 * Runs the on-demand model assessment for a tracked application and replaces
 * whatever the create-time heuristics wrote. A `NONE` verdict clears the level
 * but still records that an AI check ran, so the UI can say "checked, looks
 * fine" rather than "never checked".
 */
export async function assessJobRisk(jobApplicationId: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = z.string().min(1).safeParse(jobApplicationId)
  if (!parsed.success) return { error: "Invalid input" }

  const userId = session.user.id

  try {
    // Each run is a full AI round trip and nothing else caps it, so the shared
    // rate_limit_attempts table carries the window.
    const riskAllowed = await consumeRateLimit(
      RATE_LIMIT_BUCKETS.AI_JOB_RISK,
      userId,
      RISK_RATE_LIMIT
    )
    if (!riskAllowed) {
      const err = rateLimited("Too many risk checks. Please wait a few minutes and try again.")
      return { error: err.message }
    }

    const job = await prisma.jobApplication.findUnique({
      where: { id: parsed.data, userId },
      select: {
        id: true,
        // `contact` is the user's own note about who to talk to, so it stays on
        // the application; everything else here describes the posting.
        contact: true,
        job: {
          select: {
            companyName: true,
            title: true,
            description: true,
            salary: true,
            salaryPeriod: true,
            url: true,
            location: true,
          },
        },
      },
    })
    if (!job) return { error: "Job application not found" }

    const jobDescription = job.job.description
    if (!jobDescription?.trim()) {
      return { error: "Add a job description first — the check is run against it." }
    }

    const { level, reasons } = await assessJobRiskAI({
      userId: session.user.id,
      job: {
        companyName: job.job.companyName,
        jobTitle: job.job.title,
        jobDescription,
        salary: job.job.salary,
        salaryPeriod: job.job.salaryPeriod,
        jobLink: job.job.url,
        contact: job.contact,
        location: job.job.location,
      },
    })

    // The verdict describes the posting, so the paired write stamps it on the
    // `Job` row too — otherwise job-based readers would keep the stale level.
    await updateJobApplicationWithJob(
      { id: job.id, userId },
      {
        riskLevel: level === "NONE" ? null : level,
        riskReasons: level === "NONE" ? [] : reasons,
        riskSource: JobRiskSource.AI,
        riskCheckedAt: new Date(),
      }
    )

    revalidatePath(`/jobs/${job.id}`)
    revalidatePath("/jobs")
    return { success: true as const, level, reasons }
  } catch (err) {
    // The key and daily-limit messages are actionable and safe to show; anything
    // else could carry provider/infra detail, so it stays generic.
    if (err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError) {
      return { error: err.message }
    }
    return { error: "Something went wrong. Please try again." }
  }
}
