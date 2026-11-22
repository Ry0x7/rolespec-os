import type {
  CareerCapabilityDepth,
  CareerCapabilitySelfRating,
  CareerEvidenceKind,
  CareerEvidenceStatus,
  ExperienceLevel,
} from "@/generated/prisma/enums"

/**
 * Career Path Intelligence — shared contract.
 *
 * Everything here is plain data so the same result can be produced on the
 * server and rendered by a client component without passing Prisma rows,
 * `Decimal`s or class instances across the boundary.
 */

export type CareerPathGroupId = "QUALIFIED_NOW" | "ADJACENT" | "GROWTH"

export const CAREER_PATH_GROUP_LABELS: Record<CareerPathGroupId, string> = {
  QUALIFIED_NOW: "Qualified now",
  ADJACENT: "Adjacent careers",
  GROWTH: "Growth paths",
}

/** How much of an occupation can be evidenced from the profile, never a guess. */
export type CareerMatchStatus = "SUPPORTED" | "SELF_DECLARED" | "MISSING"

/** Seniority a catalogue entry is written for. Kept separate from `ExperienceLevel`. */
export type CareerEntryLevel = "ENTRY" | "MID" | "SENIOR"

export type CareerRegion =
  | "GLOBAL"
  | "US"
  | "EU"
  | "UK"
  | "CA"
  | "AU"
  | "PH"
  | "IN"
  | "SG"
  | "AE"

/** A transferable capability the catalogue can ask for. */
export interface CareerCapabilityDefinition {
  /** Stable key used by requirements and by the matcher. */
  key: string
  /** Display label, sentence case. */
  label: string
  /** Lower-case free-text names that resolve to this key. */
  aliases: readonly string[]
  /** One concrete, non-credential action for closing this gap. */
  learningStep: string
}

export interface CareerRequirement {
  capabilityKey: string
  /** 1 is a nice-to-have, 3 is central to the role. */
  weight: 1 | 2 | 3
  /**
   * Critical requirements block a confident recommendation when missing. A
   * non-critical requirement is still scored and listed, but can appear in an
   * adjacent role's gap list.
   */
  critical?: boolean
}

export interface CareerCredentialGate {
  /** Human-readable credential, e.g. "Local nursing licence". */
  label: string
  /** Regions where the credential is enforced. */
  regions: readonly CareerRegion[]
}

export interface CareerOccupationFamily {
  id: string
  label: string
  summary: string
}

export interface CareerOccupation {
  id: string
  title: string
  familyId: string
  summary: string
  entryLevel: CareerEntryLevel
  /** Requirements the role needs on day one. */
  requirements: readonly CareerRequirement[]
  /** Useful but not required; scored at a lower weight. */
  preferred: readonly CareerRequirement[]
  /** Occupations a candidate can move into with a small bridge. */
  adjacentIds: readonly string[]
  /** Realistic next branches once this role is held. */
  growthIds: readonly string[]
  /**
   * Regions this catalogue entry is open to. `["GLOBAL"]` means the occupation
   * itself has no region-specific licence in this dataset; it does not promise
   * a visa. The engine reports what it knows and marks the rest unknown.
   */
  regions: readonly CareerRegion[]
  credentialGate?: CareerCredentialGate
  /** Dataset references only. No descriptions are copied from ESCO/O*NET. */
  references?: {
    escoUri?: string
    onetSoc?: string
    isco08?: string
  }
}

export interface CareerPathCatalog {
  /** Version of the shipped subset/crosswalk, not the upstream dataset version. */
  version: string
  families: readonly CareerOccupationFamily[]
  occupations: readonly CareerOccupation[]
  capabilityDefinitions: readonly CareerCapabilityDefinition[]
  /** Attribution and provenance shown in the UI and in the data note. */
  attribution: readonly string[]
}

export interface CareerPathCapabilityLinkInput {
  id: string
  evidenceId: string
  depth: CareerCapabilityDepth
  hasMeasuredOutcome: boolean
  lastUsedAt: Date | string | null
}

export interface CareerPathCapabilityInput {
  id: string
  name: string
  confirmed: boolean
  selfAssessment: CareerCapabilitySelfRating | null
  links: readonly CareerPathCapabilityLinkInput[]
}

export interface CareerPathEvidenceInput {
  id: string
  title: string
  kind: CareerEvidenceKind
  status: CareerEvidenceStatus
  outcome?: string | null
  sourceUrl?: string | null
}

export interface CareerPathProfileInput {
  experienceLevel: ExperienceLevel | null
  locations: readonly string[]
  workAuthorization: string | null
  requiresSponsorship: boolean | null
  targetRoleTitles: readonly string[]
  capabilities: readonly CareerPathCapabilityInput[]
  evidence: readonly CareerPathEvidenceInput[]
}

export interface CareerCapabilityMatch {
  key: string
  label: string
  weight: number
  critical: boolean
  source: "REQUIRED" | "PREFERRED"
  status: CareerMatchStatus
  /** 0–100. Null when the profile has no confirmed capability for the key. */
  strength: number | null
  selfAssessment: CareerCapabilitySelfRating | null
  /** Confirmed evidence excerpts the strength was built from. */
  evidence: Array<{
    id: string
    title: string
    kind: CareerEvidenceKind
    sourceUrl: string | null
    outcome: string | null
  }>
  explanation: string
}

export interface CareerScoreBreakdown {
  requiredCoverage: number
  preferredCoverage: number
  evidenceShare: number
  criticalPenalty: number
  total: number
}

export interface CareerEntryFeasibility {
  status: "FEASIBLE" | "STRETCH" | "UNKNOWN" | "BLOCKED"
  label: string
  explanation: string
}

export interface CareerGeographyEligibility {
  status: "ELIGIBLE" | "UNKNOWN" | "RESTRICTED"
  label: string
  explanation: string
}

/**
 * Deliberately null in every recommendation produced from the shipped
 * catalogue: it contains no trustworthy regional pay series. A future dataset
 * may fill this, but the UI never prints a salary figure without one.
 */
export interface CareerSalaryPotential {
  min: number
  max: number
  currency: string
  period: string
  region: CareerRegion
  source: string
  asOf: string
}

export interface CareerRelatedRole {
  occupationId: string
  title: string
  relationship: "ADJACENT" | "NEXT"
}

export interface CareerRecommendation {
  occupationId: string
  title: string
  familyId: string
  familyLabel: string
  summary: string
  group: CareerPathGroupId
  entryLevel: CareerEntryLevel
  score: number
  coverage: number
  breakdown: CareerScoreBreakdown
  confidence: "HIGH" | "MEDIUM" | "LOW"
  evidenceBackedCapabilities: number
  matched: CareerCapabilityMatch[]
  missing: CareerCapabilityMatch[]
  entryFeasibility: CareerEntryFeasibility
  geography: CareerGeographyEligibility
  /** Concrete learning actions for the missing requirements, deduplicated. */
  steps: string[]
  /** Titles from the nearest evidence-backed role to this one. */
  branch: string[]
  related: CareerRelatedRole[]
  salaryPotential: CareerSalaryPotential | null
  /** Deterministic sentences explaining the group and score. */
  reasons: string[]
}

export interface CareerPathConflict {
  capabilityKey: string
  label: string
  detail: string
}

export interface CareerPathResult {
  taxonomyVersion: string
  attribution: readonly string[]
  groups: Record<CareerPathGroupId, CareerRecommendation[]>
  counts: Record<CareerPathGroupId, number>
  conflicts: CareerPathConflict[]
  /** Short, deterministic notices about sparse or contradictory input. */
  notices: string[]
  evaluatedCount: number
  hasEnoughEvidence: boolean
}
