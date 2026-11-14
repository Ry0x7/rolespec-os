// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockGeneratePdf, mockStoreAllTemplateExports, mockCountPdfPages } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockPrisma: { resume: { findUnique: vi.fn() }, resumeExport: { create: vi.fn() } },
    mockGeneratePdf: vi.fn(),
    mockStoreAllTemplateExports: vi.fn(),
    mockCountPdfPages: vi.fn(),
  }))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("../../services/generate-pdf", () => ({ generatePdf: mockGeneratePdf }))
vi.mock("../../services/store-export", () => ({
  storeAllTemplateExports: mockStoreAllTemplateExports,
}))
// Keep the real candidate list and warning; control only the PDF page counter.
vi.mock("../../services/single-page", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/single-page")>()
  return { ...actual, countPdfPages: mockCountPdfPages }
})
// The AI optimize pass must never be reachable from this action. Importing it
// through a mock that throws proves the module is not even exercised.
vi.mock("../../services/optimize-resume", () => ({
  optimizeResume: vi.fn(() => {
    throw new Error("optimizeResume must not be called by the plain export")
  }),
}))

import { exportResumePdf } from "../export-pdf"
import { SINGLE_PAGE_WARNING } from "../../services/single-page"

const USER_ID = "user-1"
const RESUME_ID = "resume-1"

const dbResume = {
  id: RESUME_ID,
  userId: USER_ID,
  version: 3,
  template: "HARVARD",
  targetRole: "Nurse",
  targetCompany: null,
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

const STORED = {
  HARVARD: { pdfUrl: "/api/exports/resume-1/batch/harvard-abc.pdf" },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: USER_ID } })
  mockPrisma.resume.findUnique.mockResolvedValue(dbResume)
  mockGeneratePdf.mockResolvedValue(Buffer.from("%PDF-1.7"))
  mockStoreAllTemplateExports.mockResolvedValue(STORED)
  mockCountPdfPages.mockResolvedValue(1)
})

describe("exportResumePdf", () => {
  it("renders the resume's own template and returns the stored url", async () => {
    const result = await exportResumePdf(RESUME_ID)

    expect(result).toEqual({
      success: true,
      pdfUrl: "/api/exports/resume-1/batch/harvard-abc.pdf",
      template: "HARVARD",
    })
    expect(mockGeneratePdf).toHaveBeenCalledTimes(1)
    expect(mockGeneratePdf.mock.calls[0][0]).toMatchObject({ template: "HARVARD" })
    expect(mockStoreAllTemplateExports).toHaveBeenCalledWith(RESUME_ID, [
      expect.objectContaining({ template: "HARVARD" }),
    ])
    expect(mockCountPdfPages).not.toHaveBeenCalled()
  })

  it("passes the section content through untouched — no AI rewrite", async () => {
    await exportResumePdf(RESUME_ID)

    const { sections } = mockGeneratePdf.mock.calls[0][0]
    expect(sections[0].items[0].content).toEqual({ text: "Before" })
  })

  it("does not record an export row, so the AI export stays the latest", async () => {
    await exportResumePdf(RESUME_ID)

    expect(mockPrisma.resumeExport.create).not.toHaveBeenCalled()
  })

  it("forwards grouping options and the sanitized customization", async () => {
    await exportResumePdf(RESUME_ID, {
      groupAdditional: true,
      groupAdditionalTitle: "Additional",
      customization: { textAlign: "justify" } as never,
    })

    const call = mockGeneratePdf.mock.calls[0][0]
    expect(call.groupAdditional).toBe(true)
    expect(call.groupAdditionalTitle).toBe("Additional")
    expect(call.customization).toMatchObject({ textAlign: "justify" })
  })

  it("refuses an unauthenticated caller before touching the database", async () => {
    mockAuth.mockResolvedValue(null)

    const result = await exportResumePdf(RESUME_ID)

    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockPrisma.resume.findUnique).not.toHaveBeenCalled()
    expect(mockGeneratePdf).not.toHaveBeenCalled()
  })

  it("scopes the lookup to the owner and excludes archived resumes", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await exportResumePdf(RESUME_ID)

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: RESUME_ID,
          userId: USER_ID,
          status: { not: "ARCHIVED" },
        }),
      })
    )
    expect(mockGeneratePdf).not.toHaveBeenCalled()
  })

  it("returns a friendly error when the render throws", async () => {
    mockGeneratePdf.mockRejectedValue(new Error("render blew up"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await exportResumePdf(RESUME_ID)

    expect(result).toEqual({ error: "Download failed. Please try again." })
  })

  describe("single-page layout", () => {
    it("stops at the first candidate that fits and stores only that render", async () => {
      mockGeneratePdf
        .mockResolvedValueOnce(Buffer.from("%PDF-first"))
        .mockResolvedValueOnce(Buffer.from("%PDF-second"))
      mockCountPdfPages.mockResolvedValueOnce(2).mockResolvedValueOnce(1)

      const result = await exportResumePdf(RESUME_ID, { singlePage: true })

      expect(result).toEqual({
        success: true,
        pdfUrl: "/api/exports/resume-1/batch/harvard-abc.pdf",
        template: "HARVARD",
        pageCount: 1,
        singlePageSatisfied: true,
        layoutAttempts: 2,
      })
      expect(mockGeneratePdf).toHaveBeenCalledTimes(2)
      expect(mockGeneratePdf.mock.calls[0][0].customization).toMatchObject({
        density: "compact",
        margins: "compact",
        fontScale: 0.9,
        lineHeight: "snug",
      })
      expect(mockGeneratePdf.mock.calls[1][0].customization).toMatchObject({
        density: "compact",
        margins: "normal",
      })
      expect(mockStoreAllTemplateExports).toHaveBeenCalledTimes(1)
      expect(mockStoreAllTemplateExports).toHaveBeenCalledWith(RESUME_ID, [
        { template: "HARVARD", pdfBuffer: Buffer.from("%PDF-second") },
      ])
    })

    it("returns the tightest render with a warning when no candidate fits", async () => {
      mockCountPdfPages.mockResolvedValue(2)

      const result = await exportResumePdf(RESUME_ID, {
        singlePage: true,
        // Three candidates: compact/compact, compact/normal, then left alignment.
        customization: { textAlign: "justify" } as never,
      })

      expect(result).toMatchObject({
        success: true,
        pageCount: 2,
        singlePageSatisfied: false,
        layoutAttempts: 3,
        warning: SINGLE_PAGE_WARNING,
      })
      expect(mockGeneratePdf).toHaveBeenCalledTimes(3)
      expect(mockStoreAllTemplateExports).toHaveBeenCalledTimes(1)
    })

    it("falls back to the last render when the page counter cannot parse the PDF", async () => {
      mockCountPdfPages.mockResolvedValue(null)
      mockGeneratePdf
        .mockResolvedValueOnce(Buffer.from("%PDF-first"))
        .mockResolvedValueOnce(Buffer.from("%PDF-last"))

      const result = await exportResumePdf(RESUME_ID, { singlePage: true })

      expect(result).toMatchObject({
        success: true,
        pageCount: null,
        singlePageSatisfied: false,
        layoutAttempts: 2,
        warning: SINGLE_PAGE_WARNING,
      })
      expect(mockStoreAllTemplateExports).toHaveBeenCalledWith(RESUME_ID, [
        { template: "HARVARD", pdfBuffer: Buffer.from("%PDF-last") },
      ])
    })

    it("does not consult the page counter when singlePage is false", async () => {
      await exportResumePdf(RESUME_ID, { singlePage: false })

      expect(mockCountPdfPages).not.toHaveBeenCalled()
      expect(mockGeneratePdf).toHaveBeenCalledTimes(1)
    })
  })
})
