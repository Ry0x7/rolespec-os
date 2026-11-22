import { z } from "zod"

import { JobFeedbackVerdict } from "@/generated/prisma/enums"

export const setJobFeedbackSchema = z
  .object({
    postingKey: z.string().trim().min(1, "A posting key is required").max(2048),
    /** Optional; only accepted when the job belongs to the caller. */
    jobId: z.string().trim().min(1).max(64).nullable().optional(),
    title: z.string().trim().min(1).max(300),
    companyName: z.string().trim().min(1).max(300),
    url: z.string().trim().max(2048).nullable().optional(),
    verdict: z.nativeEnum(JobFeedbackVerdict).nullable(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()

export type SetJobFeedbackInput = z.infer<typeof setJobFeedbackSchema>
