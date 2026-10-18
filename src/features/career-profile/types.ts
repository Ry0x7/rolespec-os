import type {
  CareerCapabilityDepth,
  CareerCapabilitySelfRating,
  CareerEvidenceKind,
  CareerEvidenceSource,
  CareerEvidenceStatus,
  ExperienceLevel,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"

/** Preference/direction values, exactly the fields the profile form edits. */
export interface CareerPreferencesValues {
  experienceLevel: ExperienceLevel | null
  locations: string[]
  openToRelocation: boolean
  workModes: WorkType[]
  workAuthorization: string | null
  requiresSponsorship: boolean | null
  salaryMin: number | null
  salaryMax: number | null
  salaryPeriod: SalaryPeriod | null
  salaryCurrency: SalaryCurrency
  careerGoals: string | null
}

/** Resume-header contact details, exactly the fields the contacts form edits. */
export interface CareerContactValues {
  contactFullName: string | null
  contactEmail: string | null
  contactPhone: string | null
  contactLocation: string | null
  linkedinUrl: string | null
  githubUrl: string | null
  websiteUrl: string | null
}

export interface RoleFamilyRow {
  id: string
  name: string
  notes: string | null
}

export interface TargetRoleRow {
  id: string
  title: string
  priority: number
  active: boolean
  roleFamilyId: string | null
  roleFamilyName: string | null
}

export interface EvidenceRow {
  id: string
  kind: CareerEvidenceKind
  source: CareerEvidenceSource
  status: CareerEvidenceStatus
  title: string
  organization: string | null
  details: string | null
  outcome: string | null
  startDate: Date | null
  endDate: Date | null
}

export interface CapabilityLinkRow {
  id: string
  evidenceId: string
  evidenceTitle: string
  depth: CareerCapabilityDepth
  hasMeasuredOutcome: boolean
  outcomeNote: string | null
  lastUsedAt: Date | null
}

export interface CapabilityRow {
  id: string
  name: string
  category: string | null
  confirmed: boolean
  selfAssessment: CareerCapabilitySelfRating | null
  notes: string | null
  links: CapabilityLinkRow[]
}

/**
 * Result of a bulk skill add. Written as an explicit union discriminated on
 * `success`, so a caller that has handled the failure can read the counts. A
 * plain `error: string` field cannot discriminate — `string` is not a unit type.
 */
export type CreateCapabilitiesResult =
  | { success?: false; error: string }
  | { success: true; created: number; skipped: number }

/** Minimal evidence identity used to populate the "link evidence" picker. */
export interface EvidenceOption {
  id: string
  title: string
  kind: CareerEvidenceKind
}
