// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockGeneratePdf, mockStoreAllTemplateExports } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    mockPrisma: { resume: { findUnique: vi.fn() }, resumeExport: { create: vi.fn() } },
    mockGeneratePdf: vi.fn(),
    mockStoreAllTemplateExports: vi.fn(),
  })
)

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("../../services/generate-pdf", () => ({ generatePdf: mockGeneratePdf }))
vi.mock("../../services/store-export", () => ({
  storeAllTemplateExports: mockStoreAllTemplateExports,
}))
// The AI optimize pass must never be reachable from this action. Importing it
// through a mock that throws proves the module is not even exercised.
vi.mock("../../services/optimize-resume", () => ({
  optimizeResume: vi.fn(() => {
    throw new Error("optimizeResume must not be called by the plain export")
  }),
}))

import { exportResumePdf } from "../export-pdf"

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

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: USER_ID } })
  mockPrisma.resume.findUnique.mockResolvedValue(dbResume)
  mockGeneratePdf.mockResolvedValue(Buffer.from("%PDF-1.7"))
  mockStoreAllTemplateExports.mockResolvedValue({
    HARVARD: { pdfUrl: "/api/exports/resume-1/batch/harvard-abc.pdf" },
  })
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
})
