import type { CareerEvidenceKind } from "@/generated/prisma/enums"

/**
 * The six supported intake paths. They are deliberately a closed set: every
 * adapter produces the same patch shape, so adding a source never changes the
 * review or apply code.
 */
export const INTAKE_SOURCES = [
  "RESUME",
  "GITHUB",
  "LINKEDIN",
  "WEB",
  "CHAT",
  "VOICE",
] as const

export type IntakeSource = (typeof INTAKE_SOURCES)[number]

export type IntakeRunStatus =
  | "PENDING"
  | "RUNNING"
  | "PARTIAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"

export type IntakeSourceStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED"

export type IntakePatchKind = "CONTACT" | "EVIDENCE" | "SKILL" | "TARGET_ROLE"

export type IntakePatchStatus = "PENDING" | "APPLIED" | "CONFLICT" | "REJECTED"

export type IntakeConflictResolution =
  | "KEEP_EXISTING"
  | "ACCEPT_INCOMING"
  | "KEEP_BOTH"

export type ContactField =
  | "contactFullName"
  | "contactEmail"
  | "contactPhone"
  | "contactLocation"
  | "linkedinUrl"
  | "githubUrl"
  | "websiteUrl"

export interface IntakeProvenance {
  /** Adapter id, e.g. `resume-text`, `github-public`, `web-portfolio`. */
  adapter: string
  sourceUrl?: string | null
  fileName?: string | null
  externalId?: string | null
  /** Section or item inside the source, when one exists. */
  locator?: string | null
  /** ISO timestamp of when the source was read. */
  fetchedAt: string
  /** Short human-readable detail; never raw file contents. */
  detail?: string | null
}

export interface ContactPatchData {
  field: ContactField
  value: string
}

export interface EvidencePatchData {
  evidenceKind: CareerEvidenceKind
  title: string
  organization: string | null
  details: string | null
  outcome: string | null
  startDate: string | null
  endDate: string | null
}

export interface SkillPatchData {
  name: string
  category: string | null
}

export interface TargetRolePatchData {
  title: string
}

export type IntakePatchData =
  | ContactPatchData
  | EvidencePatchData
  | SkillPatchData
  | TargetRolePatchData

/**
 * What an adapter returns. The run service validates, normalizes, fingerprints
 * and persists these; adapters never touch Prisma.
 */
export interface IntakePatchDraft {
  kind: IntakePatchKind
  data: IntakePatchData
  /** 0-100. Source-based by default; adapters may lower it for guesses. */
  confidence: number
  provenance: IntakeProvenance
}

export interface IntakeAdapterInput {
  /** Adapter-specific validated input. */
  input: Record<string, unknown>
  userId: string
  runId: string
  sourceRunId: string
  signal: AbortSignal
  reportProgress: (progress: number, message?: string) => Promise<void>
}

export interface IntakeAdapterResult {
  patches: IntakePatchDraft[]
  /** Non-fatal notes shown on the source row, e.g. "3 skills skipped". */
  warnings?: string[]
  meta?: Record<string, unknown>
}

export interface IntakeAdapter {
  source: IntakeSource
  /** Human label used in UI and error messages. */
  label: string
  run(input: IntakeAdapterInput): Promise<IntakeAdapterResult>
}

/**
 * Failure that is safe to show to the user. Adapters catch vendor errors and
 * rethrow one of these, so a stack trace or provider response body never
 * reaches the review UI.
 */
export class IntakeAdapterError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "SOURCE_UNAVAILABLE"
      | "RESTRICTED"
      | "NEEDS_AI"
      | "CANCELLED",
    message: string
  ) {
    super(message)
    this.name = "IntakeAdapterError"
  }
}

/** One source attempt on the wire. */
export interface IntakeSourceRunDTO {
  id: string
  source: IntakeSource
  status: IntakeSourceStatus
  progress: number
  message: string | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface IntakeConflictDTO {
  id: string
  existingType: string
  existingId: string | null
  field: string | null
  incoming: unknown
  existing: unknown
  status: "OPEN" | "RESOLVED" | "DISMISSED"
  resolution: IntakeConflictResolution | null
}

export interface IntakePatchDTO {
  id: string
  kind: IntakePatchKind
  source: IntakeSource
  status: IntakePatchStatus
  confidence: number
  data: IntakePatchData
  provenance: IntakeProvenance
  rejectionReason: string | null
  appliedTargetType: string | null
  appliedTargetId: string | null
  correctedAt: string | null
  conflict: IntakeConflictDTO | null
}

export interface IntakeRunDTO {
  id: string
  status: IntakeRunStatus
  requestedSources: IntakeSource[]
  error: string | null
  warnings: string[]
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  sources: IntakeSourceRunDTO[]
  patches: IntakePatchDTO[]
  counts: {
    pending: number
    applied: number
    conflicts: number
    rejected: number
  }
}

/** A conversational turn shared by the chat and voice adapters. */
export interface IntakeChatMessage {
  role: "user" | "assistant"
  content: string
}

/** Result of `POST /api/intake/chat`: a preview, not a persisted patch. */
export interface ChatExtractionResult {
  mode: "deterministic" | "ai"
  patches: IntakePatchDraft[]
  nextQuestion: string | null
  warnings: string[]
}

export const INTAKE_SOURCE_LABELS: Record<IntakeSource, string> = {
  RESUME: "Resume",
  GITHUB: "GitHub",
  LINKEDIN: "LinkedIn export",
  WEB: "Portfolio / website",
  CHAT: "Conversational chat",
  VOICE: "Voice transcript",
}
