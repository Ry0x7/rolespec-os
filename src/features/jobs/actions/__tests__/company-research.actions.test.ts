import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockAuth, mockFindFirst, mockUpdate, mockAnalyze, mockRevalidate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockAnalyze: vi.fn(),
  mockRevalidate: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    jobApplication: {
      findFirst: mockFindFirst,
      update: mockUpdate,
    },
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }))
vi.mock("@/features/jobs/services/company-research.service", () => ({
  analyzeCompanyResearchAI: mockAnalyze,
}))

import { runCompanyResearch } from "../company-research.actions"

const RESEARCH = {
  companyName: "Acme",
  industry: null,
  headquarters: null,
  companySize: null,
  overview: "Acme is hiring.",
  keyProducts: [],
  statedMissionOrValues: [],
  techStack: [],
  interviewTips: [],
  citations: [],
  confidence: "LOW" as const,
  confidenceExplanation: "No source could be fetched.",
  researchedAt: "2026-11-09T00:00:00.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "u1" } })
  mockFindFirst.mockResolvedValue({
    id: "app1",
    matchResult: { summary: "keep me" },
    job: {
      companyName: "Acme",
      title: "Engineer",
      url: "https://jobs.test/1",
      location: "Manila",
      description: "Build things.",
    },
  })
  mockAnalyze.mockResolvedValue(RESEARCH)
  mockUpdate.mockResolvedValue({})
})

describe("runCompanyResearch", () => {
  it("requires a session", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(runCompanyResearch("app1")).resolves.toEqual({
      success: false,
      error: "Authentication required",
    })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it("scopes the lookup to the signed-in owner", async () => {
    mockFindFirst.mockResolvedValue(null)
    await expect(runCompanyResearch("app1")).resolves.toEqual({
      success: false,
      error: "Application not found",
    })
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "app1", userId: "u1" } })
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("merges research into matchResult without dropping the existing analysis", async () => {
    const result = await runCompanyResearch("app1")

    expect(result).toEqual({ success: true, research: RESEARCH })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "app1", userId: "u1" },
        data: {
          matchResult: expect.objectContaining({
            summary: "keep me",
            companyResearch: RESEARCH,
          }),
        },
      })
    )
    expect(mockRevalidate).toHaveBeenCalledWith("/jobs/app1")
  })

  it("does not leak provider detail when generation throws", async () => {
    mockAnalyze.mockRejectedValue(new Error("provider exploded at https://internal.example"))
    await expect(runCompanyResearch("app1")).resolves.toEqual({
      success: false,
      error: "Company research failed. Please try again.",
    })
  })
})
