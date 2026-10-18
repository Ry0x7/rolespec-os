import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  mockAuth,
  mockPrisma,
  mockAnalyzeAI,
  mockConsumeRateLimit,
  mockRecordAttempt,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    jobApplication: { findUnique: vi.fn(), update: vi.fn() },
    resume: { findFirst: vi.fn() },
  },
  mockAnalyzeAI: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockRecordAttempt: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_JOB_MATCH: "ai:job-match" },
  consumeRateLimit: mockConsumeRateLimit,
  recordAttempt: mockRecordAttempt,
}))
vi.mock("../../services/job-match.service", () => ({ analyzeJobMatchAI: mockAnalyzeAI }))

import { analyzeJobMatch } from "../job-match.actions"

const INPUT = { jobApplicationId: "job-1", resumeId: "resume-1" }

const AI_RESULT = {
  matchScore: 71,
  summary: "Solid overlap on the core stack.",
  matchedKeywords: ["React"],
  missingKeywords: ["Kubernetes"],
  suggestions: ["Add a deployment bullet."],
}

/** The `data` object passed to the last prisma update call. */
function lastUpdateData() {
  return mockPrisma.jobApplication.update.mock.calls.at(-1)?.[0].data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockConsumeRateLimit.mockResolvedValue(true)
  // The posting fields come off the `job` relation; `notes` stays on the row.
  mockPrisma.jobApplication.findUnique.mockResolvedValue({
    notes: null,
    job: {
      companyName: "Acme",
      title: "Engineer",
      description: "Build things with TypeScript.",
    },
  })
  mockPrisma.resume.findFirst.mockResolvedValue({ id: "resume-1", sections: [] })
  mockPrisma.jobApplication.update.mockResolvedValue({})
  mockAnalyzeAI.mockResolvedValue(AI_RESULT)
})

describe("analyzeJobMatch — posting context", () => {
  it("maps the posting onto the AI payload without swapping title and company", async () => {
    await analyzeJobMatch(INPUT)

    expect(mockAnalyzeAI).toHaveBeenCalledWith(
      expect.objectContaining({
        job: {
          companyName: "Acme",
          jobTitle: "Engineer",
          jobDescription: "Build things with TypeScript.",
          notes: null,
        },
      })
    )
  })
})

describe("analyzeJobMatch — persistence", () => {
  it("stores the verdict, the resume it used and a timestamp", async () => {
    const result = await analyzeJobMatch(INPUT)

    expect(result).toEqual({ success: true, ...AI_RESULT })
    expect(mockPrisma.jobApplication.update).toHaveBeenCalledTimes(1)

    const data = lastUpdateData()
    expect(data.matchScore).toBe(71)
    expect(data.matchResumeId).toBe("resume-1")
    expect(data.matchCheckedAt).toBeInstanceOf(Date)
    expect(data.matchResult).toEqual({
      summary: AI_RESULT.summary,
      matchedKeywords: AI_RESULT.matchedKeywords,
      missingKeywords: AI_RESULT.missingKeywords,
      suggestions: AI_RESULT.suggestions,
    })
  })

  it("never stores the resume text the analysis was derived from", async () => {
    await analyzeJobMatch(INPUT)

    expect(Object.keys(lastUpdateData().matchResult)).toEqual([
      "summary",
      "matchedKeywords",
      "missingKeywords",
      "suggestions",
    ])
  })

  it("revalidates the detail page and the list", async () => {
    await analyzeJobMatch(INPUT)

    expect(mockRevalidatePath).toHaveBeenCalledWith("/jobs/job-1")
    expect(mockRevalidatePath).toHaveBeenCalledWith("/jobs")
  })

  it("still returns the result when the write fails", async () => {
    mockPrisma.jobApplication.update.mockRejectedValue(new Error("db down"))

    const result = await analyzeJobMatch(INPUT)

    expect(result).toEqual({ success: true, ...AI_RESULT })
  })
})

describe("analyzeJobMatch — rate limit", () => {
  it("consumes an attempt on a successful run", async () => {
    await analyzeJobMatch(INPUT)

    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      "ai:job-match",
      "user-1",
      expect.objectContaining({ max: expect.any(Number) })
    )
    // The consume writes its own row; the separate record call is gone.
    expect(mockRecordAttempt).not.toHaveBeenCalled()
  })

  it("refuses without spending an AI call when the window is full", async () => {
    mockConsumeRateLimit.mockResolvedValue(false)

    const result = await analyzeJobMatch(INPUT)

    expect(result).toEqual({ error: expect.stringMatching(/too many match checks/i) })
    expect(mockAnalyzeAI).not.toHaveBeenCalled()
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })
})

describe("analyzeJobMatch — guards", () => {
  it("errors without touching the database when there is no session", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await analyzeJobMatch(INPUT)).toEqual({ error: "Unauthorized" })
    expect(mockPrisma.jobApplication.findUnique).not.toHaveBeenCalled()
  })

  it("does not persist anything when the job has no description or notes", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      notes: null,
      job: { companyName: "Acme", title: "Engineer", description: null },
    })

    const result = await analyzeJobMatch(INPUT)

    expect(result).toEqual({ error: "Add a job description first." })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })
})
