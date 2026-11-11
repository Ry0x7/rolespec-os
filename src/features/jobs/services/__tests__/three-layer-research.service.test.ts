import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockAnalyze, mockDeterministic } = vi.hoisted(() => ({
  mockAnalyze: vi.fn(),
  mockDeterministic: vi.fn(),
}))

vi.mock("../company-research.service", () => ({
  analyzeCompanyResearchAI: mockAnalyze,
  extractDeterministicCompanyResearch: mockDeterministic,
}))

import {
  clearThreeLayerResearchCache,
  researchJob,
} from "../three-layer-research.service"
import type { CompanyResearchResult } from "../company-research.service"

function companyResult(
  citations: CompanyResearchResult["citations"] = []
): CompanyResearchResult {
  return {
    companyName: "Acme",
    industry: null,
    headquarters: null,
    companySize: null,
    overview: "Acme is hiring.",
    keyProducts: [],
    statedMissionOrValues: [],
    techStack: [],
    interviewTips: [],
    citations,
    confidence: "LOW",
    confidenceExplanation: "Nothing verified.",
    researchedAt: "2026-01-01T00:00:00.000Z",
    validationVersion: 2,
  }
}

const POSTING = "https://jobs.acme.test/1"

beforeEach(() => {
  vi.clearAllMocks()
  clearThreeLayerResearchCache()
  mockAnalyze.mockResolvedValue(companyResult())
  mockDeterministic.mockReturnValue(companyResult())
})

describe("researchJob — requirements layer", () => {
  it("separates must-have and nice-to-have lines and keeps the posting's flags", async () => {
    const result = await researchJob({
      userId: "user-1",
      companyName: "Acme",
      jobTitle: "Senior Engineer",
      url: POSTING,
      description: [
        "Requirements:",
        "- 5+ years working with TypeScript",
        "- Experience with PostgreSQL",
        "",
        "Nice to have:",
        "- Kubernetes",
        "- Prior fintech experience",
        "",
        "This role is fully on-site and requires security clearance.",
      ].join("\n"),
      useAi: false,
    })

    expect(result.requirements.required).toEqual([
      "5+ years working with TypeScript",
      "Experience with PostgreSQL",
    ])
    expect(result.requirements.preferred).toEqual(["Kubernetes", "Prior fintech experience"])
    expect(result.requirements.flags).toContain("ONSITE_REQUIRED")
    expect(result.requirements.flags).toContain("SECURITY_CLEARANCE")
  })
})

describe("researchJob — culture layer", () => {
  it("marks a posting that claims both fully remote and hybrid as UNKNOWN with a conflict", async () => {
    const result = await researchJob({
      userId: "user-1",
      companyName: "Acme",
      jobTitle: "Engineer",
      url: POSTING,
      description:
        "We are fully remote. Our team is hybrid, with two days per week in the office.",
      useAi: false,
    })

    const policy = result.culture.signals.find((signal) => signal.label === "Remote policy")
    expect(policy?.state).toBe("UNKNOWN")
    expect(policy?.value).toBeNull()
    expect(result.culture.conflicts.length).toBeGreaterThan(0)
    expect(result.culture.conflicts[0]).toContain("conflicting")
  })

  it("verifies a culture claim only from an independent fetched company page", async () => {
    const remote = {
      title: "About Acme",
      url: "https://about.acme.test/culture",
      quote: "We are fully remote across Asia.",
      verified: true,
      sourceType: "COMPANY" as const,
    }
    mockAnalyze.mockResolvedValue(companyResult([remote]))

    const result = await researchJob({
      userId: "user-1",
      companyName: "Acme",
      jobTitle: "Engineer",
      url: POSTING,
      description: "Join our distributed team.",
    })

    const policy = result.culture.signals.find((signal) => signal.label === "Remote policy")
    expect(policy?.state).toBe("VERIFIED")
    expect(policy?.value).toBe("Fully remote")
    expect(result.sourceSummary.independentSources).toBe(1)
    expect(result.culture.confidence).toBe("MEDIUM")
  })

  it("reaches HIGH only with two independent company hosts", async () => {
    mockAnalyze.mockResolvedValue(
      companyResult([
        {
          title: "About Acme",
          url: "https://about.acme.test/culture",
          quote: "We are fully remote across Asia.",
          verified: true,
          sourceType: "COMPANY",
        },
        {
          title: "Acme careers",
          url: "https://careers.acme.test/working-here",
          quote: "Our team is async-first and keeps flexible hours.",
          verified: true,
          sourceType: "COMPANY",
        },
      ])
    )

    const result = await researchJob({
      userId: "user-1",
      companyName: "Acme",
      jobTitle: "Engineer",
      url: POSTING,
      description: "Join our team.",
    })

    const remote = result.culture.signals.find((signal) => signal.label === "Remote policy")
    const asyncWork = result.culture.signals.find((signal) => signal.label === "Async work")
    expect(remote?.state).toBe("VERIFIED")
    expect(asyncWork?.state).toBe("VERIFIED")
    expect(result.sourceSummary.independentSources).toBe(2)
    expect(result.culture.confidence).toBe("HIGH")
  })

  it("leaves culture UNKNOWN and records uncertainty when the posting has no description", async () => {
    const result = await researchJob({
      userId: "user-1",
      companyName: "Acme",
      jobTitle: "Engineer",
      url: POSTING,
      description: null,
      useAi: false,
    })

    expect(result.culture.signals.length).toBeGreaterThan(0)
    expect(result.culture.signals.every((signal) => signal.state === "UNKNOWN")).toBe(true)
    expect(result.culture.signals.every((signal) => signal.value === null)).toBe(true)
    expect(result.requirements.uncertainty.length).toBeGreaterThan(0)
    expect(result.culture.confidence).toBe("LOW")
  })
})

describe("researchJob — company layer and cache", () => {
  it("does not call the AI path when useAi is false", async () => {
    await researchJob({
      userId: "user-1",
      companyName: "Acme",
      jobTitle: "Engineer",
      description: "Requirements:\n- TypeScript",
      useAi: false,
    })

    expect(mockAnalyze).not.toHaveBeenCalled()
    expect(mockDeterministic).toHaveBeenCalledTimes(1)
  })

  it("degrades without throwing when company research fails", async () => {
    mockAnalyze.mockRejectedValue(new Error("provider unavailable"))
    mockDeterministic.mockReturnValue(companyResult())

    const result = await researchJob({
      userId: "user-1",
      companyName: "Acme",
      jobTitle: "Engineer",
      description: "Requirements:\n- TypeScript",
    })

    expect(result.company.companyName).toBe("Acme")
    expect(result.requirements.uncertainty.join(" ")).toContain("Company research failed")
    expect(result.culture.explanation).toContain("unavailable")
  })

  it("returns a cached result without calling the company service twice", async () => {
    const now = new Date("2026-11-11T10:00:00.000Z")
    const input = {
      userId: "user-1",
      companyName: "Acme",
      jobTitle: "Engineer",
      url: POSTING,
      description: "Requirements:\n- TypeScript",
      useAi: false as const,
      now,
    }

    const first = await researchJob(input)
    const second = await researchJob(input)

    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(mockDeterministic).toHaveBeenCalledTimes(1)

    const later = await researchJob({ ...input, now: new Date(now.getTime() + 31 * 60 * 1000) })
    expect(later.cached).toBe(false)
    expect(mockDeterministic).toHaveBeenCalledTimes(2)
  })
})
