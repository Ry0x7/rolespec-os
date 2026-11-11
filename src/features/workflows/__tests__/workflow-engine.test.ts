// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkflowStepName, WorkflowStepOutcome } from "../types"
import { createFakePrisma, type FakePrisma } from "./fake-prisma"

const holder = vi.hoisted(() => ({
  prisma: null as unknown,
  executors: {} as Record<string, (context: unknown) => Promise<WorkflowStepOutcome>>,
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, key) => (holder.prisma as Record<string | symbol, unknown>)[key],
    }
  ),
}))

vi.mock("../executors", () => ({
  getExecutor: (name: string) => holder.executors[name],
}))

import {
  claimNextRun,
  executeWorkflowRun,
  recoverExpiredLeases,
  tickWorkflowWorker,
} from "../services/workflow-worker"
import {
  WorkflowError,
  cancelWorkflow,
  completeManualStep,
  createWorkflow,
  getWorkflow,
  resolveReviewTask,
  resumeWorkflow,
  retryWorkflow,
  startWorkflow,
} from "../services/workflow.service"

let fake: FakePrisma

const COMPLETED = (name: string): WorkflowStepOutcome => ({
  status: "COMPLETED",
  summary: `${name} done`,
  output: { step: name },
})

function allExecutorsComplete(): void {
  holder.executors = Object.fromEntries(
    (
      [
        "PROFILE",
        "DISCOVER",
        "RANK",
        "RESEARCH",
        "TAILOR",
        "VALIDATE",
        "PREPARE_ATS",
        "HUMAN_REVIEW",
        "SUBMISSION_STAGING",
        "TRACKING",
        "FOLLOW_UP",
      ] as WorkflowStepName[]
    ).map((name) => [name, async () => COMPLETED(name)])
  )
}

async function startedRun(idempotencyKey?: string) {
  const created = await createWorkflow("user-1", {
    mode: "AGENT_ASSISTED",
    idempotencyKey,
  })
  return startWorkflow("user-1", created.id)
}

beforeEach(() => {
  fake = createFakePrisma()
  holder.prisma = fake.prisma
  allExecutorsComplete()
})

describe("workflow engine", () => {
  it("creates one run per idempotency key", async () => {
    const first = await createWorkflow("user-1", {
      mode: "AGENT_ASSISTED",
      idempotencyKey: "replay-key-1",
    })
    const second = await createWorkflow("user-1", {
      mode: "AGENT_ASSISTED",
      idempotencyKey: "replay-key-1",
    })

    expect(second.id).toBe(first.id)
    expect(fake.runs).toHaveLength(1)
    expect(fake.steps).toHaveLength(11)
    expect(fake.events.filter((event) => event.type === "RUN_CREATED")).toHaveLength(1)
  })

  it("executes the whole pipeline once and completes the run", async () => {
    const run = await startedRun()
    await tickWorkflowWorker()

    const finished = await getWorkflow("user-1", run.id)
    if (finished?.state !== "COMPLETED") {
      console.log("DEBUG", JSON.stringify({
        state: finished?.state,
        steps: fake.steps.map((step) => ({ name: step.name, status: step.status, attempts: step.attempts, error: step.lastError })),
        events: fake.events.map((event) => ({ type: event.type, message: event.message })),
      }, null, 2))
    }
    expect(finished?.state).toBe("COMPLETED")
    expect(finished?.steps.every((step) => step.status === "COMPLETED")).toBe(true)
    expect(fake.events.map((event) => event.type)).toContain("RUN_COMPLETED")

    // A second tick does nothing: completed runs are never claimed.
    const before = fake.events.length
    await tickWorkflowWorker()
    expect(fake.events.length).toBe(before)
  })

  it("lets an optional step fail without failing required work", async () => {
    holder.executors.DISCOVER = async () => ({
      status: "FAILED",
      error: "No board answered.",
      retryable: false,
      fallback: "Use the board search links manually.",
    })
    const run = await startedRun()
    await tickWorkflowWorker()

    const finished = await getWorkflow("user-1", run.id)
    expect(finished?.state).toBe("COMPLETED")
    expect(finished?.steps.find((step) => step.name === "DISCOVER")?.status).toBe("FAILED")
    expect(finished?.steps.find((step) => step.name === "RANK")?.status).toBe("COMPLETED")
  })

  it("stops at a human checkpoint and resumes after the answer", async () => {
    holder.executors.HUMAN_REVIEW = async () => ({
      status: "WAITING_FOR_USER",
      review: {
        kind: "SUBMISSION_CONFIRMATION",
        question: "Continue with the prepared application?",
        reason: "Nothing is submitted automatically.",
        fallback: "Apply manually in the ATS.",
      },
    })

    const run = await startedRun()
    await tickWorkflowWorker()

    const paused = await getWorkflow("user-1", run.id)
    expect(paused?.state).toBe("AWAITING_REVIEW")
    expect(paused?.openReviewTaskIds).toHaveLength(1)
    expect(fake.steps.find((step) => step.name === "HUMAN_REVIEW")?.status).toBe(
      "WAITING_FOR_USER"
    )

    const resolved = await resolveReviewTask(
      "user-1",
      paused!.openReviewTaskIds[0]!,
      { approved: true }
    )
    expect(resolved.run?.state).toBe("ASSISTED")
    await expect(
      resolveReviewTask("user-1", paused!.openReviewTaskIds[0]!, { approved: true })
    ).rejects.toMatchObject({ code: "TASK_NOT_OPEN" })

    await tickWorkflowWorker()
    const finished = await getWorkflow("user-1", run.id)
    expect(finished?.state).toBe("COMPLETED")
    expect(finished?.steps.find((step) => step.name === "HUMAN_REVIEW")?.status).toBe(
      "COMPLETED"
    )
  })

  it("records a declined checkpoint as not approved", async () => {
    holder.executors.HUMAN_REVIEW = async () => ({
      status: "WAITING_FOR_USER",
      review: {
        kind: "SUBMISSION_CONFIRMATION",
        question: "Continue with the prepared application?",
        reason: "Nothing is submitted automatically.",
        fallback: "Apply manually in the ATS.",
      },
    })

    const run = await startedRun()
    await tickWorkflowWorker()
    const paused = await getWorkflow("user-1", run.id)

    const resolved = await resolveReviewTask(
      "user-1",
      paused!.openReviewTaskIds[0]!,
      { approved: false }
    )
    expect(resolved.run?.state).toBe("ASSISTED")

    const reviewStep = fake.steps.find((step) => step.name === "HUMAN_REVIEW")
    expect(reviewStep?.status).toBe("COMPLETED")
    expect(reviewStep?.output).toMatchObject({ approved: false })
  })

  it("discards a step result when paused, then resumes without burning the attempt", async () => {
    let pauses = 0
    holder.executors.RANK = async () => {
      if (pauses === 0) {
        pauses += 1
        const db = fake.prisma as unknown as {
          workflowRun: { updateMany: (args: unknown) => Promise<unknown> }
        }
        await db.workflowRun.updateMany({
          where: { state: "ASSISTED" },
          data: { state: "PAUSED" },
        })
      }
      return COMPLETED("RANK")
    }

    const run = await startedRun()
    await tickWorkflowWorker()

    const paused = await getWorkflow("user-1", run.id)
    expect(paused?.state).toBe("PAUSED")
    const rank = paused?.steps.find((step) => step.name === "RANK")
    expect(rank?.status).toBe("PENDING")
    expect(rank?.output).toBeNull()
    expect(rank?.attempts).toBe(0)

    await resumeWorkflow("user-1", run.id)
    await tickWorkflowWorker()
    const resumed = await getWorkflow("user-1", run.id)
    expect(resumed?.state).toBe("COMPLETED")
    expect(resumed?.steps.find((step) => step.name === "RANK")?.attempts).toBe(1)
  })

  it("retries a transient failure with backoff, then succeeds", async () => {
    let attempts = 0
    holder.executors.RESEARCH = async () => {
      attempts += 1
      if (attempts === 1) {
        return {
          status: "FAILED",
          error: "Provider timed out.",
          retryable: true,
          fallback: "Retry or run research manually.",
        }
      }
      return COMPLETED("RESEARCH")
    }

    const run = await startedRun()
    await tickWorkflowWorker()

    const waiting = await getWorkflow("user-1", run.id)
    const research = waiting?.steps.find((step) => step.name === "RESEARCH")
    expect(research?.status).toBe("PENDING")
    expect(research?.attempts).toBe(1)
    expect(fake.events.some((event) => event.type === "RETRY_SCHEDULED")).toBe(true)

    const row = fake.steps.find((step) => step.name === "RESEARCH")!
    row.nextAttemptAt = new Date(0)
    await tickWorkflowWorker()
    const finished = await getWorkflow("user-1", run.id)
    expect(finished?.state).toBe("COMPLETED")
    expect(finished?.steps.find((step) => step.name === "RESEARCH")?.attempts).toBe(2)
  })

  it("turns a step that ignores its abort signal into a bounded timeout", async () => {
    holder.executors.PROFILE = () => new Promise<WorkflowStepOutcome>(() => undefined)
    const run = await startedRun()
    const profile = fake.steps.find((step) => step.name === "PROFILE")!
    profile.timeoutMs = 10

    await tickWorkflowWorker()

    const finished = await getWorkflow("user-1", run.id)
    expect(finished?.state).toBe("FAILED")
    expect(profile.status).toBe("FAILED")
    expect(profile.lastError).toContain("timed out")
  })

  it("reclaims an expired lease and requeues the running step", async () => {
    const run = await startedRun()
    const runRow = fake.runs[0]!
    runRow.leaseOwner = "dead-worker"
    runRow.leaseExpiresAt = new Date(Date.now() - 120_000)
    const profile = fake.steps.find((step) => step.name === "PROFILE")!
    profile.status = "RUNNING"
    profile.startedAt = new Date(Date.now() - 120_000)
    profile.attempts = 1

    const recovered = await recoverExpiredLeases()
    expect(recovered).toBe(1)
    expect(runRow.leaseOwner).toBeNull()
    expect(profile.status).toBe("PENDING")
    // The interrupted attempt is refunded; it never produced a result.
    expect(profile.attempts).toBe(0)
    expect(fake.events.some((event) => event.type === "LEASE_RECLAIMED")).toBe(true)

    // The reclaimed run can then finish normally.
    await tickWorkflowWorker()
    expect((await getWorkflow("user-1", run.id))?.state).toBe("COMPLETED")
  })

  it("allows exactly one claim for the same unattended run", async () => {
    const run = await startedRun()
    const first = await claimNextRun(new Date())
    const second = await claimNextRun(new Date())

    expect(first).toBe(run.id)
    expect(second).toBeNull()

    await executeWorkflowRun(run.id)
    expect((await getWorkflow("user-1", run.id))?.state).toBe("COMPLETED")
  })

  it("completes a manual run by hand without acquiring a lease", async () => {
    const created = await createWorkflow("user-1", { mode: "MANUAL" })
    const started = await startWorkflow("user-1", created.id)
    expect(started.state).toBe("MANUAL")

    for (const name of [
      "PROFILE",
      "DISCOVER",
      "RANK",
      "RESEARCH",
      "TAILOR",
      "VALIDATE",
      "PREPARE_ATS",
      "HUMAN_REVIEW",
      "SUBMISSION_STAGING",
      "TRACKING",
      "FOLLOW_UP",
    ] as WorkflowStepName[]) {
      await completeManualStep("user-1", created.id, name)
    }

    const finished = await getWorkflow("user-1", created.id)
    expect(finished?.state).toBe("COMPLETED")
    expect(finished?.steps.every((step) => step.status === "COMPLETED")).toBe(true)
    expect(fake.runs[0]?.leaseOwner).toBeNull()
  })

  it("refuses to retry another owner's failed run without touching it", async () => {
    const run = await startedRun()
    fake.runs[0]!.state = "FAILED"
    const profile = fake.steps.find((step) => step.name === "PROFILE")!
    profile.status = "FAILED"

    await expect(retryWorkflow("user-2", run.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
    expect(profile.status).toBe("FAILED")
    expect(fake.runs[0]!.state).toBe("FAILED")
    expect(fake.events.some((event) => event.type === "RETRY_SCHEDULED")).toBe(false)
  })

  it("refuses illegal transitions and foreign owners", async () => {
    const run = await startedRun()
    await expect(cancelWorkflow("user-1", run.id)).resolves.toMatchObject({
      state: "CANCELLED",
    })
    await expect(cancelWorkflow("user-1", run.id)).rejects.toBeInstanceOf(WorkflowError)
    await expect(resolveReviewTask("user-2", "task-1", "x")).rejects.toBeInstanceOf(
      WorkflowError
    )
    expect(await getWorkflow("user-2", run.id)).toBeNull()
  })
})
