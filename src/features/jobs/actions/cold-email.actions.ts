"use server"

import { z } from "zod"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { rateLimited } from "@/shared/lib/errors"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import { userFacingSignature } from "@/shared/lib/prompts/signature-visibility"
import { loadResumeTextForUser } from "../services/resume-text.service"
import { generateColdEmailAI } from "../services/cold-email.service"

/** Sliding window shared by every in-app email draft (application, cold, reply). */
const EMAIL_RATE_LIMIT = { max: 15, windowMs: 10 * 60 * 1000 }

export async function generateColdEmail(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const schema = z.object({
    jobApplicationId: z.string().min(1),
    resumeId: z.string().min(1).optional(),
    instructions: z.string().max(1000).optional(),
  })
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: "Invalid input" }
  const { jobApplicationId, resumeId, instructions } = parsed.data

  const userId = session.user.id

  try {
    // Each draft is a full AI round trip and nothing else caps it, so the shared
    // rate_limit_attempts table carries the window across all three email actions.
    const emailAllowed = await consumeRateLimit(
      RATE_LIMIT_BUCKETS.AI_JOB_EMAIL,
      userId,
      EMAIL_RATE_LIMIT
    )
    if (!emailAllowed) {
      const err = rateLimited("Too many email drafts. Please wait a few minutes and try again.")
      return { error: err.message }
    }

    const application = await prisma.jobApplication.findUnique({
      where: { id: jobApplicationId, userId },
      select: {
        notes: true,
        job: { select: { companyName: true, title: true, location: true } },
      },
    })
    if (!application) return { error: "Job application not found" }

    // Posting fields off the `job` relation; the user's notes stay on the
    // application.
    const job = {
      companyName: application.job.companyName,
      jobTitle: application.job.title,
      location: application.job.location,
      notes: application.notes,
    }

    const loaded = await loadResumeTextForUser(userId, resumeId)
    if (!loaded.ok) {
      return { error: loaded.reason === "RESUME_NOT_FOUND" ? "Resume not found" : "Create a resume first" }
    }

    const { subject, body, grounding, signature } = await generateColdEmailAI({
      userId,
      resumeText: loaded.resumeText,
      candidateName: loaded.candidateName,
      job,
      instructions,
    })

    // Same rule as the application email: `missing_name` never leaves the server.
    return {
      success: true as const,
      subject,
      body,
      grounding,
      signature: userFacingSignature(signature),
    }
  } catch (err) {
    // The key and daily-limit messages are actionable and safe to show; anything
    // else could carry provider/infra detail, so it stays generic.
    if (err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError) {
      return { error: err.message }
    }
    return { error: "Something went wrong. Please try again." }
  }
}
