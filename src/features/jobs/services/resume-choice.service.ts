import { ResumeVariant } from "@/generated/prisma/enums"

/**
 * The one resume an application should be sent with, picked deterministically.
 * No AI and no scoring: the user has to be able to predict the answer, and a
 * wrong guess has to be one click away from being overridden.
 */

/** A resume as the recommendation sees it — the columns the rule reads, nothing else. */
export interface ResumeChoiceOption {
  id: string
  title: string
  variant: ResumeVariant
  targetRole: string | null
  /** Set when the resume was tailored *from* an application. */
  jobApplicationId: string | null
  updatedAt: Date
}

export interface ResumeRecommendation {
  resumeId: string
  /** One short phrase explaining the pick, shown next to the resume. */
  reason: string
}

/**
 * Seniority and filler words are dropped before matching, so a "Senior" resume
 * and a "Senior" posting do not count as a role-family match on that word
 * alone. Same intent as `ROLE_STOPWORDS` in the discovery qualifier, kept local
 * because that module does not export its tokenizer.
 */
const ROLE_STOPWORDS = new Set([
  "senior",
  "junior",
  "lead",
  "staff",
  "principal",
  "entry",
  "mid",
  "level",
  "sr",
  "jr",
  "intern",
  "the",
  "and",
  "for",
  "resume",
])

/** Tokens shorter than this carry no signal ("ai" is the price of dropping "of"). */
const MIN_TOKEN_LENGTH = 3

/**
 * Lowercased whole-token list with the stopwords removed. `+`, `#` and `.`
 * survive so "c++", "c#" and "node.js" stay single tokens.
 */
function meaningfulTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\.(?![a-z0-9])/g, "")
    .split(" ")
    .filter(
      (token) => token.length >= MIN_TOKEN_LENGTH && !ROLE_STOPWORDS.has(token)
    )
}

/** True when the two strings share at least one meaningful whole token. */
export function sharesRoleToken(a: string, b: string): boolean {
  const tokens = new Set(meaningfulTokens(a))
  return meaningfulTokens(b).some((token) => tokens.has(token))
}

/** Most recently updated first; ties keep the caller's order. */
function newestFirst(resumes: ResumeChoiceOption[]): ResumeChoiceOption[] {
  return [...resumes].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  )
}

/**
 * The resume to submit for a job, in a fixed four-tier order:
 *
 * 1. a resume already tailored to this application,
 * 2. a role-family resume whose title shares a word with the job title,
 * 3. the master resume,
 * 4. whatever was touched most recently.
 *
 * Returns null only when the user has no resumes at all.
 */
export function recommendResumeForJob({
  resumes,
  jobApplicationId,
  jobTitle,
}: {
  resumes: ResumeChoiceOption[]
  jobApplicationId: string
  jobTitle: string
}): ResumeRecommendation | null {
  const candidates = newestFirst(resumes)
  if (candidates.length === 0) return null

  const tailored = candidates.find(
    (resume) =>
      resume.variant === ResumeVariant.JOB_TAILORED &&
      resume.jobApplicationId === jobApplicationId
  )
  if (tailored) {
    return { resumeId: tailored.id, reason: "Tailored for this job" }
  }

  const roleFamily = candidates.find(
    (resume) =>
      resume.variant === ResumeVariant.ROLE_FAMILY &&
      sharesRoleToken(`${resume.title} ${resume.targetRole ?? ""}`, jobTitle)
  )
  if (roleFamily) {
    return { resumeId: roleFamily.id, reason: "Matches role family" }
  }

  const master = candidates.find(
    (resume) => resume.variant === ResumeVariant.MASTER
  )
  if (master) {
    return { resumeId: master.id, reason: "Master resume" }
  }

  return { resumeId: candidates[0].id, reason: "Most recently updated resume" }
}

/** A dialog source option: the id, plus the text tier 2 matches role tokens on. */
export interface TailorSourceOption {
  id: string
  title: string
  /** Master: target role. Role family: family name. */
  detail?: string | null
}

/**
 * Which resume the tailor dialog should open on, using the same tier-2 rule as
 * `recommendResumeForJob`: a role-family resume whose role tokens match the job
 * title, else the most recently updated master.
 *
 * Both lists arrive most-recently-updated first, so "first match" is "newest
 * match". Undefined only when the user has no master and no role-family resume.
 */
export function pickTailorSourceResumeId({
  roleFamilyResumes,
  masterResumes,
  jobTitle,
}: {
  roleFamilyResumes: TailorSourceOption[]
  masterResumes: TailorSourceOption[]
  jobTitle: string
}): string | undefined {
  const roleFamily = roleFamilyResumes.find((resume) =>
    sharesRoleToken(`${resume.title} ${resume.detail ?? ""}`, jobTitle)
  )
  if (roleFamily) return roleFamily.id

  return masterResumes[0]?.id
}
