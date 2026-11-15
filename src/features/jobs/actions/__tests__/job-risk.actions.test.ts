import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockAssess, mockConsumeRateLimit, mockRecordAttempt } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockPrisma: {
      jobApplication: { findUnique: vi.fn(), update: vi.fn() },
      job: { update: vi.fn() },
      $transaction: vi.fn(),
    },
    mockAssess: vi.fn(),
    mockConsumeRateLimit: vi.fn(),
    mockRecordAttempt: vi.fn(),
  }))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_JOB_RISK: "ai:job-risk" },
  consumeRateLimit: mockConsumeRateLimit,
  recordAttempt: mockRecordAttempt,
}))
vi.mock("../../services/job-risk-ai.service", () => ({ assessJobRiskAI: mockAssess }))

import { AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { assessJobRisk } from "../job-risk.actions"

// The posting fields come off the `job` relation; `contact` stays on the row.
const JOB = {
  id: "job-1",
  contact: "talent@acme.example",
  job: {
    companyName: "Acme",
    title: "Engineer",
    description: "Build things with TypeScript.",
    salary: 120000,
    salaryPeriod: "YEARLY",
    url: "https://acme.example/jobs/1",
    location: "Remote",
  },
}

/** The `data` object passed to the last posting update call. */
function lastJobUpdateData() {
  return mockPrisma.job.update.mock.calls.at(-1)?.[0].data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockConsumeRateLimit.mockResolvedValue(true)
  mockPrisma.jobApplication.findUnique.mockResolvedValue(JOB)
  // The paired write runs inside a transaction and mirrors the verdict onto
  // the posting row the application points at.
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
  mockPrisma.jobApplication.update.mockResolvedValue({ jobId: "job-row-1" })
  mockPrisma.job.update.mockResolvedValue({})
  mockAssess.mockResolvedValue({ level: "HIGH", reasons: ["Asks for a fee"] })
})

describe("assessJobRisk", () => {
  it("errors without touching the database when there is no session", async () => {
    mockAuth.mockResolvedValue(null)

    const result = await assessJobRisk("job-1")

    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockPrisma.jobApplication.findUnique).not.toHaveBeenCalled()
    expect(mockAssess).not.toHaveBeenCalled()
  })

  it("errors when the job does not belong to the user", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    const result = await assessJobRisk("job-1")

    expect(result).toEqual({ error: "Job application not found" })
    expect(mockPrisma.jobApplication.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", userId: "user-1" } })
    )
    expect(mockAssess).not.toHaveBeenCalled()
  })

  it("errors without spending an AI call when there is no job description", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      ...JOB,
      job: { ...JOB.job, description: "   " },
    })

    const result = await assessJobRisk("job-1")

    expect(result).toMatchObject({
      error: expect.stringContaining("Add a job description first"),
    })
    expect(mockAssess).not.toHaveBeenCalled()
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("stores a flagged verdict as an AI-sourced risk", async () => {
    const result = await assessJobRisk("job-1")

    expect(result).toEqual({ success: true, level: "HIGH", reasons: ["Asks for a fee"] })
    // The verdict is a property of the posting, so it is stored on `Job` only.
    expect(lastJobUpdateData()).toMatchObject({
      riskLevel: "HIGH",
      riskReasons: ["Asks for a fee"],
      riskSource: "AI",
    })
    expect(lastJobUpdateData().riskCheckedAt).toBeInstanceOf(Date)
    expect(mockPrisma.jobApplication.update.mock.calls.at(-1)?.[0].data).toEqual({})
  })

  it("mirrors the verdict onto the posting row so job-based readers see it too", async () => {
    await assessJobRisk("job-1")

    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: { id: "job-row-1", userId: "user-1" },
      data: expect.objectContaining({
        riskLevel: "HIGH",
        riskReasons: ["Asks for a fee"],
        riskSource: "AI",
      }),
    })
  })

  it("clears the level on a NONE verdict but records that the check ran", async () => {
    mockAssess.mockResolvedValue({ level: "NONE", reasons: [] })

    const result = await assessJobRisk("job-1")

    expect(result).toEqual({ success: true, level: "NONE", reasons: [] })
    expect(lastJobUpdateData()).toMatchObject({
      riskLevel: null,
      riskReasons: [],
      riskSource: "AI",
    })
    expect(lastJobUpdateData().riskCheckedAt).toBeInstanceOf(Date)
  })

  it("passes the posting's context to the AI service", async () => {
    await assessJobRisk("job-1")

    expect(mockAssess).toHaveBeenCalledWith({
      userId: "user-1",
      job: {
        companyName: "Acme",
        jobTitle: "Engineer",
        jobDescription: "Build things with TypeScript.",
        salary: 120000,
        salaryPeriod: "YEARLY",
        jobLink: "https://acme.example/jobs/1",
        contact: "talent@acme.example",
        location: "Remote",
      },
    })
  })

  it("returns a friendly error when the AI call fails", async () => {
    mockAssess.mockRejectedValue(new Error("provider down"))

    const result = await assessJobRisk("job-1")

    expect(result).toEqual({ error: "Something went wrong. Please try again." })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("passes the missing-key message through instead of the generic failure", async () => {
    mockAssess.mockRejectedValue(new AiKeyRequiredError())

    const result = await assessJobRisk("job-1")

    expect(result).toEqual({
      error: "Add your API key in Settings → AI to use AI features.",
    })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })
})

describe("assessJobRisk — rate limit", () => {
  it("consumes an attempt on a successful run", async () => {
    await assessJobRisk("job-1")

    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      "ai:job-risk",
      "user-1",
      expect.objectContaining({ max: expect.any(Number) })
    )
    // The consume writes its own row; the separate record call is gone.
    expect(mockRecordAttempt).not.toHaveBeenCalled()
  })

  it("refuses without spending an AI call when the window is full", async () => {
    mockConsumeRateLimit.mockResolvedValue(false)

    const result = await assessJobRisk("job-1")

    expect(result).toEqual({ error: expect.stringMatching(/too many risk checks/i) })
    expect(mockAssess).not.toHaveBeenCalled()
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })
})
