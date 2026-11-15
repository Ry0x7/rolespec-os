"use server"

import { z } from "zod"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { rateLimited } from "@/shared/lib/errors"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"
import { userFacingSignature } from "@/shared/lib/prompts/signature-visibility"
import { loadResumeTextForUser } from "../services/resume-text.service"
import { generateFollowUpEmailAI, type FollowUpType } from "../services/follow-up-email.service"
import { recommendFollowUpSchedule } from "../services/follow-up-schedule.service"

const EMAIL_RATE_LIMIT = { max: 15, windowMs: 10 * 60 * 1000 }

export async function generateFollowUpEmail(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const schema = z.object({
    jobApplicationId: z.string().min(1),
    resumeId: z.string().min(1).optional(),
    followUpType: z.enum(["status_check", "post_interview_thank_you", "next_steps"]).optional(),
    instructions: z.string().max(1000).optional(),
  })

  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: "Invalid input" }
  const { jobApplicationId, resumeId, followUpType, instructions } = parsed.data

  const userId = session.user.id

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
    include: { job: true },
  })

  if (!application) return { error: "Job application not found" }

  const loaded = await loadResumeTextForUser(userId, resumeId)
  if (!loaded.ok) {
    return { error: loaded.reason === "RESUME_NOT_FOUND" ? "Resume not found" : "Create a resume first" }
  }

  const job = {
    companyName: application.job.companyName,
    jobTitle: application.job.title,
    location: application.job.location,
    contact: application.contact,
    notes: application.notes,
    status: application.status,
    dateApplied: application.dateApplied ? application.dateApplied.toISOString().slice(0, 10) : null,
    interviewDate: application.interviewDate ? application.interviewDate.toISOString().slice(0, 10) : null,
  }

  const result = await generateFollowUpEmailAI({
    userId,
    resumeText: loaded.resumeText,
    candidateName: loaded.candidateName,
    job,
    followUpType: followUpType as FollowUpType,
    instructions,
  })

  const scheduleAdvice = recommendFollowUpSchedule({
    status: application.status,
    dateApplied: application.dateApplied,
    interviewDate: application.interviewDate,
    deadline: application.job.deadline,
  })

  return {
    success: true as const,
    subject: result.subject,
    body: result.body,
    signature: userFacingSignature(result.signature),
    grounding: result.grounding,
    scheduleAdvice,
  }
}
