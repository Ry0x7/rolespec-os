import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockGenerate, mockConsumeRateLimit, mockRecordAttempt } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockPrisma: {
      jobApplication: { findUnique: vi.fn() },
      interviewQuestion: { deleteMany: vi.fn(), createMany: vi.fn() },
      $transaction: vi.fn(),
    },
    mockGenerate: vi.fn(),
    mockConsumeRateLimit: vi.fn(),
    mockRecordAttempt: vi.fn(),
  }))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_INTERVIEW_QUESTIONS: "ai:interview-questions" },
  consumeRateLimit: mockConsumeRateLimit,
  recordAttempt: mockRecordAttempt,
}))
vi.mock("../../services/interview-questions-ai.service", () => ({
  generateInterviewQuestionsAI: mockGenerate,
}))

import { generateInterviewQuestions } from "../interview-question.actions"

/** Posting fields come off the `job` relation, not the mirrored columns. */
const JOB = {
  id: "job-1",
  job: {
    companyName: "Acme",
    title: "Engineer",
    description: "Build things with TypeScript.",
  },
}

/** The args passed to the delete/create calls collected by `$transaction`. */
function transactionCalls() {
  return {
    deleteArgs: mockPrisma.interviewQuestion.deleteMany.mock.calls.at(-1)?.[0],
    createArgs: mockPrisma.interviewQuestion.createMany.mock.calls.at(-1)?.[0],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockConsumeRateLimit.mockResolvedValue(true)
  mockPrisma.jobApplication.findUnique.mockResolvedValue(JOB)
  mockPrisma.interviewQuestion.deleteMany.mockReturnValue("delete-op")
  mockPrisma.interviewQuestion.createMany.mockReturnValue("create-op")
  mockPrisma.$transaction.mockResolvedValue([])
  mockGenerate.mockResolvedValue(["Question one?", "Question two?"])
})

describe("generateInterviewQuestions", () => {
  it("errors without touching the database when there is no session", async () => {
    mockAuth.mockResolvedValue(null)

    const result = await generateInterviewQuestions("job-1")

    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockPrisma.jobApplication.findUnique).not.toHaveBeenCalled()
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it("errors when the job does not belong to the user", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    const result = await generateInterviewQuestions("job-1")

    expect(result).toEqual({ error: "Job application not found" })
    expect(mockPrisma.jobApplication.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", userId: "user-1" } })
    )
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it("errors without spending an AI call when there is no job description", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      ...JOB,
      job: { ...JOB.job, description: "   " },
    })

    const result = await generateInterviewQuestions("job-1")

    expect(result).toMatchObject({
      error: expect.stringContaining("Add a job description first"),
    })
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it("replaces the previous AI rows and leaves scraped ones alone", async () => {
    const result = await generateInterviewQuestions("job-1")

    expect(result).toEqual({ success: true, count: 2 })

    const { deleteArgs, createArgs } = transactionCalls()
    expect(deleteArgs).toEqual({
      where: { jobApplicationId: "job-1", source: "AI_GENERATED" },
    })
    expect(createArgs).toEqual({
      data: [
        { jobApplicationId: "job-1", question: "Question one?", source: "AI_GENERATED" },
        { jobApplicationId: "job-1", question: "Question two?", source: "AI_GENERATED" },
      ],
    })
    // Both writes go through one transaction, so a failed insert cannot leave
    // the job with no AI questions at all.
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(["delete-op", "create-op"])
  })

  it("returns a friendly error when the AI call fails", async () => {
    mockGenerate.mockRejectedValue(new Error("provider down"))

    const result = await generateInterviewQuestions("job-1")

    expect(result).toEqual({ error: "Something went wrong. Please try again." })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it("does not write anything when the model returns no questions", async () => {
    mockGenerate.mockResolvedValue([])

    const result = await generateInterviewQuestions("job-1")

    expect(result).toMatchObject({ error: expect.stringContaining("Couldn't generate") })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("generateInterviewQuestions — rate limit", () => {
  it("consumes an attempt on a successful run", async () => {
    await generateInterviewQuestions("job-1")

    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      "ai:interview-questions",
      "user-1",
      expect.objectContaining({ max: expect.any(Number) })
    )
    // The consume writes its own row; the separate record call is gone.
    expect(mockRecordAttempt).not.toHaveBeenCalled()
  })

  it("refuses without spending an AI call when the window is full", async () => {
    mockConsumeRateLimit.mockResolvedValue(false)

    const result = await generateInterviewQuestions("job-1")

    expect(result).toEqual({
      error: expect.stringMatching(/too many question generations/i),
    })
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})
