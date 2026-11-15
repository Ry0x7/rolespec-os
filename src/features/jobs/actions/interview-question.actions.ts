"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { InterviewQuestionSource } from "@/generated/prisma/enums"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { rateLimited } from "@/shared/lib/errors"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import { generateInterviewQuestionsAI } from "../services/interview-questions-ai.service"

/** Sliding window for the per-user question generation. */
const QUESTIONS_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

/**
 * Generates likely interview questions for a tracked application and stores
 * them as AI_GENERATED rows. A regenerate replaces the previous AI rows and
 * leaves the SCRAPED ones (lifted from the posting itself) untouched.
 */
export async function generateInterviewQuestions(jobApplicationId: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = z.string().min(1).safeParse(jobApplicationId)
  if (!parsed.success) return { error: "Invalid input" }

  const userId = session.user.id

  try {
    // Each run is a full AI round trip and nothing else caps it, so the shared
    // rate_limit_attempts table carries the window.
    const questionsAllowed = await consumeRateLimit(
      RATE_LIMIT_BUCKETS.AI_INTERVIEW_QUESTIONS,
      userId,
      QUESTIONS_RATE_LIMIT,
    )
    if (!questionsAllowed) {
      const err = rateLimited("Too many question generations. Please wait a few minutes and try again.")
      return { error: err.message }
    }

    const job = await prisma.jobApplication.findUnique({
      where: { id: parsed.data, userId },
      select: {
        id: true,
        job: { select: { companyName: true, title: true, description: true } },
      },
    })
    if (!job) return { error: "Job application not found" }

    // The posting fields come off the `job` relation now; a missing relation
    // reads as an absent description, the same as an empty column did.
    const jobDescription = job.job.description
    if (!jobDescription?.trim()) {
      return { error: "Add a job description first — questions are generated from it." }
    }

    const questions = await generateInterviewQuestionsAI({
      userId: session.user.id,
      job: {
        companyName: job.job.companyName,
        jobTitle: job.job.title,
        jobDescription,
      },
    })

    if (questions.length === 0) {
      return { error: "Couldn't generate questions. Please try again." }
    }

    await prisma.$transaction([
      prisma.interviewQuestion.deleteMany({
        where: { jobApplicationId: job.id, source: InterviewQuestionSource.AI_GENERATED },
      }),
      prisma.interviewQuestion.createMany({
        data: questions.map((question) => ({
          jobApplicationId: job.id,
          question,
          source: InterviewQuestionSource.AI_GENERATED,
        })),
      }),
    ])

    revalidatePath(`/jobs/${job.id}`)
    return { success: true as const, count: questions.length }
  } catch (err) {
    // The key and daily-limit messages are actionable and safe to show; anything
    // else could carry provider/infra detail, so it stays generic.
    if (err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError) {
      return { error: err.message }
    }
    return { error: "Something went wrong. Please try again." }
  }
}
