/**
 * How a resume is named wherever a job has to pick one. Pure and dependency-free
 * on purpose: the resume picker (client) and the cover-letter page (server) both
 * read it, so the same resume never reads as two different things.
 */

export type ResumeTierVariant = "MASTER" | "ROLE_FAMILY" | "JOB_TAILORED"

export interface ResumeTier {
  variant: ResumeTierVariant
  /** JOB_TAILORED only: tailored to THIS application rather than another one. */
  forThisJob: boolean
}

/**
 * Which tier a resume belongs to, lowest number first in a list. The order is
 * how much this job should trust the resume: tailored for it, then the family
 * it belongs to, then the master, then someone else's tailoring.
 */
export function resumeTierRank(resume: ResumeTier): number {
  if (resume.variant === "JOB_TAILORED") return resume.forThisJob ? 0 : 3
  if (resume.variant === "ROLE_FAMILY") return 1
  if (resume.variant === "MASTER") return 2
  return 3
}

/** "Tailored for this job" — the phrase that disambiguates two similar titles. */
export function resumeTierLabel(resume: ResumeTier): string {
  if (resume.variant === "JOB_TAILORED") {
    return resume.forThisJob ? "Tailored for this job" : "Tailored (other job)"
  }
  if (resume.variant === "ROLE_FAMILY") return "Role family"
  return "Master"
}
