import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockAnalyzeResumeATS } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    mockPrisma: {
      resume: { findUnique: vi.fn(), update: vi.fn() },
      aTSAnalysis: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(),
    },
    mockAnalyzeResumeATS: vi.fn(),
  })
)

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("../../services/ats-analyze", () => ({ analyzeResumeATS: mockAnalyzeResumeATS }))


import { analyzeATS } from "../analyze-ats"
import { ATS_RATE_LIMIT_MAX } from "../../constants/ats"
import type { Section } from "../../hooks/use-resume-store"

const JOB_DESCRIPTION = "Own the payments platform. Kubernetes required."

/** What the editor currently holds — including edits that are not saved yet. */
const clientSections: Section[] = [
  {
    id: "sec-1",
    resumeId: "resume-1",
    type: "SUMMARY",
    title: "Summary",
    order: 0,
    visible: true,
    items: [
      {
        id: "item-1",
        sectionId: "sec-1",
        content: { text: "Unsaved client-side summary" },
        metadata: null,
        order: 0,
      },
    ],
  },
]

/** The stale copy Prisma would return for the same resume. */
const dbSections = [
  {
    id: "sec-1",
    resumeId: "resume-1",
    type: "SUMMARY",
    title: "Summary",
    order: 0,
    visible: true,
    items: [
      { id: "item-1", sectionId: "sec-1", content: { text: "Stale DB summary" }, order: 0 },
    ],
  },
]

const run = (
  sections: Section[] = clientSections,
  jobDescription: string | undefined = JOB_DESCRIPTION
) => analyzeATS("resume-1", sections, jobDescription)

const analysisResult = {
  overallScore: 70,
  scores: { formatting: 70, keywords: 70, impact: 70, completeness: 70, readability: 70 },
  issues: [],
  suggestions: [],
  missingKeywords: [],
  mode: "job-match" as const,
}

describe("analyzeATS rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      targetRole: "Engineer",
      sections: dbSections,
    })
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue(null)
    mockPrisma.aTSAnalysis.count.mockResolvedValue(0)
    mockPrisma.$transaction.mockResolvedValue([])
    mockAnalyzeResumeATS.mockResolvedValue(analysisResult)
  })

  it("runs the AI analysis and returns success", async () => {
    const result = await run()

    expect(mockAnalyzeResumeATS).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
  })

  it("rate limits at the threshold without calling the AI", async () => {
    mockPrisma.aTSAnalysis.count.mockResolvedValue(ATS_RATE_LIMIT_MAX)

    const result = await run()

    expect(result.code).toBe("RATE_LIMITED")
    expect(result.error).toBe("Too many ATS scans. Please wait a few minutes and try again.")
    expect(mockAnalyzeResumeATS).not.toHaveBeenCalled()
  })

  it("allows a scan just below the threshold", async () => {
    mockPrisma.aTSAnalysis.count.mockResolvedValue(ATS_RATE_LIMIT_MAX - 1)

    const result = await run()

    expect(result.success).toBe(true)
    expect(mockAnalyzeResumeATS).toHaveBeenCalledTimes(1)
  })

  it("reports a failure when the AI call fails", async () => {
    mockAnalyzeResumeATS.mockRejectedValue(new Error("model down"))

    const result = await run()

    expect(result.error).toBe("ATS analysis failed. Please try again.")
  })

  it("reports a failure when persisting fails", async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error("db down"))

    const result = await run()

    expect(result.error).toBe("ATS analysis failed. Please try again.")
  })

  it("does not call the AI when the resume is not owned by the user", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await run()

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockAnalyzeResumeATS).not.toHaveBeenCalled()
  })

  it("does not call the AI when the resume is archived", async () => {
    // Archived (soft-deleted) rows are excluded by the where clause.
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await run()

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "ARCHIVED" } }),
      })
    )
    expect(mockAnalyzeResumeATS).not.toHaveBeenCalled()
  })
})

describe("analyzeATS scores the client's sections", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      targetRole: "Engineer",
      sections: dbSections,
    })
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue(null)
    mockPrisma.aTSAnalysis.count.mockResolvedValue(0)
    mockPrisma.$transaction.mockResolvedValue([])
    mockAnalyzeResumeATS.mockResolvedValue(analysisResult)
  })

  it("passes the caller's sections to the service, not the DB copy", async () => {
    await run()

    const [sections, options] = mockAnalyzeResumeATS.mock.calls[0]
    expect(sections).toEqual(clientSections)
    expect(sections[0].items[0].content).toEqual({ text: "Unsaved client-side summary" })
    expect(JSON.stringify(sections)).not.toContain("Stale DB summary")
    expect(options).toEqual({
      targetRole: "Engineer",
      jobDescription: JOB_DESCRIPTION,
      mode: "job-match",
      userId: "user-1",
    })
  })

  it("rejects a malformed section payload before calling the AI", async () => {
    const broken = [{ id: "sec-1", title: "Summary" }] as unknown as Section[]

    const result = await run(broken)

    expect(result).toEqual({ error: "Invalid resume content.", code: "VALIDATION" })
    expect(mockAnalyzeResumeATS).not.toHaveBeenCalled()
    expect(mockAnalyzeResumeATS).not.toHaveBeenCalled()
  })

  it("rejects more sections than the cap allows", async () => {
    const tooMany = Array.from({ length: 41 }, (_, i) => ({
      ...clientSections[0],
      id: `sec-${i}`,
    }))

    const result = await run(tooMany)

    expect(result).toEqual({ error: "Invalid resume content.", code: "VALIDATION" })
    expect(mockAnalyzeResumeATS).not.toHaveBeenCalled()
  })

  it("rejects an oversized payload before calling the AI", async () => {
    const huge: Section[] = [
      {
        ...clientSections[0],
        items: [
          {
            ...clientSections[0].items[0],
            content: { text: "x".repeat(200_001) },
          },
        ],
      },
    ]

    const result = await run(huge)

    expect(result).toEqual({
      error: "Resume content is too large to analyze.",
      code: "VALIDATION",
    })
    expect(mockAnalyzeResumeATS).not.toHaveBeenCalled()
  })
})

describe("analyzeATS analysis mode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      targetRole: "Engineer",
      sections: dbSections,
    })
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue(null)
    mockPrisma.aTSAnalysis.count.mockResolvedValue(0)
    mockPrisma.$transaction.mockResolvedValue([])
    mockAnalyzeResumeATS.mockResolvedValue(analysisResult)
  })

  it("falls back to a quality run when no job description is supplied or retained", async () => {
    mockAnalyzeResumeATS.mockResolvedValue({ ...analysisResult, mode: "quality" })

    const result = await analyzeATS("resume-1", clientSections)

    expect(result.success).toBe(true)
    expect(result.data?.mode).toBe("quality")
    expect(mockAnalyzeResumeATS.mock.calls[0][1]).toEqual({
      targetRole: "Engineer",
      jobDescription: undefined,
      mode: "quality",
      userId: "user-1",
    })
  })

  it("persists a quality run with a null job description and still updates atsScore", async () => {
    mockAnalyzeResumeATS.mockResolvedValue({ ...analysisResult, mode: "quality" })

    await analyzeATS("resume-1", clientSections, undefined, "quality")

    expect(mockPrisma.aTSAnalysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resumeId: "resume-1",
          jobDescription: null,
          mode: "QUALITY",
        }),
      })
    )
    expect(mockPrisma.resume.update).toHaveBeenCalledWith({
      where: { id: "resume-1" },
      data: { atsScore: analysisResult.overallScore },
    })
  })

  it("skips the job description lookup entirely for an explicit quality run", async () => {
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue({
      jobDescription: "Retained listing text",
    })

    const result = await analyzeATS("resume-1", clientSections, JOB_DESCRIPTION, "quality")

    expect(result.success).toBe(true)
    expect(mockPrisma.aTSAnalysis.findFirst).not.toHaveBeenCalled()
    expect(mockAnalyzeResumeATS.mock.calls[0][1].mode).toBe("quality")
    expect(mockAnalyzeResumeATS.mock.calls[0][1].jobDescription).toBeUndefined()
  })

  it("returns MISSING_JOB_DESCRIPTION only when job-match is asked for explicitly", async () => {
    const result = await analyzeATS("resume-1", clientSections, undefined, "job-match")

    expect(result).toEqual({
      error: "Add a job description before analyzing.",
      code: "MISSING_JOB_DESCRIPTION",
    })
    expect(mockAnalyzeResumeATS).not.toHaveBeenCalled()
  })

  it("treats a whitespace-only job description as no job target", async () => {
    const result = await run(clientSections, "   ")

    expect(result.success).toBe(true)
    expect(mockAnalyzeResumeATS.mock.calls[0][1].mode).toBe("quality")
    expect(mockPrisma.aTSAnalysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: "QUALITY" }),
      })
    )
  })

  it("falls back to the job description retained on the last analysis", async () => {
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue({
      jobDescription: "Retained listing text",
    })

    const result = await analyzeATS("resume-1", clientSections)

    expect(result.success).toBe(true)
    expect(mockAnalyzeResumeATS.mock.calls[0][1].jobDescription).toBe("Retained listing text")
    expect(mockAnalyzeResumeATS.mock.calls[0][1].mode).toBe("job-match")
    expect(mockPrisma.aTSAnalysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobDescription: "Retained listing text",
          mode: "JOB_MATCH",
        }),
      })
    )
  })

  it("runs job-match when the caller supplies a job description", async () => {
    const result = await run()

    expect(result.success).toBe(true)
    expect(result.data?.mode).toBe("job-match")
    expect(mockAnalyzeResumeATS.mock.calls[0][1].mode).toBe("job-match")
    expect(mockPrisma.aTSAnalysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobDescription: JOB_DESCRIPTION, mode: "JOB_MATCH" }),
      })
    )
  })

  it("rejects an unknown mode before touching the AI", async () => {
    const result = await analyzeATS(
      "resume-1",
      clientSections,
      JOB_DESCRIPTION,
      "sideways" as never
    )

    expect(result).toEqual({ error: "Invalid analysis mode.", code: "VALIDATION" })
    expect(mockAnalyzeResumeATS).not.toHaveBeenCalled()
  })
})
