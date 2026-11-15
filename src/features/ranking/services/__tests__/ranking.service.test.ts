import { describe, expect, it } from "vitest"

import type { RankingPosting, RankingProfile } from "../../types"
import { rankJobPool } from "../ranking.service"

const NOW = new Date("2026-11-11T00:00:00.000Z")

const PROFILE: RankingProfile = {
  targetRoleTitles: ["Backend Engineer"],
  locations: ["Philippines"],
  openToRelocation: false,
  workModes: ["REMOTE"],
  requiresSponsorship: true,
  experienceLevel: "SENIOR",
  salaryMin: 40_000,
  salaryMax: 60_000,
  salaryPeriod: "MONTHLY",
  salaryCurrency: "PHP",
  capabilities: [
    { name: "TypeScript", confirmed: true },
    { name: "Node.js", confirmed: true },
    { name: "PostgreSQL", confirmed: true },
  ],
  evidence: [{ title: "Payments platform", details: "TypeScript API", confirmed: true }],
}

const STRONG: RankingPosting = {
  id: "strong",
  title: "Senior Backend Engineer",
  companyName: "Acme",
  description: "Build TypeScript APIs on Node.js with PostgreSQL.",
  location: "Remote - Philippines",
  workType: "REMOTE",
  salaryText: "₱50,000 - ₱70,000 per month",
  postedAt: "2026-11-05T00:00:00.000Z",
  requirementFlags: ["SPONSORSHIP_AVAILABLE"],
  url: "https://acme.example/jobs/1",
}

const WRONG_STACK: RankingPosting = {
  ...STRONG,
  id: "wrong-stack",
  description: "Build Python services with Django and AWS.",
}

const NO_DESCRIPTION: RankingPosting = {
  ...STRONG,
  id: "no-description",
  description: null,
}

function rank(
  postings: readonly RankingPosting[],
  options: Parameters<typeof rankJobPool>[0]["options"] = {}
) {
  return rankJobPool({ postings, profile: PROFILE, options: { now: NOW, ...options } })
}

describe("rankJobPool", () => {
  it("is deterministic for the same pool and profile", () => {
    const first = rank([STRONG, WRONG_STACK, NO_DESCRIPTION])
    const second = rank([STRONG, WRONG_STACK, NO_DESCRIPTION])
    expect(second).toEqual(first)
  })

  it("ranks the matching posting above the wrong stack", () => {
    const result = rank([WRONG_STACK, STRONG])
    expect(result.entries.map((entry) => entry.postingId)).toEqual(["strong", "wrong-stack"])
    expect(result.entries[0]!.score).toBeGreaterThan(result.entries[1]!.score)
  })

  it("does not award an unknown skills factor when there is no description", () => {
    const result = rank([NO_DESCRIPTION, STRONG])
    const withoutDescription = result.entries.find(
      (entry) => entry.postingId === "no-description"
    )!
    expect(withoutDescription.lexicalScore).toBeNull()
    expect(withoutDescription.lexicalRank).toBeNull()
    expect(withoutDescription.factors.find((factor) => factor.id === "SKILLS")?.state).toBe(
      "UNKNOWN"
    )
    expect(withoutDescription.explanation[0]).toContain("no lexical score")
    expect(withoutDescription.coverage).toBeLessThan(1)
    expect(withoutDescription.score).toBeLessThan(result.entries[0]!.score)
  })

  it("applies top-K without losing a posting", () => {
    const result = rank([STRONG, WRONG_STACK, NO_DESCRIPTION], { topK: 1 })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.postingId).toBe("strong")
    expect(result.excluded).toHaveLength(2)
    expect(result.excluded.every((entry) => entry.reason === "outside-top-k")).toBe(true)
    expect(result.entries.length + result.excluded.length).toBe(3)
  })

  it("reports a score cutoff instead of dropping rows silently", () => {
    const result = rank([STRONG, WRONG_STACK], { minScore: 100 })
    expect(result.entries.map((entry) => entry.postingId)).toEqual(["strong"])
    expect(result.excluded).toEqual([
      { postingId: "wrong-stack", reason: "below-threshold" },
    ])
  })

  it("lets the caller weight BM25 against fit factors", () => {
    const keywordStuffed: RankingPosting = {
      id: "keyword-stuffed",
      title: "Backend Engineer",
      companyName: "Elsewhere",
      description:
        "TypeScript Node.js PostgreSQL Backend Engineer Payments platform API ".repeat(5),
      location: "New York, NY",
      workType: "ONSITE",
      postedAt: "2026-09-01T00:00:00.000Z",
      url: "https://elsewhere.example/jobs/2",
    }
    const lexicalOnly = rank([keywordStuffed, STRONG], { lexicalWeight: 1 })
    const fitOnly = rank([keywordStuffed, STRONG], { lexicalWeight: 0 })
    expect(lexicalOnly.entries[0]!.postingId).toBe("keyword-stuffed")
    expect(fitOnly.entries[0]!.postingId).toBe("strong")
  })

  it("records the corpus statistics and query terms in the snapshot", () => {
    const result = rank([STRONG])
    expect(result.snapshot.corpusSize).toBe(1)
    expect(result.snapshot.unscoredCount).toBe(0)
    expect(result.snapshot.queryTerms).toContain("typescript")
    expect(result.snapshot.queryTerms).toContain("backend")
    expect(result.snapshot.rankedAt).toBe(NOW.toISOString())
  })

  it("reports every posting as unscored when none has text", () => {
    const result = rank([{ ...STRONG, id: "a", description: "" }])
    expect(result.snapshot.unscoredCount).toBe(1)
    expect(result.entries[0]!.lexicalScore).toBeNull()
  })
})
