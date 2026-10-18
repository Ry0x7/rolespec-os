"use server"

import { z } from "zod"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { MAX_ATS_JOB_DESCRIPTION_LENGTH } from "../constants/ats"

/**
 * Reads a saved job application's description for the resume editor's Job
 * Target panel. The text never ships with the page (only a `hasJobDescription`
 * flag does), so it is fetched on demand here and capped to the same limit the
 * storage/ATS path allows. Enhance clips further at its own point of use.
 */
export async function getJobDescriptionForResume(
  jobApplicationId: string
): Promise<{ jobDescription: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = z.string().min(1).safeParse(jobApplicationId)
  if (!parsed.success) return { error: "Invalid input" }

  const job = await prisma.jobApplication.findFirst({
    where: { id: parsed.data, userId: session.user.id },
    select: { job: { select: { description: true } } },
  })
  if (!job) return { error: "Job application not found" }

  const jobDescription = job.job.description?.trim() ?? ""
  if (!jobDescription) return { error: "This job has no description saved." }

  return { jobDescription: jobDescription.slice(0, MAX_ATS_JOB_DESCRIPTION_LENGTH) }
}
