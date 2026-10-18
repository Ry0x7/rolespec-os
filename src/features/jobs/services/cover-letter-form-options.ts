import { prisma } from "@/shared/lib/prisma"
import { recommendResumeForJob, type ResumeChoiceOption } from "./resume-choice.service"
import { resumeTierLabel } from "./resume-tier"

/** Only id/title/atsScore ever reach the client form. */
export interface CoverLetterResumeOption {
  id: string
  title: string
  atsScore: number | null
}

export interface CoverLetterApplicationOption {
  id: string
  companyName: string
  jobTitle: string
  hasJobDescription: boolean
}

export interface CoverLetterFormOptions {
  resumes: CoverLetterResumeOption[]
  applications: CoverLetterApplicationOption[]
  lockedApplication: CoverLetterApplicationOption | null
  defaultResumeId?: string
  resumeHint: string | null
}

/**
 * The resume the form should start on, and the one line that justifies it when
 * it is a suggestion rather than the user's own stored choice. Pure, so the
 * job page can reuse it against the resume list it already loaded instead of
 * re-running the queries in `getCoverLetterFormOptions`.
 */
export function resolveCoverLetterResumeDefault({
  resumes,
  chosenResumeId,
  jobApplicationId,
  jobTitle,
}: {
  resumes: ResumeChoiceOption[]
  /** The resume the application already went with, if any. */
  chosenResumeId?: string | null
  /** Null outside the "opened for one job" case, where nothing is recommended. */
  jobApplicationId: string | null
  jobTitle: string | null
}): { defaultResumeId?: string; resumeHint: string | null } {
  // An archived/deleted chosen resume is not one of `resumes`, so it falls
  // through to the recommendation rather than selecting nothing.
  const chosenResume = chosenResumeId
    ? resumes.find((r) => r.id === chosenResumeId)
    : undefined

  // No explicit choice yet: the same deterministic recommendation the job page
  // makes, so the letter is not written against an unrelated resume by default.
  const recommendation =
    jobApplicationId && jobTitle && !chosenResume
      ? recommendResumeForJob({ resumes, jobApplicationId, jobTitle })
      : null
  const recommendedResume = recommendation
    ? resumes.find((r) => r.id === recommendation.resumeId)
    : undefined

  return {
    defaultResumeId: chosenResume?.id ?? recommendedResume?.id,
    // Shown only when the default is a suggestion rather than the user's own
    // choice — naming a tier the user picked themselves would be noise.
    resumeHint: recommendedResume
      ? `Recommended: ${recommendedResume.title} · ${resumeTierLabel({
          variant: recommendedResume.variant,
          forThisJob: recommendedResume.jobApplicationId === jobApplicationId,
        })}`
      : null,
  }
}

/**
 * Everything `CoverLetterForm` needs, for one user and optionally one job.
 * Shared by `/jobs/cover-letter/new` and the Job Detail drawer so both surfaces
 * preselect the same resume and word the hint the same way.
 *
 * `jobId` names the job this letter is for, so the picker gives way to a
 * context header. It is resolved against the user's own applications, so a
 * foreign or stale id simply falls through to the plain form.
 */
export async function getCoverLetterFormOptions(
  userId: string,
  jobId?: string,
): Promise<CoverLetterFormOptions> {
  const [resumes, applications] = await Promise.all([
    prisma.resume.findMany({
      where: { userId, status: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      // `variant`, `targetRole`, `jobApplicationId` and `updatedAt` ride along
      // for the recommendation; only id/title/atsScore reach the form.
      select: {
        id: true,
        title: true,
        atsScore: true,
        variant: true,
        targetRole: true,
        jobApplicationId: true,
        updatedAt: true,
      },
    }),
    prisma.jobApplication.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        resumeId: true,
        job: { select: { companyName: true, title: true, description: true } },
      },
    }),
  ])

  // Only the *availability* of a stored job description reaches the client —
  // the text itself stays server-side. The 20-char floor matches the action's
  // own minimum, so a too-short stored JD still asks for a manual paste.
  const resumeOptions = resumes.map(({ id, title, atsScore }) => ({
    id,
    title,
    atsScore,
  }))

  const applicationOptions = applications.map((a) => ({
    id: a.id,
    companyName: a.job.companyName,
    jobTitle: a.job.title,
    hasJobDescription: (a.job.description?.trim().length ?? 0) >= 20,
  }))

  const lockedApplication =
    (jobId && applicationOptions.find((a) => a.id === jobId)) || null
  const chosenResumeId = lockedApplication
    ? applications.find((a) => a.id === lockedApplication.id)?.resumeId
    : null

  const { defaultResumeId, resumeHint } = resolveCoverLetterResumeDefault({
    resumes,
    chosenResumeId,
    jobApplicationId: lockedApplication?.id ?? null,
    jobTitle: lockedApplication?.jobTitle ?? null,
  })

  return {
    resumes: resumeOptions,
    applications: applicationOptions,
    lockedApplication,
    defaultResumeId,
    resumeHint,
  }
}
