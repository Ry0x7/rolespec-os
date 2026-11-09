import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockFetchPublicUrl, mockGenerateObject } = vi.hoisted(() => ({
  mockFetchPublicUrl: vi.fn(),
  mockGenerateObject: vi.fn(),
}))

vi.mock("@/features/career-profile/services/web-presence.service", () => ({
  fetchPublicUrl: mockFetchPublicUrl,
}))

vi.mock("@/shared/lib/ai-generate", () => ({
  AI_USAGE_FEATURES: { JOB_MATCH: "job.match" },
  generateObjectTracked: mockGenerateObject,
}))

import {
  analyzeCompanyResearchAI,
  extractDeterministicCompanyResearch,
  htmlToReadableText,
  isVerifiedCompanyResearch,
  type CompanyResearchResult,
} from "../company-research.service"

function aiResult(overrides: Partial<CompanyResearchResult & { citations: { title: string; url: string; quote?: string }[] }> = {}) {
  return {
    companyName: "Acme",
    industry: "Software",
    headquarters: "San Francisco, CA",
    companySize: "500 employees",
    overview: "Acme builds reliable widgets.",
    keyProducts: ["Acme Widget"],
    statedMissionOrValues: ["build reliable widgets"],
    techStack: ["TypeScript", "Rust"],
    interviewTips: ["Ask about the widget roadmap."],
    citations: [
      {
        title: "About Acme",
        url: "https://acme.test/about",
        quote: "Acme is headquartered in San Francisco, CA.",
      },
    ],
    confidence: "HIGH" as const,
    confidenceExplanation: "The model says so.",
    ...overrides,
  }
}

function mockPages(pages: Record<string, string | Error>, redirects: Record<string, string> = {}) {
  mockFetchPublicUrl.mockImplementation(async (rawUrl: string) => {
    const page = pages[rawUrl]
    if (page instanceof Error) throw page
    if (typeof page !== "string") throw new Error(`unexpected fetch ${rawUrl}`)
    return {
      status: 200,
      contentType: "text/html",
      body: page,
      url: redirects[rawUrl] ?? rawUrl,
      location: null,
    }
  })
}

const POSTING = "https://jobs.test/acme/1"
const POSTING_PAGE = `<html><title>Senior Engineer at Acme</title><body>
  <h1>Acme is hiring a Senior Engineer</h1>
  <p>Build TypeScript services for our widget platform.</p>
</body></html>`

const ABOUT_PAGE = `<html><title>About Acme</title><body>
  <p>Acme is headquartered in San Francisco, CA.</p>
  <p>Our mission: build reliable widgets.</p>
  <p>Acme Widget powers thousands of teams.</p>
</body></html>`

beforeEach(() => {
  vi.clearAllMocks()
})

describe("htmlToReadableText", () => {
  it("drops scripts and tags and decodes entities", () => {
    const text = htmlToReadableText(
      "<style>.x{}</style><script>steal()</script><h2>Acme &amp; Co</h2><p>Hello&nbsp;there</p>"
    )
    expect(text).toContain("Acme & Co")
    expect(text).toContain("Hello there")
    expect(text).not.toContain("steal")
    expect(text).not.toContain("<h2>")
  })
})

describe("extractDeterministicCompanyResearch", () => {
  it("never infers headquarters from the posting location", () => {
    const result = extractDeterministicCompanyResearch({
      companyName: "Acme",
      jobTitle: "Senior Engineer",
      location: "Manila, Philippines",
      description: "TypeScript and PostgreSQL. We are headquartered in Manila.",
    })

    expect(result.headquarters).toBeNull()
    expect(result.industry).toBeNull()
    expect(result.companySize).toBeNull()
    expect(result.confidence).toBe("LOW")
    expect(result.citations).toEqual([])
    expect(result.overview).toContain("Manila, Philippines")
  })

  it("stays MEDIUM, never HIGH, when only a fetched posting citation is supplied", () => {
    const result = extractDeterministicCompanyResearch({
      companyName: "Acme",
      jobTitle: "Senior Engineer",
      verifiedCitations: [
        {
          title: "Acme posting",
          url: POSTING,
          verified: true,
          sourceType: "POSTING",
        },
      ],
    })

    expect(result.confidence).toBe("MEDIUM")
    expect(result.citations).toHaveLength(1)
    expect(result.headquarters).toBeNull()
  })
})

describe("analyzeCompanyResearchAI — source validation", () => {
  it("fetches citations, grounds facts, and only assigns HIGH from a verified company source", async () => {
    mockGenerateObject.mockResolvedValue({ object: aiResult() })
    mockPages({ [POSTING]: POSTING_PAGE, "https://acme.test/about": ABOUT_PAGE })

    const result = await analyzeCompanyResearchAI({
      userId: "u1",
      companyName: "Acme",
      jobTitle: "Senior Engineer",
      url: POSTING,
      location: "Manila, Philippines",
      description: "TypeScript and PostgreSQL. Remote role.",
    })

    expect(result.confidence).toBe("HIGH")
    expect(result.headquarters).toBe("San Francisco, CA")
    expect(result.industry).toBeNull() // "Software" was not in fetched text
    expect(result.companySize).toBeNull()
    expect(result.keyProducts).toEqual(["Acme Widget"])
    expect(result.statedMissionOrValues).toEqual(["build reliable widgets"])
    expect(result.techStack).toContain("TypeScript")
    expect(result.techStack).not.toContain("Rust")
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://acme.test/about", verified: true, sourceType: "COMPANY" }),
        expect.objectContaining({ url: POSTING, verified: true, sourceType: "POSTING" }),
      ])
    )
    expect(result.citations.find((c) => c.url === "https://acme.test/about")?.quote).toBe(
      "Acme is headquartered in San Francisco, CA."
    )
    expect(result.confidenceExplanation).not.toContain("The model says so")
  })

  it("drops a quote that does not occur in the fetched page", async () => {
    mockGenerateObject.mockResolvedValue({
      object: aiResult({
        citations: [
          {
            title: "About Acme",
            url: "https://acme.test/about",
            quote: "We are a rocket company.",
          },
        ],
        headquarters: null,
        keyProducts: [],
        statedMissionOrValues: [],
      }),
    })
    mockPages({ [POSTING]: POSTING_PAGE, "https://acme.test/about": ABOUT_PAGE })

    const result = await analyzeCompanyResearchAI({
      userId: "u1",
      companyName: "Acme",
      jobTitle: "Senior Engineer",
      url: POSTING,
      description: "TypeScript.",
    })

    const about = result.citations.find((c) => c.url === "https://acme.test/about")
    expect(about?.verified).toBe(true)
    expect(about?.quote).toBeUndefined()
  })

  it("drops a citation whose fetch fails and falls back to MEDIUM", async () => {
    mockGenerateObject.mockResolvedValue({
      object: aiResult({ overview: "Acme builds reliable widgets." }),
    })
    mockPages({ [POSTING]: POSTING_PAGE, "https://acme.test/about": new Error("blocked") })

    const result = await analyzeCompanyResearchAI({
      userId: "u1",
      companyName: "Acme",
      jobTitle: "Senior Engineer",
      url: POSTING,
      description: "TypeScript.",
    })

    expect(result.confidence).toBe("MEDIUM")
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0]).toMatchObject({ url: POSTING, sourceType: "POSTING" })
    expect(result.headquarters).toBeNull()
  })

  it("never grounds headquarters in the posting page or its location text", async () => {
    mockGenerateObject.mockResolvedValue({
      object: aiResult({ headquarters: "Manila, Philippines", citations: [] }),
    })
    mockPages({
      [POSTING]:
        "<html><body><p>Acme is hiring in Manila, Philippines. We are headquartered in Manila, Philippines.</p></body></html>",
    })

    const result = await analyzeCompanyResearchAI({
      userId: "u1",
      companyName: "Acme",
      jobTitle: "Senior Engineer",
      url: POSTING,
      location: "Manila, Philippines",
      description: "TypeScript.",
    })

    expect(result.confidence).toBe("MEDIUM")
    expect(result.headquarters).toBeNull()
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].sourceType).toBe("POSTING")
  })

  it("returns LOW and deterministic facts when no source can be fetched", async () => {
    mockGenerateObject.mockResolvedValue({ object: aiResult() })
    mockPages({ [POSTING]: new Error("offline"), "https://acme.test/about": new Error("offline") })

    const result = await analyzeCompanyResearchAI({
      userId: "u1",
      companyName: "Acme",
      jobTitle: "Senior Engineer",
      url: POSTING,
      location: "Manila",
      description: "TypeScript.",
    })

    expect(result.confidence).toBe("LOW")
    expect(result.citations).toEqual([])
    expect(result.headquarters).toBeNull()
    expect(result.techStack).toEqual(["TypeScript"])
    expect(result.overview).toContain("Acme is hiring")
  })
})

describe("isVerifiedCompanyResearch", () => {
  it("rejects a partially written row instead of throwing", () => {
    expect(isVerifiedCompanyResearch({})).toBe(false)
    expect(isVerifiedCompanyResearch({ citations: undefined })).toBe(false)
    expect(isVerifiedCompanyResearch(null)).toBe(false)
  })

  it("rejects legacy research with no verified flag", () => {
    expect(
      isVerifiedCompanyResearch({
        citations: [{ title: "Legacy", url: "https://acme.test", quote: "old" }],
      })
    ).toBe(false)
  })

  it("accepts a citation that was fetched", () => {
    expect(
      isVerifiedCompanyResearch({
        citations: [
          {
            title: "About",
            url: "https://acme.test/about",
            verified: true,
            fetchedAt: new Date().toISOString(),
            sourceType: "COMPANY",
          },
        ],
      })
    ).toBe(true)
  })
})
