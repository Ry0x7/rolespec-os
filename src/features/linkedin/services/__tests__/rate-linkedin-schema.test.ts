import { describe, it, expect, vi } from "vitest"

// The service imports the AI SDK and the provider at module load; neither is
// exercised here, so stub them out to keep this a pure schema test.
vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/ai-generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-generate")>()),
  generateObjectTracked: vi.fn(),
}))

import { linkedinRatingSchema } from "../rate-linkedin"

const linkedinPayload = {
  overallScore: 68,
  scores: {
    headline: 60,
    about: 70,
    experienceImpact: 65,
    skillsKeywords: 75,
    completeness: 80,
  },
  issues: [
    { severity: "critical", message: "About section is empty", category: "About" },
  ],
  suggestions: { items: ["Write a 3-paragraph about section"] },
  benchmark: {
    role: "Senior Frontend Engineer",
    percentile: 42,
    summary: "Competing profiles show quantified outcomes; this one lists duties.",
    benchmarkScores: {
      headline: 80,
      about: 82,
      experienceImpact: 85,
      skillsKeywords: 80,
      completeness: 88,
    },
    advantages: ["Rare depth in design systems"],
    gaps: ["No metrics in the two most recent roles"],
  },
}

describe("linkedinRatingSchema", () => {
  it("accepts a well-formed payload", () => {
    const parsed = linkedinRatingSchema.parse(linkedinPayload)
    expect(parsed.scores.experienceImpact).toBe(65)
    expect(parsed.issues[0].severity).toBe("critical")
    expect(parsed.benchmark.role).toBe("Senior Frontend Engineer")
    expect(parsed.benchmark.benchmarkScores.about).toBe(82)
    expect(parsed.benchmark.gaps).toHaveLength(1)
  })

  it("accepts a benchmark with no advantages", () => {
    const parsed = linkedinRatingSchema.parse({
      ...linkedinPayload,
      benchmark: { ...linkedinPayload.benchmark, advantages: [] },
    })
    expect(parsed.benchmark.advantages).toEqual([])
  })

  it("rejects a payload with no benchmark", () => {
    const withoutBenchmark: Partial<typeof linkedinPayload> = { ...linkedinPayload }
    delete withoutBenchmark.benchmark
    expect(linkedinRatingSchema.safeParse(withoutBenchmark).success).toBe(false)
  })

  it("rejects an out-of-range percentile", () => {
    for (const percentile of [-1, 101]) {
      expect(
        linkedinRatingSchema.safeParse({
          ...linkedinPayload,
          benchmark: { ...linkedinPayload.benchmark, percentile },
        }).success
      ).toBe(false)
    }
  })

  it("rejects a benchmark missing a benchmark score category", () => {
    const benchmarkScores: Partial<typeof linkedinPayload.benchmark.benchmarkScores> = {
      ...linkedinPayload.benchmark.benchmarkScores,
    }
    delete benchmarkScores.completeness
    expect(
      linkedinRatingSchema.safeParse({
        ...linkedinPayload,
        benchmark: { ...linkedinPayload.benchmark, benchmarkScores },
      }).success
    ).toBe(false)
  })

  it("rejects a missing score category", () => {
    const scores: Partial<typeof linkedinPayload.scores> = { ...linkedinPayload.scores }
    delete scores.about
    expect(linkedinRatingSchema.safeParse({ ...linkedinPayload, scores }).success).toBe(false)
  })

  it("rejects an out-of-range score", () => {
    expect(
      linkedinRatingSchema.safeParse({
        ...linkedinPayload,
        scores: { ...linkedinPayload.scores, headline: 101 },
      }).success
    ).toBe(false)
  })

  it("rejects a non-string suggestion item", () => {
    expect(
      linkedinRatingSchema.safeParse({
        ...linkedinPayload,
        suggestions: { items: [{ title: "nope" }] },
      }).success
    ).toBe(false)
  })
})
