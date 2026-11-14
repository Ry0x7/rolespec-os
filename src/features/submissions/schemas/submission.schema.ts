import { z } from "zod"

export const submissionAttemptStatusSchema = z.enum([
  "STAGED",
  "SUBMITTED",
  "NOT_SUBMITTED",
  "ABANDONED",
])

export const createSubmissionAttemptSchema = z.object({
  jobApplicationId: z.string().trim().min(1).max(200),
  resumeId: z.string().trim().min(1).max(200).optional(),
  evidence: z.unknown().optional(),
})

export const confirmSubmissionAttemptSchema = z.object({
  submitted: z.boolean(),
  note: z.string().trim().max(2000).optional(),
})
