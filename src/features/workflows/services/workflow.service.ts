import { Prisma } from "@/generated/prisma/client"
import type {
  ReviewTaskKind,
  WorkflowEventType,
  WorkflowKind,
  WorkflowMode,
  WorkflowState,
  WorkflowStepStatus,
} from "@/generated/prisma/enums"
import { prisma } from "@/shared/lib/prisma"

import { APPLICATION_PIPELINE, stepDefinition } from "../pipeline"
import type {
  JsonObject,
  JsonValue,
  ReviewTaskDTO,
  WorkflowEventDTO,
  WorkflowRunDTO,
  WorkflowRunInput,
  WorkflowStepDTO,
  WorkflowStepName,
} from "../types"

/** Legal run transitions. `COMPLETED` is terminal except for a new run. */
const LEGAL_TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  MANUAL: ["ASSISTED", "COMPLETED", "CANCELLED"],
  ASSISTED: ["AWAITING_REVIEW", "PAUSED", "FAILED", "COMPLETED", "CANCELLED"],
  AWAITING_REVIEW: ["ASSISTED", "PAUSED", "CANCELLED"],
  PAUSED: ["ASSISTED", "CANCELLED"],
  FAILED: ["ASSISTED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
}

const TERMINAL_STATES: readonly WorkflowState[] = ["COMPLETED", "CANCELLED"]

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "INVALID_TRANSITION"
      | "INVALID_INPUT"
      | "CONFLICT"
      | "NO_OPEN_TASK"
      | "TASK_NOT_OPEN"
  ) {
    super(message)
    this.name = "WorkflowError"
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function asJsonValue(value: unknown): JsonValue | null {
  if (value === null || value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function toRunInput(value: unknown): WorkflowRunInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as WorkflowRunInput
}

function runDto(run: {
  id: string
  jobApplicationId: string | null
  kind: WorkflowKind
  mode: WorkflowMode
  state: WorkflowState
  input: unknown
  lastError: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  steps: Array<{
    id: string
    name: string
    order: number
    status: WorkflowStepStatus
    required: boolean
    dependsOn: string[]
    attempts: number
    maxAttempts: number
    output: unknown
    lastError: string | null
    startedAt: Date | null
    finishedAt: Date | null
  }>
  reviewTasks: Array<{ id: string; status: string }>
}): WorkflowRunDTO {
  return {
    id: run.id,
    jobApplicationId: run.jobApplicationId,
    kind: run.kind,
    mode: run.mode,
    state: run.state,
    input: toRunInput(run.input),
    lastError: run.lastError,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    steps: run.steps
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(
        (step): WorkflowStepDTO => ({
          id: step.id,
          name: step.name,
          order: step.order,
          status: step.status,
          required: step.required,
          dependsOn: step.dependsOn,
          attempts: step.attempts,
          maxAttempts: step.maxAttempts,
          output: asJsonValue(step.output),
          lastError: step.lastError,
          startedAt: step.startedAt?.toISOString() ?? null,
          finishedAt: step.finishedAt?.toISOString() ?? null,
        })
      ),
    openReviewTaskIds: run.reviewTasks
      .filter((task) => task.status === "OPEN")
      .map((task) => task.id),
  }
}

const RUN_INCLUDE = {
  steps: {
    select: {
      id: true,
      name: true,
      order: true,
      status: true,
      required: true,
      dependsOn: true,
      attempts: true,
      maxAttempts: true,
      output: true,
      lastError: true,
      startedAt: true,
      finishedAt: true,
    },
  },
  reviewTasks: { select: { id: true, status: true } },
} as const

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to)
}

/**
 * Creates one run and its full step set atomically. A replayed idempotency key
 * returns the existing run untouched, so a double-submit cannot create two
 * pipelines for the same application.
 */
export async function createWorkflow(
  userId: string,
  input: {
    jobApplicationId?: string | null
    kind?: WorkflowKind
    mode: WorkflowMode
    runInput?: WorkflowRunInput
    idempotencyKey?: string | null
  }
): Promise<WorkflowRunDTO> {
  const idempotencyKey = input.idempotencyKey?.trim() || null
  if (idempotencyKey) {
    const existing = await prisma.workflowRun.findFirst({
      where: { userId, idempotencyKey },
      include: RUN_INCLUDE,
    })
    if (existing) return runDto(existing)
  }

  let jobId: string | null = null
  let applicationResumeId: string | null = null
  if (input.jobApplicationId) {
    const application = await prisma.jobApplication.findFirst({
      where: { id: input.jobApplicationId, userId },
      select: { id: true, jobId: true, resumeId: true },
    })
    if (!application) throw new WorkflowError("Application not found", "NOT_FOUND")
    jobId = application.jobId
    applicationResumeId = application.resumeId

    // One application can have one active pipeline. Without this guard two
    // deliberate creates (or a double-submit without an idempotency key) can
    // run the same tailoring/research work twice against one application.
    const active = await prisma.workflowRun.findFirst({
      where: {
        userId,
        jobApplicationId: input.jobApplicationId,
        state: { in: ["MANUAL", "ASSISTED", "AWAITING_REVIEW", "PAUSED"] },
      },
      select: { id: true },
    })
    if (active) {
      throw new WorkflowError(
        "This application already has an active workflow.",
        "CONFLICT"
      )
    }
  }

  const runInput: WorkflowRunInput = {
    ...(input.jobApplicationId ? { jobApplicationId: input.jobApplicationId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(input.runInput?.resumeId ?? applicationResumeId
      ? { resumeId: input.runInput?.resumeId ?? applicationResumeId ?? undefined }
      : {}),
    ...(input.runInput?.targetRole ? { targetRole: input.runInput.targetRole } : {}),
  }

  try {
    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.workflowRun.create({
        data: {
          userId,
          jobApplicationId: input.jobApplicationId ?? null,
          kind: input.kind ?? "APPLICATION",
          mode: input.mode,
          state: "MANUAL",
          input: json(runInput),
          idempotencyKey,
        },
      })
      await tx.workflowStep.createMany({
        data: APPLICATION_PIPELINE.map((step) => ({
          runId: created.id,
          name: step.name,
          order: step.order,
          status: "PENDING" as const,
          required: step.required,
          dependsOn: [...step.dependsOn],
          maxAttempts: step.maxAttempts,
          timeoutMs: step.timeoutMs,
          idempotencyKey: `${created.id}:${step.name}`,
        })),
      })
      await tx.workflowEvent.create({
        data: {
          runId: created.id,
          type: "RUN_CREATED",
          message: `Workflow created in ${input.mode} mode with ${APPLICATION_PIPELINE.length} steps.`,
          metadata: json({ stepCount: APPLICATION_PIPELINE.length, mode: input.mode }),
        },
      })
      return created
    })

    return (await getWorkflow(userId, run.id))!
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      if (idempotencyKey) {
        const existing = await prisma.workflowRun.findFirst({
          where: { userId, idempotencyKey },
          include: RUN_INCLUDE,
        })
        if (existing) return runDto(existing)
      }
      // The partial unique index is the real guard against two simultaneous
      // creates for one application; the pre-check above only improves the
      // common-case message.
      if (input.jobApplicationId) {
        const active = await prisma.workflowRun.findFirst({
          where: {
            userId,
            jobApplicationId: input.jobApplicationId,
            state: { in: ["MANUAL", "ASSISTED", "AWAITING_REVIEW", "PAUSED"] },
          },
          select: { id: true },
        })
        if (active) {
          throw new WorkflowError(
            "This application already has an active workflow.",
            "CONFLICT"
          )
        }
      }
    }
    throw error
  }
}

export async function getWorkflow(
  userId: string,
  id: string
): Promise<WorkflowRunDTO | null> {
  const run = await prisma.workflowRun.findFirst({
    where: { id, userId },
    include: RUN_INCLUDE,
  })
  return run ? runDto(run) : null
}

export async function listWorkflows(
  userId: string,
  filters: { state?: WorkflowState; kind?: WorkflowKind; limit?: number } = {}
): Promise<WorkflowRunDTO[]> {
  const limit = Math.min(50, Math.max(1, Math.floor(filters.limit ?? 20)))
  const runs = await prisma.workflowRun.findMany({
    where: {
      userId,
      ...(filters.state ? { state: filters.state } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: RUN_INCLUDE,
  })
  return runs.map(runDto)
}

export async function getWorkflowEvents(
  userId: string,
  runId: string,
  limit = 50
): Promise<WorkflowEventDTO[]> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    select: { id: true },
  })
  if (!run) throw new WorkflowError("Workflow not found", "NOT_FOUND")

  const events = await prisma.workflowEvent.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    take: Math.min(200, Math.max(1, limit)),
    include: { step: { select: { name: true } } },
  })
  return events.map((event) => ({
    id: event.id,
    type: event.type,
    stepName: event.step?.name ?? null,
    message: event.message,
    metadata: asJsonValue(event.metadata),
    createdAt: event.createdAt.toISOString(),
  }))
}

async function writeEvent(
  tx: Prisma.TransactionClient,
  runId: string,
  type: WorkflowEventType,
  message: string,
  metadata?: JsonObject,
  stepId?: string | null
): Promise<void> {
  await tx.workflowEvent.create({
    data: {
      runId,
      stepId: stepId ?? null,
      type,
      message,
      ...(metadata ? { metadata: json(metadata) } : {}),
    },
  })
}

/**
 * One legal user-triggered state move. The conditional update on `state` is the
 * concurrency guard: a worker trying to commit a step after the user paused sees
 * no match and discards its output.
 */
async function moveState(
  userId: string,
  runId: string,
  to: WorkflowState,
  options: {
    from: readonly WorkflowState[]
    event: WorkflowEventType
    message: string
    startedAt?: Date
    finishedAt?: Date
    clearLease?: boolean
  }
): Promise<WorkflowRunDTO> {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.workflowRun.updateMany({
      where: { id: runId, userId, state: { in: [...options.from] } },
      data: {
        state: to,
        stateVersion: { increment: 1 },
        ...(options.startedAt ? { startedAt: options.startedAt } : {}),
        ...(options.finishedAt ? { finishedAt: options.finishedAt } : {}),
        ...(options.clearLease ? { leaseOwner: null, leaseExpiresAt: null } : {}),
      },
    })
    if (changed.count === 0) {
      const current = await tx.workflowRun.findFirst({
        where: { id: runId, userId },
        select: { state: true },
      })
      if (!current) throw new WorkflowError("Workflow not found", "NOT_FOUND")
      throw new WorkflowError(
        `Cannot move a ${current.state} workflow to ${to}.`,
        "INVALID_TRANSITION"
      )
    }
    await writeEvent(tx, runId, options.event, options.message)
  })
  return (await getWorkflow(userId, runId))!
}

/** Starts an assisted run, or marks a manual run as started without a worker. */
export async function startWorkflow(
  userId: string,
  runId: string
): Promise<WorkflowRunDTO> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    select: { id: true, mode: true, state: true, startedAt: true },
  })
  if (!run) throw new WorkflowError("Workflow not found", "NOT_FOUND")
  if (run.state !== "MANUAL") {
    throw new WorkflowError(`Cannot start a ${run.state} workflow.`, "INVALID_TRANSITION")
  }

  if (run.mode === "MANUAL") {
    return moveState(userId, runId, "MANUAL", {
      from: ["MANUAL"],
      event: "RUN_STARTED",
      message: "Manual workflow started. No worker will advance it.",
      startedAt: run.startedAt ?? new Date(),
    })
  }
  return moveState(userId, runId, "ASSISTED", {
    from: ["MANUAL"],
    event: "RUN_STARTED",
    message: "Assisted workflow started and queued for the worker.",
    startedAt: run.startedAt ?? new Date(),
  })
}

export async function pauseWorkflow(
  userId: string,
  runId: string
): Promise<WorkflowRunDTO> {
  return moveState(userId, runId, "PAUSED", {
    from: ["ASSISTED", "AWAITING_REVIEW"],
    event: "RUN_PAUSED",
    message: "Workflow paused by the user. In-flight output will be discarded.",
    clearLease: true,
  })
}

/**
 * Resume picks up exactly where the run stopped. If a checkpoint is still open
 * the run returns to AWAITING_REVIEW rather than pretending it can work; only a
 * dismissed checkpoint is re-queued.
 */
export async function resumeWorkflow(
  userId: string,
  runId: string
): Promise<WorkflowRunDTO> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    select: {
      id: true,
      state: true,
      mode: true,
      reviewTasks: { where: { status: "OPEN" }, select: { id: true } },
      steps: { where: { status: "WAITING_FOR_USER" }, select: { id: true } },
    },
  })
  if (!run) throw new WorkflowError("Workflow not found", "NOT_FOUND")
  if (run.mode === "MANUAL") {
    throw new WorkflowError("Manual workflows are completed by hand.", "INVALID_TRANSITION")
  }
  // A FAILED run must go through RETRY, which resets its failed steps. Letting
  // RESUME move it to ASSISTED without that reset would immediately fail again.
  if (run.state !== "PAUSED") {
    throw new WorkflowError(`Cannot resume a ${run.state} workflow.`, "INVALID_TRANSITION")
  }

  if (run.reviewTasks.length > 0) {
    return moveState(userId, runId, "AWAITING_REVIEW", {
      from: ["PAUSED"],
      event: "RUN_RESUMED",
      message: "Workflow resumed with an open review checkpoint.",
      startedAt: new Date(),
    })
  }

  await prisma.$transaction(async (tx) => {
    if (run.steps.length > 0) {
      await tx.workflowStep.updateMany({
        where: { runId, status: "WAITING_FOR_USER" },
        data: { status: "PENDING", nextAttemptAt: new Date() },
      })
    }
    const changed = await tx.workflowRun.updateMany({
      where: { id: runId, userId, state: "PAUSED" },
      data: {
        state: "ASSISTED",
        stateVersion: { increment: 1 },
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        startedAt: new Date(),
      },
    })
    if (changed.count === 0) {
      throw new WorkflowError("The workflow moved; reload and try again.", "INVALID_TRANSITION")
    }
    await writeEvent(tx, runId, "RUN_RESUMED", "Workflow resumed by the user.")
  })
  return (await getWorkflow(userId, runId))!
}

/** Retry resets only failed steps; completed work is never repeated. */
export async function retryWorkflow(
  userId: string,
  runId: string
): Promise<WorkflowRunDTO> {
  await prisma.$transaction(async (tx) => {
    // Ownership first: a foreign run must not have its steps reset even if the
    // caller guessed its id.
    const run = await tx.workflowRun.findFirst({
      where: { id: runId, userId },
      select: { state: true },
    })
    if (!run) throw new WorkflowError("Workflow not found", "NOT_FOUND")
    if (run.state !== "FAILED") {
      throw new WorkflowError(`Cannot retry a ${run.state} workflow.`, "INVALID_TRANSITION")
    }

    const failed = await tx.workflowStep.findMany({
      where: { runId, status: "FAILED" },
      select: { id: true },
    })
    if (failed.length === 0) {
      throw new WorkflowError("Nothing failed to retry.", "INVALID_TRANSITION")
    }
    await tx.workflowStep.updateMany({
      where: { runId, status: "FAILED" },
      data: {
        status: "PENDING",
        attempts: 0,
        recoveryCount: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        startedAt: null,
        finishedAt: null,
      },
    })
    const resumed = await tx.workflowRun.updateMany({
      where: { id: runId, userId, state: "FAILED" },
      data: {
        state: "ASSISTED",
        stateVersion: { increment: 1 },
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    })
    if (resumed.count === 0) {
      throw new WorkflowError("The workflow moved; reload and try again.", "INVALID_TRANSITION")
    }
    await writeEvent(tx, runId, "RETRY_SCHEDULED", "Failed steps reset for retry.", {
      stepCount: failed.length,
    })
  })
  return (await getWorkflow(userId, runId))!
}

export async function cancelWorkflow(
  userId: string,
  runId: string
): Promise<WorkflowRunDTO> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    select: { state: true },
  })
  if (!run) throw new WorkflowError("Workflow not found", "NOT_FOUND")
  if (TERMINAL_STATES.includes(run.state)) {
    throw new WorkflowError(`A ${run.state} workflow cannot be cancelled.`, "INVALID_TRANSITION")
  }

  await prisma.$transaction(async (tx) => {
    const changed = await tx.workflowRun.updateMany({
      where: { id: runId, userId, state: { notIn: [...TERMINAL_STATES] } },
      data: {
        state: "CANCELLED",
        stateVersion: { increment: 1 },
        leaseOwner: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
      },
    })
    if (changed.count === 0) {
      throw new WorkflowError("The workflow already finished.", "INVALID_TRANSITION")
    }
    await tx.workflowStep.updateMany({
      where: { runId, status: { in: ["PENDING", "RUNNING", "WAITING_FOR_USER"] } },
      data: { status: "CANCELLED", finishedAt: new Date() },
    })
    await tx.reviewTask.updateMany({
      where: { runId, status: "OPEN" },
      data: { status: "EXPIRED", resolvedAt: new Date() },
    })
    await writeEvent(tx, runId, "RUN_CANCELLED", "Workflow cancelled by the user.")
  })
  return (await getWorkflow(userId, runId))!
}

/**
 * Manual-mode compatibility: a manual run's step is completed by the user, and
 * the same application records are used. Completing the last required step
 * finishes the run.
 */
export async function completeManualStep(
  userId: string,
  runId: string,
  stepName: WorkflowStepName
): Promise<WorkflowRunDTO> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    select: { id: true, mode: true, state: true, startedAt: true },
  })
  if (!run) throw new WorkflowError("Workflow not found", "NOT_FOUND")
  if (run.mode !== "MANUAL" || run.state === "CANCELLED") {
    throw new WorkflowError("Only a manual workflow can complete steps by hand.", "INVALID_TRANSITION")
  }

  const definition = stepDefinition(stepName)
  await prisma.$transaction(async (tx) => {
    const step = await tx.workflowStep.findFirst({
      where: { runId, name: definition.name },
      select: { id: true, status: true },
    })
    if (!step) throw new WorkflowError("Step not found", "NOT_FOUND")
    if (step.status === "COMPLETED" || step.status === "SKIPPED") return

    await tx.workflowStep.update({
      where: { id: step.id },
      data: {
        status: "COMPLETED",
        startedAt: step.status === "PENDING" ? new Date() : undefined,
        finishedAt: new Date(),
        output: json({ manual: true, completedBy: "user" }),
      },
    })
    await writeEvent(
      tx,
      runId,
      "STEP_COMPLETED",
      `${definition.name} completed manually.`,
      { manual: true },
      step.id
    )

    const remaining = await tx.workflowStep.count({
      where: { runId, required: true, status: { notIn: ["COMPLETED", "SKIPPED"] } },
    })
    if (remaining === 0) {
      await tx.workflowRun.update({
        where: { id: runId },
        data: {
          state: "COMPLETED",
          stateVersion: { increment: 1 },
          startedAt: run.startedAt ?? new Date(),
          finishedAt: new Date(),
        },
      })
      await writeEvent(tx, runId, "RUN_COMPLETED", "All required manual steps are complete.")
    }
  })
  return (await getWorkflow(userId, runId))!
}

/** Review tasks ------------------------------------------------------------ */

const REVIEW_TASK_SELECT = {
  id: true,
  runId: true,
  stepId: true,
  jobApplicationId: true,
  atsPreparationId: true,
  kind: true,
  status: true,
  question: true,
  reason: true,
  category: true,
  fallback: true,
  suggestedValue: true,
  answer: true,
  resolvedAt: true,
  createdAt: true,
} as const

function reviewDto(task: {
  id: string
  runId: string | null
  stepId: string | null
  jobApplicationId: string | null
  atsPreparationId: string | null
  kind: ReviewTaskKind
  status: string
  question: string
  reason: string
  category: string | null
  fallback: string | null
  suggestedValue: unknown
  answer: unknown
  resolvedAt: Date | null
  createdAt: Date
}): ReviewTaskDTO {
  return {
    id: task.id,
    runId: task.runId,
    stepId: task.stepId,
    jobApplicationId: task.jobApplicationId,
    atsPreparationId: task.atsPreparationId,
    kind: task.kind,
    status: task.status as ReviewTaskDTO["status"],
    question: task.question,
    reason: task.reason,
    category: task.category,
    fallback: task.fallback,
    suggestedValue: asJsonValue(task.suggestedValue),
    answer: asJsonValue(task.answer),
    resolvedAt: task.resolvedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
  }
}

/** Ownership + ATS linkage for a review action, without exposing the answer. */
export async function getReviewTaskRef(
  userId: string,
  taskId: string
): Promise<{ id: string; status: string; atsPreparationId: string | null } | null> {
  return prisma.reviewTask.findFirst({
    where: { id: taskId, userId },
    select: { id: true, status: true, atsPreparationId: true },
  })
}

/** Full owner-scoped task DTO for a route that just changed it. */
export async function getReviewTask(
  userId: string,
  taskId: string
): Promise<ReviewTaskDTO | null> {
  const task = await prisma.reviewTask.findFirst({
    where: { id: taskId, userId },
    select: REVIEW_TASK_SELECT,
  })
  return task ? reviewDto(task) : null
}

export async function listReviewTasks(
  userId: string,
  filters: { status?: string; kind?: ReviewTaskKind; limit?: number } = {}
): Promise<ReviewTaskDTO[]> {
  const tasks = await prisma.reviewTask.findMany({
    where: {
      userId,
      status: (filters.status as never) ?? "OPEN",
      ...(filters.kind ? { kind: filters.kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, filters.limit ?? 20)),
    select: REVIEW_TASK_SELECT,
  })
  return tasks.map(reviewDto)
}

/** A standalone task (extension/manual) has no run and cannot advance one. */
export async function createStandaloneReviewTask(
  userId: string,
  input: {
    jobApplicationId?: string | null
    kind: ReviewTaskKind
    question: string
    reason: string
    category?: string | null
    fallback?: string | null
    suggestedValue?: JsonValue
  }
): Promise<ReviewTaskDTO> {
  if (input.jobApplicationId) {
    const application = await prisma.jobApplication.findFirst({
      where: { id: input.jobApplicationId, userId },
      select: { id: true },
    })
    if (!application) throw new WorkflowError("Application not found", "NOT_FOUND")
  }
  const task = await prisma.reviewTask.create({
    data: {
      userId,
      jobApplicationId: input.jobApplicationId ?? null,
      kind: input.kind,
      question: input.question.slice(0, 2000),
      reason: input.reason.slice(0, 2000),
      category: input.category ?? null,
      fallback: input.fallback ?? null,
      ...(input.suggestedValue !== undefined
        ? { suggestedValue: json(input.suggestedValue) }
        : {}),
    },
    select: REVIEW_TASK_SELECT,
  })
  return reviewDto(task)
}

/**
 * Resolving the last open checkpoint resumes the run. A submission-confirmation
 * checkpoint completes the HUMAN_REVIEW step; every other kind re-queues the
 * waiting step with the answer attached, without burning an attempt.
 */
export async function resolveReviewTask(
  userId: string,
  taskId: string,
  answer: JsonValue
): Promise<{ task: ReviewTaskDTO; run: WorkflowRunDTO | null }> {
  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.reviewTask.findFirst({
      where: { id: taskId, userId },
      select: { ...REVIEW_TASK_SELECT, runId: true, stepId: true },
    })
    if (!task) throw new WorkflowError("Review task not found", "NOT_FOUND")
    if (task.status !== "OPEN") {
      throw new WorkflowError("That review task is no longer open.", "TASK_NOT_OPEN")
    }

    // Conditional on OPEN so two simultaneous answers cannot both resume the
    // same checkpoint and create duplicate work.
    const changed = await tx.reviewTask.updateMany({
      where: { id: task.id, userId, status: "OPEN" },
      data: {
        status: "RESOLVED",
        answer: json(answer),
        resolvedAt: new Date(),
        resolvedBy: userId,
      },
    })
    if (changed.count === 0) {
      throw new WorkflowError("That review task is no longer open.", "TASK_NOT_OPEN")
    }
    const updated = await tx.reviewTask.findFirst({
      where: { id: task.id, userId },
      select: REVIEW_TASK_SELECT,
    })
    if (!updated) throw new WorkflowError("Review task not found", "NOT_FOUND")

    if (!task.runId) return { task: updated, runId: null }

    const run = await tx.workflowRun.findFirst({
      where: { id: task.runId, userId },
      select: { id: true, state: true },
    })
    if (!run) return { task: updated, runId: null }

    const stillOpen = await tx.reviewTask.count({
      where: { runId: task.runId, status: "OPEN" },
    })

    if (task.kind === "SUBMISSION_CONFIRMATION" && task.stepId) {
      // Only an explicit `{ approved: true }` answer approves the checkpoint.
      // A decline is still a completed human review; staging then refuses and
      // the workflow reports why instead of pretending consent was given.
      const approved =
        Boolean(answer) &&
        typeof answer === "object" &&
        !Array.isArray(answer) &&
        (answer as Record<string, unknown>).approved === true

      await tx.workflowStep.update({
        where: { id: task.stepId },
        data: {
          status: "COMPLETED",
          finishedAt: new Date(),
          output: json({ approved, reviewTaskId: task.id }),
        },
      })
      await writeEvent(
        tx,
        task.runId,
        "STEP_COMPLETED",
        approved
          ? "Human review approved the staged application."
          : "Human review declined; nothing will be staged.",
        { reviewTaskId: task.id, approved },
        task.stepId
      )
    } else if (task.stepId) {
      const step = await tx.workflowStep.findUnique({
        where: { id: task.stepId },
        select: { input: true },
      })
      const previous =
        step?.input && typeof step.input === "object" && !Array.isArray(step.input)
          ? (step.input as Record<string, unknown>)
          : {}
      await tx.workflowStep.update({
        where: { id: task.stepId },
        data: {
          status: "PENDING",
          attempts: 0,
          recoveryCount: 0,
          nextAttemptAt: new Date(),
          lastError: null,
          input: json({ ...previous, reviewAnswer: answer }),
        },
      })
    }

    if (stillOpen === 0 && run.state === "AWAITING_REVIEW") {
      await tx.workflowRun.update({
        where: { id: run.id },
        data: {
          state: "ASSISTED",
          stateVersion: { increment: 1 },
          leaseOwner: null,
          leaseExpiresAt: null,
          startedAt: new Date(),
        },
      })
      await writeEvent(tx, run.id, "REVIEW_RESOLVED", "Review answered; workflow resumed.")
    }

    return { task: updated, runId: task.runId }
  })

  return {
    task: reviewDto(result.task),
    run: result.runId ? await getWorkflow(userId, result.runId) : null,
  }
}

/** Dismissing the last open checkpoint pauses the run with the reason kept. */
export async function dismissReviewTask(
  userId: string,
  taskId: string,
  reason?: string
): Promise<{ task: ReviewTaskDTO; run: WorkflowRunDTO | null }> {
  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.reviewTask.findFirst({
      where: { id: taskId, userId },
      select: REVIEW_TASK_SELECT,
    })
    if (!task) throw new WorkflowError("Review task not found", "NOT_FOUND")
    if (task.status !== "OPEN") {
      throw new WorkflowError("That review task is no longer open.", "TASK_NOT_OPEN")
    }

    const changed = await tx.reviewTask.updateMany({
      where: { id: task.id, userId, status: "OPEN" },
      data: {
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedBy: userId,
        ...(reason ? { answer: json({ dismissed: true, reason: reason.slice(0, 1000) }) } : {}),
      },
    })
    if (changed.count === 0) {
      throw new WorkflowError("That review task is no longer open.", "TASK_NOT_OPEN")
    }
    const updated = await tx.reviewTask.findFirst({
      where: { id: task.id, userId },
      select: REVIEW_TASK_SELECT,
    })
    if (!updated) throw new WorkflowError("Review task not found", "NOT_FOUND")

    if (!task.runId) return { task: updated, runId: null }
    const run = await tx.workflowRun.findFirst({
      where: { id: task.runId, userId },
      select: { id: true, state: true },
    })
    if (!run) return { task: updated, runId: null }

    if (run.state === "AWAITING_REVIEW") {
      const stillOpen = await tx.reviewTask.count({
        where: { runId: run.id, status: "OPEN" },
      })
      if (stillOpen === 0) {
        await tx.workflowRun.update({
          where: { id: run.id },
          data: {
            state: "PAUSED",
            stateVersion: { increment: 1 },
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        })
        await writeEvent(
          tx,
          run.id,
          "RUN_PAUSED",
          reason
            ? `Review dismissed: ${reason.slice(0, 200)}`
            : "Review dismissed; workflow paused."
        )
      }
    }
    return { task: updated, runId: task.runId }
  })

  return {
    task: reviewDto(result.task),
    run: result.runId ? await getWorkflow(userId, result.runId) : null,
  }
}
