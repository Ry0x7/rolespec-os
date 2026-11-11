// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const client = {
    submissionAttempt: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    jobApplication: { findFirst: vi.fn(), update: vi.fn() },
    applicationStatusEvent: { create: vi.fn() },
    followUpTask: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  }
  return {
    ...client,
    transaction: vi.fn((arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)(client)
        : Promise.all(arg as Promise<unknown>[])
    ),
  }
})

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    submissionAttempt: mocks.submissionAttempt,
    jobApplication: mocks.jobApplication,
    applicationStatusEvent: mocks.applicationStatusEvent,
    followUpTask: mocks.followUpTask,
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  redactText: (value: string, max = 500) => value.slice(0, max),
}))

import {
  SubmissionError,
  confirmSubmissionAttempt,
  stageSubmissionAttempt,
} from "../services/submission.service"

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    jobApplicationId: "app-1",
    workflowRunId: "run-1",
    atsPreparationId: null,
    resumeId: "resume-1",
    source: "WORKFLOW",
    status: "STAGED",
    jobTitle: "Backend Engineer",
    companyName: "Acme",
    sourceUrl: "https://acme.example/jobs/1",
    evidence: { rankScore: 80 },
    confirmedAt: null,
    confirmationNote: null,
    createdAt: new Date("2026-11-12T00:00:00.000Z"),
    updatedAt: new Date("2026-11-12T00:00:00.000Z"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.submissionAttempt.findFirst.mockResolvedValue(null)
  mocks.submissionAttempt.create.mockResolvedValue(attempt())
  mocks.submissionAttempt.update.mockImplementation(async ({ where, data }) =>
    attempt({ id: where.id, ...data })
  )
  mocks.jobApplication.findFirst.mockResolvedValue({
    id: "app-1",
    status: "INTERESTED",
    dateApplied: null,
  })
  mocks.jobApplication.update.mockResolvedValue({})
  mocks.applicationStatusEvent.create.mockResolvedValue({})
  mocks.followUpTask.findFirst.mockResolvedValue(null)
  mocks.followUpTask.create.mockImplementation(async ({ data }) => ({
    id: `task-${data.channel}`,
    status: "PENDING",
    completedAt: null,
    createdAt: new Date("2026-11-12T00:00:00.000Z"),
    updatedAt: new Date("2026-11-12T00:00:00.000Z"),
    ...data,
  }))
})

describe("stageSubmissionAttempt", () => {
  it("creates one durable staged record with evidence references", async () => {
    const staged = await stageSubmissionAttempt({
      userId: "user-1",
      jobApplicationId: "app-1",
      workflowRunId: "run-1",
      resumeId: "resume-1",
      source: "WORKFLOW",
      jobTitle: "Backend Engineer",
      companyName: "Acme",
      sourceUrl: "https://acme.example/jobs/1",
      evidence: { rankScore: 80 },
    })

    expect(staged).toMatchObject({ id: "attempt-1", status: "STAGED", source: "WORKFLOW" })
    expect(mocks.submissionAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        jobApplicationId: "app-1",
        workflowRunId: "run-1",
        status: "STAGED",
        evidence: { rankScore: 80 },
      }),
      select: expect.any(Object),
    })
    expect(mocks.jobApplication.update).not.toHaveBeenCalled()
  })

  it("returns the existing record on replay instead of duplicating it", async () => {
    mocks.submissionAttempt.findFirst.mockResolvedValue(attempt({ status: "SUBMITTED" }))

    const staged = await stageSubmissionAttempt({
      userId: "user-1",
      jobApplicationId: "app-1",
      workflowRunId: "run-1",
      source: "WORKFLOW",
    })

    expect(staged.status).toBe("SUBMITTED")
    expect(mocks.submissionAttempt.create).not.toHaveBeenCalled()
  })

  it("refuses to stage for another owner's application", async () => {
    mocks.jobApplication.findFirst.mockResolvedValue(null)

    await expect(
      stageSubmissionAttempt({
        userId: "user-1",
        jobApplicationId: "app-2",
        workflowRunId: "run-1",
        source: "MANUAL",
      })
    ).rejects.toBeInstanceOf(SubmissionError)
    expect(mocks.submissionAttempt.create).not.toHaveBeenCalled()
  })
})

describe("confirmSubmissionAttempt", () => {
  it("records an explicit submission and advances only an interested application", async () => {
    mocks.submissionAttempt.findFirst.mockResolvedValue(attempt())

    const result = await confirmSubmissionAttempt("user-1", "attempt-1", {
      submitted: true,
      note: "confirmation page",
    })

    expect(result.attempt.status).toBe("SUBMITTED")
    expect(result.applicationStatus).toBe("APPLIED")
    expect(mocks.jobApplication.update).toHaveBeenCalledWith({
      where: { id: "app-1" },
      data: expect.objectContaining({ status: "APPLIED", dateApplied: expect.any(Date) }),
    })
    expect(mocks.applicationStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobApplicationId: "app-1",
        fromStatus: "INTERESTED",
        toStatus: "APPLIED",
        source: "WORKFLOW",
      }),
    })
  })

  it("does not downgrade an application already past APPLIED", async () => {
    mocks.submissionAttempt.findFirst.mockResolvedValue(attempt())
    mocks.jobApplication.findFirst.mockResolvedValue({
      id: "app-1",
      status: "INTERVIEW",
      dateApplied: new Date("2026-10-01T00:00:00.000Z"),
    })

    const result = await confirmSubmissionAttempt("user-1", "attempt-1", {
      submitted: true,
    })

    expect(result.applicationStatus).toBe("INTERVIEW")
    expect(mocks.jobApplication.update).not.toHaveBeenCalled()
    expect(mocks.applicationStatusEvent.create).not.toHaveBeenCalled()
  })

  it("is one-way and idempotent", async () => {
    mocks.submissionAttempt.findFirst.mockResolvedValue(attempt({ status: "SUBMITTED" }))

    await expect(
      confirmSubmissionAttempt("user-1", "attempt-1", { submitted: false })
    ).rejects.toMatchObject({ code: "TERMINAL" })

    const again = await confirmSubmissionAttempt("user-1", "attempt-1", {
      submitted: true,
    })
    expect(again.attempt.status).toBe("SUBMITTED")
    expect(mocks.submissionAttempt.update).not.toHaveBeenCalled()
  })

  it("records a not-submitted confirmation without touching the tracker", async () => {
    mocks.submissionAttempt.findFirst.mockResolvedValue(attempt())

    const result = await confirmSubmissionAttempt("user-1", "attempt-1", {
      submitted: false,
    })

    expect(result.attempt.status).toBe("NOT_SUBMITTED")
    expect(result.applicationStatus).toBeNull()
    expect(mocks.jobApplication.update).not.toHaveBeenCalled()
    expect(mocks.applicationStatusEvent.create).not.toHaveBeenCalled()
  })
})
