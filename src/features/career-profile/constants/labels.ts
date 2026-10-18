import type {
  CareerCapabilityDepth,
  CareerCapabilitySelfRating,
  CareerEvidenceKind,
  CareerEvidenceSource,
  CareerEvidenceStatus,
  ExperienceLevel,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"

/** No React import here, so server components can read these too. */

export const EVIDENCE_KIND_LABELS: Record<CareerEvidenceKind, string> = {
  EXPERIENCE: "Experience",
  ACHIEVEMENT: "Achievement",
  PROJECT: "Project",
  EDUCATION: "Education",
  CERTIFICATION: "Certification",
}

/** Fixed display order for the evidence groups. */
export const EVIDENCE_KIND_ORDER: CareerEvidenceKind[] = [
  "EXPERIENCE",
  "ACHIEVEMENT",
  "PROJECT",
  "EDUCATION",
  "CERTIFICATION",
]

export const EVIDENCE_SOURCE_LABELS: Record<CareerEvidenceSource, string> = {
  USER_ENTERED: "You entered this",
  RESUME_IMPORT_CANDIDATE: "From a resume",
  LINKEDIN_IMPORT_CANDIDATE: "From LinkedIn",
}

export const EVIDENCE_STATUS_LABELS: Record<CareerEvidenceStatus, string> = {
  CANDIDATE: "Unconfirmed",
  CONFIRMED: "Confirmed",
  ARCHIVED: "Archived",
}

export const CAPABILITY_DEPTH_LABELS: Record<CareerCapabilityDepth, string> = {
  EXPOSURE: "Exposure",
  WORKING: "Working",
  DEEP: "Deep",
}

export const CAPABILITY_SELF_RATING_LABELS: Record<CareerCapabilitySelfRating, string> = {
  LEARNING: "Learning",
  COMPETENT: "Competent",
  STRONG: "Strong",
  EXPERT: "Expert",
}

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  JUNIOR: "Junior",
  MID: "Mid",
  SENIOR: "Senior",
  LEAD: "Lead",
  EXECUTIVE: "Executive",
}

export const WORK_MODE_LABELS: Record<WorkType, string> = {
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ONSITE: "On-site",
}

export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  HOURLY: "per hour",
  MONTHLY: "per month",
  YEARLY: "per year",
}

/**
 * Work authorization is stored as free text; these are the choices the forms
 * offer. "" saves as null.
 */
export const WORK_AUTHORIZATION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Not specified" },
  { value: "Citizen", label: "Citizen" },
  { value: "Permanent resident", label: "Permanent resident" },
  { value: "Work visa", label: "Work visa" },
  { value: "Student visa", label: "Student visa" },
  { value: "Need sponsorship", label: "Need sponsorship" },
  { value: "Other", label: "Other" },
]

/** True for a stored free-text answer that none of the options above matches. */
export function isLegacyWorkAuthorization(value: string | null): value is string {
  return !!value && !WORK_AUTHORIZATION_OPTIONS.some((option) => option.value === value)
}

/**
 * Toast copy for a bulk skill add. The skipped count is reported rather than
 * swallowed, so "I typed five, four appeared" is never a silent mystery.
 */
export function summarizeCapabilitiesAdded(created: number, skipped: number): string {
  const addedPart =
    created === 0
      ? "No new skills added"
      : `Added ${created} ${created === 1 ? "skill" : "skills"}`
  if (skipped === 0) return addedPart
  return `${addedPart}, ${skipped} already existed`
}
