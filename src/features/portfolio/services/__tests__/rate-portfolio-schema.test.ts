import { describe, it, expect, vi } from "vitest"

// The service imports the AI SDK and the provider at module load; neither is
// exercised here, so stub them out to keep this a pure schema test.
vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/ai-generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-generate")>()),
  generateObjectTracked: vi.fn(),
}))

import { portfolioRatingSchema } from "../rate-portfolio"

const portfolioPayload = {
  overallScore: 72,
  scores: {
    contentClarity: 75,
    projectShowcase: 65,
    professionalPositioning: 80,
    contactability: 60,
    keywordsSeo: 70,
  },
  issues: [
    { severity: "warning", message: "No live demo links", category: "Project Showcase" },
    { severity: "info", message: "Meta description is generic", category: "Keywords & SEO" },
  ],
  suggestions: { items: ["Add a live demo link to each project"] },
}

/** Only the score keys are used here — to prove the portfolio schema rejects them. */
const linkedinPayload = {
  scores: {
    headline: 60,
    about: 70,
    experienceImpact: 65,
    skillsKeywords: 75,
    completeness: 80,
  },
}

describe("portfolioRatingSchema", () => {
  it("accepts a well-formed payload", () => {
    const parsed = portfolioRatingSchema.parse(portfolioPayload)
    expect(parsed.overallScore).toBe(72)
    expect(parsed.scores.projectShowcase).toBe(65)
    expect(parsed.issues).toHaveLength(2)
    expect(parsed.suggestions.items).toEqual(["Add a live demo link to each project"])
  })

  it("accepts empty issues and suggestions", () => {
    expect(
      portfolioRatingSchema.safeParse({
        ...portfolioPayload,
        issues: [],
        suggestions: { items: [] },
      }).success
    ).toBe(true)
  })

  it("rejects a missing score category", () => {
    const scores: Partial<typeof portfolioPayload.scores> = { ...portfolioPayload.scores }
    delete scores.projectShowcase
    const result = portfolioRatingSchema.safeParse({ ...portfolioPayload, scores })
    expect(result.success).toBe(false)
  })

  it("rejects an out-of-range score", () => {
    expect(
      portfolioRatingSchema.safeParse({
        ...portfolioPayload,
        scores: { ...portfolioPayload.scores, contactability: 140 },
      }).success
    ).toBe(false)
    expect(
      portfolioRatingSchema.safeParse({ ...portfolioPayload, overallScore: -1 }).success
    ).toBe(false)
  })

  it("rejects an unknown issue severity", () => {
    expect(
      portfolioRatingSchema.safeParse({
        ...portfolioPayload,
        issues: [{ severity: "fatal", message: "x", category: "y" }],
      }).success
    ).toBe(false)
  })

  it("rejects suggestions sent as a bare array", () => {
    expect(
      portfolioRatingSchema.safeParse({
        ...portfolioPayload,
        suggestions: ["do the thing"],
      }).success
    ).toBe(false)
  })

  it("rejects LinkedIn score keys", () => {
    expect(
      portfolioRatingSchema.safeParse({ ...portfolioPayload, scores: linkedinPayload.scores })
        .success
    ).toBe(false)
  })
})
