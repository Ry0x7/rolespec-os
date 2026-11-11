/**
 * Contracts for evidence-grounded resume tailoring.
 *
 * These types are shared by the pure text services (evidence mapping and
 * validation), the persistence service and the workflow executor. They carry
 * only ids, snapshot references and user-visible text — never provider request
 * bodies or secrets.
 */

export type TailoringRunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "NEEDS_REVIEW"
  | "FAILED"
  | "CANCELLED"

export type TailoringValidationStatus = "PASS" | "NEEDS_REVIEW" | "FAIL"

export type ResumeEditKind = "TAILORING_APPLIED" | "MANUAL_EDIT" | "ROLLBACK" | "RESTORE"

/** One section in a source snapshot. Ids are kept so a restored row can be traced. */
export interface ResumeSectionSnapshot {
  id?: string
  type: string
  title: string
  order: number
  visible: boolean
  items: Array<{
    id?: string
    content: Record<string, unknown>
    metadata?: unknown
    order: number
  }>
}

export interface SourceSnapshotPayload {
  sourceResumeId: string
  sourceVersion: number
  capturedAt: string
  title: string
  template: string
  targetRole: string | null
  targetCompany: string | null
  sections: ResumeSectionSnapshot[]
}

/** Where a piece of evidence came from. */
export type EvidenceOrigin = "resume" | "profile"

/**
 * One addressable candidate fact. `ref` is stable inside a tailoring run and
 * points at a section/item/field — not at a character range that later edits
 * could shift.
 */
export interface EvidenceAtom {
  ref: string
  sectionId: string
  sectionType: string
  sectionTitle: string
  itemId: string
  label: string
  field: string
  index?: number
  text: string
  origin: EvidenceOrigin
  /** True when the user or an explicit import confirmed this fact. */
  approved: boolean
  /** Stable provenance carried by the resume item, when present. */
  source?: {
    kind?: string
    adapter?: string
    locator?: string
  }
}

export type RequirementVerdict = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED"

export interface RequirementEvidenceRef {
  ref: string
  label: string
  quote: string
  origin: EvidenceOrigin
  matchedTerms: string[]
}

export interface RequirementEvidence {
  id: string
  text: string
  kind: "TITLE" | "RESPONSIBILITY" | "REQUIREMENT"
  verdict: RequirementVerdict
  matchedTerms: string[]
  evidenceRefs: RequirementEvidenceRef[]
}

export interface EvidenceReference {
  ref: string
  label: string
  quote: string
  origin: EvidenceOrigin
  /** The requirement ids this reference also answers, if any. */
  requirementIds?: string[]
}

export type ValidationIssueCode =
  | "FABRICATED_METRIC"
  | "FABRICATED_DATE"
  | "UNSUPPORTED_SCOPE"
  | "UNSUPPORTED_ENTITY"
  | "IMPLIED_CREDENTIAL"
  | "IMPLIED_SENIORITY"
  | "SKILL_SET_CHANGED"
  | "UNSUPPORTED_ADDED_ITEM"
  | "SEMANTIC_DRIFT"
  | "BANNED_CLICHE"
  | "MISSING_EVIDENCE_REF"

export interface ValidationIssue {
  code: ValidationIssueCode
  severity: "error" | "warning"
  message: string
  sectionType?: string
  itemRef?: string
  field?: string
  claim?: string
  evidenceRefs?: EvidenceReference[]
}

export interface ClaimEvidence {
  claimId: string
  sectionType: string
  itemRef: string
  field: string
  change: "rewritten" | "added" | "removed"
  sourceText: string
  tailoredText: string
  evidenceRefs: EvidenceReference[]
  requirementIds: string[]
}

export interface TailoringValidationReport {
  status: TailoringValidationStatus
  sourceHash: string
  issues: ValidationIssue[]
  claims: ClaimEvidence[]
  requirementCoverage: {
    supported: number
    partial: number
    unsupported: number
    total: number
  }
  checkedAt: string
}

/** Why a model suggestion was not applied. Kept for repair prompts and review. */
export interface RejectedTailoringSuggestion {
  targetId: string
  field: string
  proposed: string
  reason: string
}

export interface TailoringResult {
  status: TailoringRunStatus
  runId: string
  resumeId: string | null
  sourceResumeId: string
  sourceVersion: number
  snapshotHash: string
  validation: TailoringValidationReport
  requirements: RequirementEvidence[]
  attempts: number
  rejected: RejectedTailoringSuggestion[]
  /** Actionable human-review instructions when status is NEEDS_REVIEW. */
  review: {
    question: string
    reason: string
    fallback: string
  } | null
}
