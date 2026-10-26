"use server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { generateCoverLetterAI } from "@/features/jobs/services/cover-letter.service"
import { generateColdEmailAI } from "@/features/jobs/services/cold-email.service"
import { loadResumeTextForUser } from "@/features/jobs/services/resume-text.service"
import { logger } from "@/shared/lib/logger"

const log = logger("export/draft-artifacts")

export interface ArtifactDrafts {
  coverLetter: string
  outreachSubject: string
  outreachBody: string
}

export interface DraftArtifactsResult {
  data?: ArtifactDrafts
  /** Partial success: one draft generated, the other failed. */
  partial?: ArtifactDrafts
  error?: string
}

/**
 * One-click drafts for a tracked job application: a cover letter plus a
 * short outreach email, both grounded in the caller's resume.
 *
 * This is the *draft* step only — nothing is persisted. The jobs workspace
 * owns saving (cover-letter rows, application notes), so this action returns
 * text the caller can preview, edit, and save wherever they keep artifacts.
 * Generation reuses the jobs services verbatim, so prompt policy, grounding,
 * and AI usage accounting match the standalone pages exactly.
 */
export async function draftArtifactsForJob(
  jobApplicationId: string,
  options?: { resumeId?: string; instructions?: string }
): Promise<DraftArtifactsResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  if (!jobApplicationId) return { error: "Job application not found" }

  const application = await prisma.jobApplication.findUnique({
    where: { id: jobApplicationId, userId: session.user.id },
    select: {
      notes: true,
      job: {
        select: {
          companyName: true,
          title: true,
          location: true,
          description: true,
        },
      },
    },
  })
  if (!application) return { error: "Job application not found" }

  const loaded = await loadResumeTextForUser(
    session.user.id,
    options?.resumeId?.trim() || undefined
  )
  if (!loaded.ok) {
    return {
      error:
        loaded.reason === "RESUME_NOT_FOUND"
          ? "That resume couldn't be found. Pick another one and try again."
          : "Add a resume first — drafts are written from your saved details.",
    }
  }

  const jobDescription = application.job.description?.trim() ?? ""
  if (jobDescription.length < 20) {
    return {
      error:
        "That job has no usable description yet — open it and paste the posting first.",
    }
  }

  const instructions = options?.instructions?.trim().slice(0, 1000) || undefined

  try {
    const [coverLetter, outreach] = await Promise.all([
      generateCoverLetterAI(
        loaded.resumeText,
        jobDescription,
        session.user.id,
        loaded.candidateName
      ),
      generateColdEmailAI({
        userId: session.user.id,
        resumeText: loaded.resumeText,
        candidateName: loaded.candidateName,
        // Posting fields off the `job` relation; the user's notes stay on the
        // application — same mapping as the jobs cold-email action.
        job: {
          companyName: application.job.companyName,
          jobTitle: application.job.title,
          location: application.job.location,
          notes: application.notes,
        },
        ...(instructions ? { instructions } : {}),
      }),
    ])

    return {
      data: {
        coverLetter: coverLetter.coverLetter,
        outreachSubject: outreach.subject,
        outreachBody: outreach.body,
      },
    }
  } catch (error) {
    log.error("Artifact drafts failed", { error })
    if (error instanceof AiKeyRequiredError || error instanceof AiDailyLimitError) {
      return { error: error.message }
    }
    return { error: "Drafting failed. Please try again." }
  }
}
