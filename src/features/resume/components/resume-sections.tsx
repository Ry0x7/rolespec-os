import type { ATSAnalysisMode, ResumeOrigin, ResumeSource } from "../hooks/use-resume-store"

export type ResumeVariant = "MASTER" | "ROLE_FAMILY" | "JOB_TAILORED"

export type ResumeCardData = {
  id: string
  title: string
  targetRole: string | null
  variant: ResumeVariant
  roleFamily: { name: string } | null
  jobApplication: { id: string; jobTitle: string; companyName: string } | null
  template: string
  atsScore: number | null
  latestAnalysis?: { mode: ATSAnalysisMode; overallScore: number } | null
  sourceResume?: ResumeSource | null
  origin?: ResumeOrigin | null
  updatedAt: Date
}

export interface ResumeSectionGroups {
  master: ResumeCardData[]
  roleFamily: ResumeCardData[]
  jobTailored: ResumeCardData[]
}

/**
 * Splits the flat resume list into the three canonical tiers, preserving the
 * incoming (updatedAt desc) order within each group.
 */
export function groupResumesByVariant(
  resumes: ResumeCardData[]
): ResumeSectionGroups {
  return {
    master: resumes.filter((resume) => resume.variant === "MASTER"),
    roleFamily: resumes.filter((resume) => resume.variant === "ROLE_FAMILY"),
    jobTailored: resumes.filter((resume) => resume.variant === "JOB_TAILORED"),
  }
}

/**
 * Groups role-family resumes by their family name, preserving each family's
 * first-seen order (which follows the incoming updatedAt desc order) and
 * putting resumes with no family under a trailing "Other" bucket.
 */
export function groupByRoleFamilyName(
  resumes: ResumeCardData[]
): Array<{ name: string; resumes: ResumeCardData[] }> {
  const order: string[] = []
  const buckets = new Map<string, ResumeCardData[]>()

  for (const resume of resumes) {
    const name = resume.roleFamily?.name ?? "Other"
    if (!buckets.has(name)) {
      order.push(name)
      buckets.set(name, [])
    }
    buckets.get(name)!.push(resume)
  }

  return order.map((name) => ({ name, resumes: buckets.get(name)! }))
}

/**
 * Heading, description and empty hint per tier, in display order. Rendered by
 * ResumeBrowser as one filtered, paged grid. Grouping is variant-only:
 * `sourceResumeId` is not recorded on older rows, so each card names its own
 * source instead of being nested under it.
 */
export const RESUME_VARIANT_SECTIONS: Array<{
  variant: ResumeVariant
  title: string
  description: string
  emptyHint: string
}> = [
  {
    variant: "MASTER",
    title: "Master resumes",
    description: "Your confirmed, source-of-truth resume for a given profile.",
    emptyHint:
      "No master resumes yet. Create one to start building role family and job-tailored variants.",
  },
  {
    variant: "ROLE_FAMILY",
    title: "Role family resumes",
    description: "Reusable variants tailored to a group of similar roles.",
    emptyHint:
      "No role family resumes yet. Create one from a master resume to reuse across similar roles.",
  },
  {
    variant: "JOB_TAILORED",
    title: "Job-tailored resumes",
    description: "Copies tailored to one tracked job application.",
    emptyHint:
      "No job-tailored resumes yet. Create one from a master or role family resume to tailor it to a tracked job.",
  },
]
