import { randomUUID } from "node:crypto"

import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/shared/lib/prisma"
import { logger, redactText } from "@/shared/lib/logger"

import { getExecutor } from "../executors"
import type {
  WorkflowRunInput,
  WorkflowStepName,
  WorkflowStepOutcome,
} from "../types"

const log = logger("workflow-worker")

/** A run lease is short enough to recover quickly and long enough for one step. */
export const WORKFLOW_LEASE_MS = 60_000
/** Renewal cadence while a step runs, well inside the lease. */
const LEASE_RENEW_MS = 20_000
/** At most this many independent steps run at once. */
export const MAX_CONCURRENT_STEPS = 2
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 30_000
const MAX_RUNS_PER_TICK = 3

const WORKER_ID = `worker-${process.pid}-${randomUUID()}`

class WorkflowMovedError extends Error {}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

type DbStep = {
  id: string
  name: string
  status: string
  required: boolean
  dependsOn: string[]
  attempts: number
  maxAttempts: number
  timeoutMs: number
  nextAttemptAt: Date | null
}

function nowPlus(ms: number, now: Date): Date {
  return new Date(now.getTime() + ms)
}

function safeError(error: unknown): string {
  if (error instanceof Error) {
    // Provider messages can carry endpoints or keys; neither belongs in a
    // persisted event or a user-facing failure reason.
    return error.name === "AbortError"
      ? "The step timed out."
      : redactText(error.message.split("\n")[0]!, 300)
  }
  return "The step failed unexpectedly."
}

/** A conditional claim: only one worker can turn an unattended run into a lease. */
export async function claimNextRun(now: Date = new Date()): Promise<string | null> {
  const candidates = await prisma.workflowRun.findMany({
    where: {
      state: "ASSISTED",
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true },
  })

  for (const candidate of candidates) {
    const claimed = await prisma.workflowRun.updateMany({
      where: {
        id: candidate.id,
        state: "ASSISTED",
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        leaseOwner: WORKER_ID,
        leaseExpiresAt: nowPlus(WORKFLOW_LEASE_MS, now),
      },
    })
    if (claimed.count === 1) return candidate.id
  }
  return null
}

async function renewLease(runId: string): Promise<boolean> {
  const renewed = await prisma.workflowRun.updateMany({
    where: { id: runId, leaseOwner: WORKER_ID, state: "ASSISTED" },
    data: { leaseExpiresAt: nowPlus(WORKFLOW_LEASE_MS, new Date()) },
  })
  return renewed.count === 1
}

async function releaseLease(runId: string): Promise<void> {
  await prisma.workflowRun.updateMany({
    where: { id: runId, leaseOwner: WORKER_ID },
    data: { leaseOwner: null, leaseExpiresAt: null },
  })
}

/**
 * Restart recovery. A `RUNNING` step whose worker died is put back to `PENDING`;
 * its attempt count is preserved, so a crash loop cannot retry forever. The
 * output was never committed, so replay is safe.
 */
export async function recoverExpiredLeases(now: Date = new Date()): Promise<number> {
  const expired = await prisma.workflowRun.findMany({
    where: { state: "ASSISTED", leaseExpiresAt: { lt: now } },
    select: { id: true },
    take: 20,
  })

  let recovered = 0
  for (const run of expired) {
    recovered += await prisma.$transaction(async (tx) => {
      const cleared = await tx.workflowRun.updateMany({
        where: { id: run.id, state: "ASSISTED", leaseExpiresAt: { lt: now } },
        data: { leaseOwner: null, leaseExpiresAt: null, stateVersion: { increment: 1 } },
      })
      if (cleared.count === 0) return 0

      const reset = await tx.workflowStep.updateMany({
        where: { runId: run.id, status: "RUNNING" },
        data: {
          status: "PENDING",
          // The interrupted attempt never committed, so it is refunded. A crash
          // must not permanently exhaust a step whose attempt cap is one;
          // deterministic failures still count because they commit first.
          attempts: { decrement: 1 },
          nextAttemptAt: new Date(),
          startedAt: null,
        },
      })
      await tx.workflowEvent.create({
        data: {
          runId: run.id,
          type: "LEASE_RECLAIMED",
          message: "Expired worker lease reclaimed on restart.",
          metadata: { stepCount: reset.count },
        },
      })
      return 1
    })
  }
  return recovered
}

function dependenciesSatisfied(step: DbStep, byName: Map<string, DbStep>): boolean {
  return step.dependsOn.every((name) => {
    const dependency = byName.get(name)
    return dependency?.status === "COMPLETED" || dependency?.status === "SKIPPED"
  })
}

/** Commit guard: if the user paused or cancelled while the step ran, roll back. */
async function bumpRunIfOwned(
  tx: Prisma.TransactionClient,
  runId: string
): Promise<void> {
  const owned = await tx.workflowRun.updateMany({
    where: { id: runId, state: "ASSISTED", leaseOwner: WORKER_ID },
    data: { stateVersion: { increment: 1 } },
  })
  if (owned.count === 0) throw new WorkflowMovedError()
}

async function commitCompleted(
  runId: string,
  stepId: string,
  stepName: string,
  claimedAt: Date,
  outcome: Extract<WorkflowStepOutcome, { status: "COMPLETED" }>
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await bumpRunIfOwned(tx, runId)
    const committed = await tx.workflowStep.updateMany({
      where: { id: stepId, status: "RUNNING", startedAt: claimedAt },
      data: {
        status: "COMPLETED",
        output: outcome.output,
        finishedAt: new Date(),
        lastError: null,
        nextAttemptAt: null,
      },
    })
    // A resumed or re-claimed run has a newer startedAt. This worker's output
    // must not overwrite that attempt's state.
    if (committed.count === 0) throw new WorkflowMovedError()
    await tx.workflowEvent.create({
      data: {
        runId,
        stepId,
        type: "STEP_COMPLETED",
        message: `${stepName}: ${outcome.summary}`,
        metadata: { summary: outcome.summary },
      },
    })
  })
}

async function commitWaiting(
  runId: string,
  stepId: string,
  stepName: string,
  claimedAt: Date,
  outcome: Extract<WorkflowStepOutcome, { status: "WAITING_FOR_USER" }>
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await bumpRunIfOwned(tx, runId)
    const owned = await tx.workflowStep.updateMany({
      where: { id: stepId, status: "RUNNING", startedAt: claimedAt },
      data: { status: "WAITING_FOR_USER", finishedAt: null, nextAttemptAt: null },
    })
    if (owned.count === 0) throw new WorkflowMovedError()
    const run = await tx.workflowRun.findUniqueOrThrow({
      where: { id: runId },
      select: { userId: true, jobApplicationId: true },
    })
    const existing = await tx.reviewTask.findFirst({
      where: { runId, question: outcome.review.question, status: "OPEN" },
      select: { id: true },
    })
    const task =
      existing ??
      (await tx.reviewTask.create({
        data: {
          userId: run.userId,
          runId,
          stepId,
          jobApplicationId: run.jobApplicationId,
          kind: outcome.review.kind,
          question: outcome.review.question,
          reason: outcome.review.reason,
          category: outcome.review.category ?? null,
          fallback: outcome.review.fallback ?? null,
          ...(outcome.review.suggestedValue !== undefined
            ? { suggestedValue: json(outcome.review.suggestedValue) }
            : {}),
        },
        select: { id: true },
      }))

    await tx.workflowRun.update({
      where: { id: runId },
      data: {
        state: "AWAITING_REVIEW",
        leaseOwner: null,
        leaseExpiresAt: null,
        stateVersion: { increment: 1 },
      },
    })
    await tx.workflowEvent.create({
      data: {
        runId,
        stepId,
        type: "STEP_WAITING_FOR_USER",
        message: `${stepName} is waiting for a human answer.`,
        metadata: { reviewTaskId: task.id, kind: outcome.review.kind },
      },
    })
    await tx.workflowEvent.create({
      data: {
        runId,
        stepId,
        type: "REVIEW_REQUESTED",
        message: `${stepName} needs a human answer.`,
        metadata: { reviewTaskId: task.id, kind: outcome.review.kind },
      },
    })
  })
}

async function commitSkipped(
  runId: string,
  stepId: string,
  stepName: string,
  claimedAt: Date,
  outcome: Extract<WorkflowStepOutcome, { status: "SKIPPED" }>
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await bumpRunIfOwned(tx, runId)
    const committed = await tx.workflowStep.updateMany({
      where: { id: stepId, status: "RUNNING", startedAt: claimedAt },
      data: {
        status: "SKIPPED",
        output: outcome.output ?? { skipped: true, reason: outcome.reason },
        finishedAt: new Date(),
      },
    })
    if (committed.count === 0) throw new WorkflowMovedError()
    await tx.workflowEvent.create({
      data: {
        runId,
        stepId,
        type: "STEP_SKIPPED",
        message: `${stepName} skipped: ${outcome.reason}`,
      },
    })
  })
}

/**
 * Failure handling. A retryable failure inside its attempt cap is rescheduled
 * with exponential backoff; otherwise the step is FAILED. A required failure
 * fails the run; an optional failure stays recorded and the pipeline continues.
 */
async function commitFailure(
  runId: string,
  stepId: string,
  stepName: string,
  attempt: number,
  maxAttempts: number,
  required: boolean,
  error: string,
  retryable: boolean,
  fallback: string,
  claimedAt?: Date
): Promise<void> {
  const canRetry = retryable && attempt < maxAttempts
  await prisma.$transaction(async (tx) => {
    await bumpRunIfOwned(tx, runId)
    const guard = claimedAt
      ? { id: stepId, status: "RUNNING" as const, startedAt: claimedAt }
      : { id: stepId, status: "PENDING" as const }
    if (canRetry) {
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1))
      const rescheduled = await tx.workflowStep.updateMany({
        where: guard,
        data: {
          status: "PENDING",
          lastError: error,
          nextAttemptAt: nowPlus(delay, new Date()),
          startedAt: null,
        },
      })
      if (rescheduled.count === 0) throw new WorkflowMovedError()
      await tx.workflowEvent.create({
        data: {
          runId,
          stepId,
          type: "RETRY_SCHEDULED",
          message: `${stepName} failed; retrying in ${Math.round(delay / 1000)}s.`,
          metadata: { attempt, maxAttempts },
        },
      })
      return
    }

    const failed = await tx.workflowStep.updateMany({
      where: guard,
      data: {
        status: "FAILED",
        lastError: `${error} ${fallback}`.trim().slice(0, 2000),
        finishedAt: new Date(),
      },
    })
    if (failed.count === 0) throw new WorkflowMovedError()
    await tx.workflowEvent.create({
      data: {
        runId,
        stepId,
        type: "STEP_FAILED",
        message: `${stepName} failed: ${error}`,
        metadata: { attempt, fallback },
      },
    })

    if (required) {
      await tx.workflowRun.update({
        where: { id: runId },
        data: {
          state: "FAILED",
          lastError: `${stepName}: ${error}`.slice(0, 1000),
          leaseOwner: null,
          leaseExpiresAt: null,
          stateVersion: { increment: 1 },
        },
      })
    }
  })
}

async function executeStep(
  run: {
    id: string
    userId: string
    jobApplicationId: string | null
    input: unknown
  },
  step: DbStep
): Promise<"moved" | "continued"> {
  // `startedAt` doubles as this attempt's fencing token. Every commit below
  // matches it, so an executor that outlives a pause, resume or lease recovery
  // cannot commit its stale result over the newer attempt.
  const claimedAt = new Date()
  const claimed = await prisma.workflowStep.updateMany({
    where: { id: step.id, status: "PENDING" },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      startedAt: claimedAt,
      finishedAt: null,
      nextAttemptAt: null,
      lastError: null,
    },
  })
  if (claimed.count === 0) return "continued"
  const attempt = step.attempts + 1

  await prisma.workflowEvent.create({
    data: {
      runId: run.id,
      stepId: step.id,
      type: "STEP_STARTED",
      message: `${step.name} started (attempt ${attempt}/${step.maxAttempts}).`,
      metadata: { attempt, maxAttempts: step.maxAttempts },
    },
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), step.timeoutMs)
  const timedOut = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        const error = new Error("The step timed out.")
        error.name = "AbortError"
        reject(error)
      },
      { once: true }
    )
  })
  const renewal = setInterval(() => {
    void renewLease(run.id).catch(() => undefined)
  }, LEASE_RENEW_MS)
  renewal.unref?.()

  let outcome: WorkflowStepOutcome
  try {
    const executor = getExecutor(step.name as WorkflowStepName)
    if (!executor) {
      outcome = {
        status: "FAILED",
        error: `No executor is registered for ${step.name}.`,
        retryable: false,
        fallback: "Update the app to restore this step.",
      }
    } else {
      // Race the executor against the deadline: a provider call that ignores the
      // abort signal must still become a bounded, retryable timeout.
      const execution = executor({
        runId: run.id,
        stepId: step.id,
        userId: run.userId,
        jobApplicationId: run.jobApplicationId,
        input: (run.input as WorkflowRunInput | null) ?? {},
        stepName: step.name as WorkflowStepName,
        attempt,
        signal: controller.signal,
        now: new Date(),
      })
      execution.catch(() => undefined)
      outcome = await Promise.race([execution, timedOut])
    }
  } catch (error) {
    outcome = {
      status: "FAILED",
      error: safeError(error),
      retryable: !(error instanceof WorkflowMovedError),
      fallback: "You can retry this step or continue manually.",
    }
  } finally {
    clearTimeout(timer)
    clearInterval(renewal)
  }

  try {
    if (outcome.status === "COMPLETED") {
      await commitCompleted(run.id, step.id, step.name, claimedAt, outcome)
    } else if (outcome.status === "WAITING_FOR_USER") {
      await commitWaiting(run.id, step.id, step.name, claimedAt, outcome)
    } else if (outcome.status === "SKIPPED") {
      await commitSkipped(run.id, step.id, step.name, claimedAt, outcome)
    } else {
      await commitFailure(
        run.id,
        step.id,
        step.name,
        attempt,
        step.maxAttempts,
        step.required,
        outcome.error,
        outcome.retryable,
        outcome.fallback,
        claimedAt
      )
    }
    return "continued"
  } catch (error) {
    if (error instanceof WorkflowMovedError) {
      // The user paused/cancelled or the lease was reclaimed. Return the step to
      // PENDING only if it is still ours; output is never committed.
      await prisma.workflowStep.updateMany({
        where: { id: step.id, status: "RUNNING", startedAt: claimedAt },
        data: {
          status: "PENDING",
          startedAt: null,
          // A pause/cancel during this attempt discarded its output, so refund
          // the attempt too. Without this, a max-attempts-1 step is marked
          // FAILED immediately when the user resumes.
          attempts: { decrement: 1 },
        },
      })
      return "moved"
    }
    throw error
  }
}

async function finalizeRun(runId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({
      where: { id: runId },
      select: {
        state: true,
        leaseOwner: true,
        steps: { select: { name: true, status: true, required: true, lastError: true } },
      },
    })
    if (!run || run.state !== "ASSISTED" || run.leaseOwner !== WORKER_ID) {
      throw new WorkflowMovedError()
    }

    const required = run.steps.filter((step) => step.required)
    const failed = required.find((step) => step.status === "FAILED")
    const cancelled = run.steps.find((step) => step.status === "CANCELLED")
    const unfinished = required.find(
      (step) => step.status !== "COMPLETED" && step.status !== "SKIPPED"
    )

    const state = failed || unfinished ? "FAILED" : cancelled ? "CANCELLED" : "COMPLETED"
    const lastError =
      state === "FAILED"
        ? failed
          ? `${failed.name}: ${failed.lastError ?? "step failed"}`
          : `${unfinished?.name ?? "A required step"}: not completed`
        : null

    await tx.workflowRun.update({
      where: { id: runId },
      data: {
        state,
        lastError: lastError?.slice(0, 1000) ?? null,
        leaseOwner: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
        stateVersion: { increment: 1 },
      },
    })
    await tx.workflowEvent.create({
      data: {
        runId,
        type: state === "COMPLETED" ? "RUN_COMPLETED" : "STEP_FAILED",
        message:
          state === "COMPLETED"
            ? "All required steps completed."
            : `Workflow stopped: ${lastError}`,
      },
    })
  })
}

/**
 * Executes one claimed run until it pauses, waits, fails or completes. The loop
 * is bounded by the persisted step statuses: a step that already has an output
 * is never executed again, and retries are capped by `maxAttempts`.
 */
export async function executeWorkflowRun(runId: string): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    if (!(await renewLease(runId))) return

    const run = await prisma.workflowRun.findFirst({
      where: { id: runId, leaseOwner: WORKER_ID },
      select: { id: true, userId: true, jobApplicationId: true, input: true, state: true },
    })
    if (!run || run.state !== "ASSISTED") return

    const steps = (await prisma.workflowStep.findMany({
      where: { runId },
      select: {
        id: true,
        name: true,
        status: true,
        required: true,
        dependsOn: true,
        attempts: true,
        maxAttempts: true,
        timeoutMs: true,
        nextAttemptAt: true,
      },
      orderBy: { order: "asc" },
    })) as DbStep[]

    const byName = new Map(steps.map((step) => [step.name, step]))
    const now = Date.now()

    // A step recovered at its attempt cap can never run again; record it rather
    // than leaving the run pending forever.
    for (const step of steps) {
      if (step.status === "PENDING" && step.attempts >= step.maxAttempts) {
        await commitFailure(
          run.id,
          step.id,
          step.name,
          step.attempts,
          step.maxAttempts,
          step.required,
          "The attempt cap was reached before this step could run.",
          false,
          "Open the step to retry or continue manually."
        )
        const refreshed = await prisma.workflowRun.findUnique({
          where: { id: run.id },
          select: { state: true },
        })
        if (refreshed?.state !== "ASSISTED") return
      }
    }

    const eligible = steps.filter(
      (step) =>
        step.status === "PENDING" &&
        step.attempts < step.maxAttempts &&
        dependenciesSatisfied(step, byName) &&
        (!step.nextAttemptAt || step.nextAttemptAt.getTime() <= now)
    )

    if (eligible.length === 0) {
      const delayed = steps.some(
        (step) =>
          step.status === "PENDING" &&
          step.attempts < step.maxAttempts &&
          (!step.nextAttemptAt || step.nextAttemptAt.getTime() > now)
      )
      if (delayed) {
        await releaseLease(run.id)
        return
      }
      try {
        await finalizeRun(run.id)
      } catch (error) {
        if (!(error instanceof WorkflowMovedError)) throw error
      }
      return
    }

    const batch = eligible.slice(0, MAX_CONCURRENT_STEPS)
    const results = await Promise.all(
      batch.map((step) =>
        executeStep(
          {
            id: run.id,
            userId: run.userId,
            jobApplicationId: run.jobApplicationId,
            input: run.input,
          },
          step
        )
      )
    )
    if (results.includes("moved")) return

    const after = await prisma.workflowRun.findUnique({
      where: { id: run.id },
      select: { state: true, leaseOwner: true },
    })
    if (!after || after.state !== "ASSISTED" || after.leaseOwner !== WORKER_ID) return
  }

  // A pipeline never needs fifty rounds; if it somehow does, the lease simply
  // expires and the next tick resumes from persisted state.
  await releaseLease(runId)
}

/** One tick: recover dead leases, then execute up to a few claimed runs. */
export async function tickWorkflowWorker(now: Date = new Date()): Promise<void> {
  await recoverExpiredLeases(now)
  for (let index = 0; index < MAX_RUNS_PER_TICK; index += 1) {
    const runId = await claimNextRun(now)
    if (!runId) return
    try {
      await executeWorkflowRun(runId)
    } catch (error) {
      log.error("Workflow run failed unexpectedly", { err: error, runId })
      await releaseLease(runId)
    }
  }
}

let started = false
let interval: NodeJS.Timeout | null = null
let ticking = false

/**
 * Starts the single in-process worker. Guarded so `next build`, tests and a
 * short-lived script never start a loop. The interval is unref'd so it cannot
 * keep the desktop process alive on shutdown.
 */
export function startWorkflowWorker(): void {
  if (started) return
  if (process.env.NODE_ENV === "test" || process.env.NEXT_PHASE === "phase-production-build") return
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return
  started = true

  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      await tickWorkflowWorker()
    } catch (error) {
      log.error("Workflow worker tick failed", { err: error })
    } finally {
      ticking = false
    }
  }

  void tick()
  interval = setInterval(() => void tick(), 5_000)
  interval.unref?.()
}

export function stopWorkflowWorker(): void {
  if (interval) clearInterval(interval)
  interval = null
  started = false
}

/** Test seam: expose the worker id used for claim ownership. */
export function currentWorkerId(): string {
  return WORKER_ID
}
