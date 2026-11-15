import type {
  ReviewTaskKind,
  ReviewTaskStatus,
  WorkflowEventType,
  WorkflowKind,
  WorkflowMode,
  WorkflowState,
  WorkflowStepStatus,
} from "@/generated/prisma/enums"

/**
 * Durable workflow contracts.
 *
 * The engine is deliberately plain: PostgreSQL rows, optimistic state versions
 * and a lease per run. A step is a named, idempotent unit with a stored output;
 * the worker can die at any point and the next tick replays only what did not
 * commit. Nothing here simulates progress: percentages and agent chatter are
 * absent, and every status is a persisted fact.
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** The assisted application pipeline, in dependency order. */
export type WorkflowStepName =
  | "PROFILE"
  | "DISCOVER"
  | "RANK"
  | "RESEARCH"
  | "TAILOR"
  | "VALIDATE"
  | "PREPARE_ATS"
  | "HUMAN_REVIEW"
  | "SUBMISSION_STAGING"
  | "TRACKING"
  | "FOLLOW_UP"

export interface WorkflowStepDefinition {
  name: WorkflowStepName
  /** Position in the pipeline, stable across runs. */
  order: number
  /** Step names that must be COMPLETED or SKIPPED before this may run. */
  dependsOn: WorkflowStepName[]
  /**
   * A required step must be COMPLETED (or SKIPPED) before the run can complete.
   * A non-required failure is recorded and the rest of the pipeline continues.
   */
  required: boolean
  timeoutMs: number
  maxAttempts: number
}

/** Immutable snapshot of what a run is about. Ids only, never personal text. */
export interface WorkflowRunInput {
  jobApplicationId?: string
  jobId?: string
  resumeId?: string
  targetRole?: string
}

export interface WorkflowExecutionContext {
  runId: string
  stepId: string
  userId: string
  jobApplicationId: string | null
  input: WorkflowRunInput
  stepName: WorkflowStepName
  /** 1-based attempt number for this step. */
  attempt: number
  signal: AbortSignal
  now: Date
}

export interface ReviewRequest {
  kind: ReviewTaskKind
  question: string
  reason: string
  category?: string
  fallback?: string
  suggestedValue?: JsonValue
}

export type WorkflowStepOutcome =
  | { status: "COMPLETED"; summary: string; output: JsonObject }
  | { status: "WAITING_FOR_USER"; review: ReviewRequest }
  | { status: "SKIPPED"; reason: string; output?: JsonObject }
  | { status: "FAILED"; error: string; retryable: boolean; fallback: string }

export type WorkflowExecutor = (
  context: WorkflowExecutionContext
) => Promise<WorkflowStepOutcome>

export interface WorkflowRunDTO {
  id: string
  jobApplicationId: string | null
  kind: WorkflowKind
  mode: WorkflowMode
  state: WorkflowState
  input: WorkflowRunInput | null
  lastError: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  steps: WorkflowStepDTO[]
  openReviewTaskIds: string[]
}

export interface WorkflowStepDTO {
  id: string
  name: string
  order: number
  status: WorkflowStepStatus
  required: boolean
  dependsOn: string[]
  attempts: number
  maxAttempts: number
  output: JsonValue | null
  lastError: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface WorkflowEventDTO {
  id: string
  type: WorkflowEventType
  stepName: string | null
  message: string
  metadata: JsonValue | null
  createdAt: string
}

export interface ReviewTaskDTO {
  id: string
  runId: string | null
  stepId: string | null
  jobApplicationId: string | null
  /** Set when the extension's ATS preparation created this question. */
  atsPreparationId: string | null
  kind: ReviewTaskKind
  status: ReviewTaskStatus
  question: string
  reason: string
  category: string | null
  fallback: string | null
  suggestedValue: JsonValue | null
  answer: JsonValue | null
  resolvedAt: string | null
  createdAt: string
}
