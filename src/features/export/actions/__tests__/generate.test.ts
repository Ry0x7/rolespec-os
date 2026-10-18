// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  mockAuth,
  mockPrisma,
  mockOptimizeResume,
  mockGeneratePdf,
  mockStoreAllTemplateExports,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    // `update` on both models is reached at the top level now that the write is
    // batched: the array form builds the promises off `prisma`, not off a `tx`.
    resume: { findUnique: vi.fn(), update: vi.fn() },
    resumeSectionItem: { update: vi.fn() },
    resumeExport: { create: vi.fn() },
    aTSAnalysis: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  mockOptimizeResume: vi.fn(),
  mockGeneratePdf: vi.fn(),
  mockStoreAllTemplateExports: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("../../services/optimize-resume", () => ({ optimizeResume: mockOptimizeResume }))
vi.mock("../../services/generate-pdf", () => ({ generatePdf: mockGeneratePdf }))
vi.mock("../../services/store-export", () => ({
  storeAllTemplateExports: mockStoreAllTemplateExports,
}))

import { generateResume } from "../generate"

const USER_ID = "user-1"
const RESUME_ID = "resume-1"

const dbResume = {
  id: RESUME_ID,
  userId: USER_ID,
  version: 3,
  targetRole: "Backend Engineer",
  targetCompany: "Acme",
  sections: [
    {
      id: "sec-1",
      resumeId: RESUME_ID,
      type: "SUMMARY",
      title: "Summary",
      order: 0,
      visible: true,
      items: [{ id: "item-1", sectionId: "sec-1", content: { text: "Before" }, order: 0 }],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()

  mockAuth.mockResolvedValue({ user: { id: USER_ID } })
  mockPrisma.resume.findUnique.mockResolvedValue(dbResume)
  mockPrisma.resumeExport.create.mockResolvedValue({ id: "export-1" })
  mockPrisma.aTSAnalysis.findFirst.mockResolvedValue(null)
  // `generateResume` uses the array form of `$transaction` (batched, one round
  // trip) rather than the interactive callback form, so the mock has to accept
  // both: an array of already-built promises, or a callback.
  mockPrisma.$transaction.mockImplementation(
    async (arg: unknown[] | ((tx: unknown) => unknown)) => {
      if (typeof arg === "function") {
        return await arg({
          resumeSectionItem: { update: vi.fn() },
          resume: { update: vi.fn() },
        })
      }
      return await Promise.all(arg)
    }
  )

  mockOptimizeResume.mockImplementation(async () => {
    return {
      sections: [
        {
          id: "sec-1",
          items: [{ id: "item-1", content: { text: "After" }, order: 0 }],
        },
      ],
      optimized: true,
    }
  })
  mockGeneratePdf.mockResolvedValue(Buffer.from("pdf"))
  mockStoreAllTemplateExports.mockResolvedValue({ MINIMAL: { pdfUrl: "u1" } })
})

describe("generateResume ATS context", () => {
  it("passes missing keywords and severity-ordered issues from the latest analysis", async () => {
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue({
      issues: [
        { severity: "info", category: "format", message: "Dates inconsistent" },
        { severity: "critical", category: "keywords", message: "Missing core keywords" },
      ],
      suggestions: { items: [], missingKeywords: ["Kubernetes", "Terraform"] },
    })

    await generateResume(RESUME_ID)

    const options = mockOptimizeResume.mock.calls[0][1]
    expect(options.missingKeywords).toEqual(["Kubernetes", "Terraform"])
    expect(options.atsIssues.map((i: { severity: string }) => i.severity)).toEqual([
      "critical",
      "info",
    ])
  })

  it("passes empty ATS context when the stored suggestions are a legacy array", async () => {
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue({
      issues: [],
      suggestions: [{ category: "impact", title: "t", description: "d", priority: "high" }],
    })

    await generateResume(RESUME_ID)

    const options = mockOptimizeResume.mock.calls[0][1]
    expect(options.missingKeywords).toEqual([])
    expect(options.atsIssues).toEqual([])
  })

  it("still generates when there is no ATS analysis", async () => {
    const result = await generateResume(RESUME_ID)

    expect(result).toMatchObject({ success: true })
    const options = mockOptimizeResume.mock.calls[0][1]
    expect(options.missingKeywords).toEqual([])
    expect(options.atsIssues).toEqual([])
  })
})

describe("generateResume optimization reporting", () => {
  it("reports a successful optimization", async () => {
    const result = await generateResume(RESUME_ID)

    expect(result).toMatchObject({ success: true, optimized: true })
  })

  it("still succeeds but reports the fallback when optimization was skipped", async () => {
    mockOptimizeResume.mockResolvedValue({
      sections: [{ id: "sec-1", items: [{ id: "item-1", content: { text: "Before" }, order: 0 }] }],
      optimized: false,
      reason: "ai_key_required",
    })

    const result = await generateResume(RESUME_ID)

    // Fail-soft is unchanged: the export still produced files.
    expect(result).toMatchObject({
      success: true,
      optimized: false,
      optimizeFallbackReason: "ai_key_required",
    })
  })
})

describe("generateResume guards", () => {
  it("returns the failure message when the optimization throws", async () => {
    mockOptimizeResume.mockRejectedValue(new Error("model down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await generateResume(RESUME_ID)

    expect(result).toEqual({ error: "Generation failed. Please try again." })
  })

  it("does not call the AI when the resume is not found", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await generateResume(RESUME_ID)

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockOptimizeResume).not.toHaveBeenCalled()
  })

  it("does not call the AI when the resume is archived", async () => {
    // Archived (soft-deleted) rows are excluded by the where clause.
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await generateResume(RESUME_ID)

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "ARCHIVED" } }),
      })
    )
    expect(mockOptimizeResume).not.toHaveBeenCalled()
  })
})
