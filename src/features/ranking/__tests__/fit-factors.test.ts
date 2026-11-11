import { describe, expect, it } from "vitest"

import { evaluateFitFactors, scoreFitFactors } from "../fit-factors"
import type { RankingPosting, RankingProfile } from "../types"

const NOW = new Date("2026-11-11T00:00:00.000Z")

function profile(overrides: Partial<RankingProfile> = {}): RankingProfile {
  return {
    targetRoleTitles: ["Backend Engineer"],
    locations: ["Philippines"],
    openToRelocation: false,
    workModes: ["REMOTE", "HYBRID"],
    requiresSponsorship: null,
    experienceLevel: "SENIOR",
    salaryMin: 40_000,
    salaryMax: 60_000,
    salaryPeriod: "MONTHLY",
    salaryCurrency: "PHP",
    capabilities: [
      { name: "TypeScript", confirmed: true },
      { name: "PostgreSQL", confirmed: true },
      { name: "Node.js", confirmed: true },
    ],
    evidence: [],
    ...overrides,
  }
}

function posting(overrides: Partial<RankingPosting> = {}): RankingPosting {
  return {
    id: "job-1",
    title: "Senior Backend Engineer",
    companyName: "Acme",
    description: "We build APIs with TypeScript, Node.js and PostgreSQL.",
    location: "Remote - Philippines",
    workType: "REMOTE",
    salaryText: "₱50,000 - ₱70,000 per month",
    postedAt: "2026-11-05T00:00:00.000Z",
    requirementFlags: ["SPONSORSHIP_AVAILABLE"],
    url: "https://acme.example/jobs/1",
    ...overrides,
  }
}

function factor(factors: ReturnType<typeof evaluateFitFactors>, id: string) {
  return factors.find((entry) => entry.id === id)!
}

describe("evaluateFitFactors", () => {
  it("returns all seven factors in a fixed order", () => {
    expect(evaluateFitFactors(posting(), profile(), NOW).map((entry) => entry.id)).toEqual([
      "SKILLS",
      "EXPERIENCE",
      "LOCATION",
      "WORK_MODE",
      "SALARY",
      "AUTHORIZATION",
      "FRESHNESS",
    ])
  })

  it("keeps skills UNKNOWN when the profile has no confirmed capabilities", () => {
    const factors = evaluateFitFactors(
      posting(),
      profile({ capabilities: [{ name: "TypeScript", confirmed: false }] }),
      NOW
    )
    expect(factor(factors, "SKILLS").state).toBe("UNKNOWN")
  })

  it("keeps skills UNKNOWN when the posting has no description", () => {
    const factors = evaluateFitFactors(posting({ description: null }), profile(), NOW)
    expect(factor(factors, "SKILLS").state).toBe("UNKNOWN")
  })

  it("counts only confirmed capabilities the posting mentions", () => {
    const factors = evaluateFitFactors(posting(), profile(), NOW)
    expect(factor(factors, "SKILLS").state).toBe("MATCH")
    expect(factor(factors, "SKILLS").evidence).toEqual(["TypeScript", "PostgreSQL", "Node.js"])
  })

  it("marks a posting that names none of the confirmed skills as a mismatch", () => {
    const factors = evaluateFitFactors(
      posting({ description: "We need a Ruby on Rails developer." }),
      profile(),
      NOW
    )
    expect(factor(factors, "SKILLS").state).toBe("MISMATCH")
  })

  it("does not invent a seniority the title never states", () => {
    const factors = evaluateFitFactors(posting({ title: "Backend Engineer" }), profile(), NOW)
    expect(factor(factors, "EXPERIENCE").state).toBe("UNKNOWN")
  })

  it("mismatches a role two levels above the profile", () => {
    const factors = evaluateFitFactors(
      posting({ title: "Director of Engineering" }),
      profile(),
      NOW
    )
    expect(factor(factors, "EXPERIENCE").state).toBe("MISMATCH")
  })

  it("keeps a location restriction unless the user will relocate", () => {
    const restricted = posting({ location: "New York, NY", workType: "ONSITE" })
    expect(factor(evaluateFitFactors(restricted, profile(), NOW), "LOCATION").state).toBe(
      "MISMATCH"
    )
    expect(
      factor(
        evaluateFitFactors(restricted, profile({ openToRelocation: true }), NOW),
        "LOCATION"
      ).state
    ).toBe("PARTIAL")
  })

  it("keeps work mode UNKNOWN when either side is unstated", () => {
    expect(
      factor(evaluateFitFactors(posting({ workType: null }), profile(), NOW), "WORK_MODE").state
    ).toBe("UNKNOWN")
    expect(
      factor(evaluateFitFactors(posting(), profile({ workModes: [] }), NOW), "WORK_MODE").state
    ).toBe("UNKNOWN")
  })

  it("compares salaries only in the same currency and period", () => {
    expect(factor(evaluateFitFactors(posting(), profile(), NOW), "SALARY").state).toBe("MATCH")
    expect(
      factor(
        evaluateFitFactors(posting({ salaryText: "$2,000 per month" }), profile(), NOW),
        "SALARY"
      ).state
    ).toBe("UNKNOWN")
    expect(
      factor(
        evaluateFitFactors(posting({ salaryText: "₱10,000 per month" }), profile(), NOW),
        "SALARY"
      ).state
    ).toBe("MISMATCH")
  })

  it("treats sponsorship as UNKNOWN until the user answers", () => {
    const flags = posting({ requirementFlags: ["NO_SPONSORSHIP"] })
    expect(factor(evaluateFitFactors(flags, profile(), NOW), "AUTHORIZATION").state).toBe(
      "UNKNOWN"
    )
  })

  it("mismatches a no-sponsorship posting for a user who needs it", () => {
    const factors = evaluateFitFactors(
      posting({ requirementFlags: ["NO_SPONSORSHIP"] }),
      profile({ requiresSponsorship: true }),
      NOW
    )
    expect(factor(factors, "AUTHORIZATION").state).toBe("MISMATCH")
  })

  it("matches a sponsorship-available posting for a user who needs it", () => {
    const factors = evaluateFitFactors(
      posting(),
      profile({ requiresSponsorship: true }),
      NOW
    )
    expect(factor(factors, "AUTHORIZATION").state).toBe("MATCH")
  })

  it("marks a posting older than 30 days as stale", () => {
    const factors = evaluateFitFactors(
      posting({ postedAt: "2026-09-01T00:00:00.000Z" }),
      profile(),
      NOW
    )
    expect(factor(factors, "FRESHNESS").state).toBe("MISMATCH")
  })

  it("keeps freshness UNKNOWN without a usable date", () => {
    expect(
      factor(evaluateFitFactors(posting({ postedAt: null }), profile(), NOW), "FRESHNESS")
        .state
    ).toBe("UNKNOWN")
    expect(
      factor(evaluateFitFactors(posting({ postedAt: "not-a-date" }), profile(), NOW), "FRESHNESS")
        .state
    ).toBe("UNKNOWN")
  })
})

describe("scoreFitFactors", () => {
  it("gives unknown factors no points and reports coverage", () => {
    const factors = evaluateFitFactors(
      posting({ description: null, workType: null, postedAt: null }),
      profile({ requiresSponsorship: null, salaryMin: null }),
      NOW
    )
    const score = scoreFitFactors(factors)
    expect(score.score).toBeLessThan(100)
    expect(score.coverage).toBeLessThan(1)
  })

  it("scores a fully known match at 100 with full coverage", () => {
    const factors = evaluateFitFactors(
      posting(),
      profile({ requiresSponsorship: true }),
      NOW
    )
    expect(scoreFitFactors(factors)).toEqual({ score: 100, coverage: 1 })
  })
})
