import { describe, expect, it } from "vitest"

import type { RankingPosting, RankingProfile } from "../../types"
import { rankJobPool } from "../ranking.service"

const NOW = new Date("2026-11-11T00:00:00.000Z")

const PROFILE: RankingProfile = {
  targetRoleTitles: ["Frontend Engineer"],
  locations: ["Philippines"],
  openToRelocation: false,
  workModes: ["REMOTE"],
  requiresSponsorship: false,
  experienceLevel: "MID",
  salaryMin: null,
  salaryMax: null,
  salaryPeriod: null,
  salaryCurrency: null,
  capabilities: [
    { name: "React", confirmed: true },
    { name: "TypeScript", confirmed: true },
    { name: "CSS", confirmed: true },
  ],
  evidence: [{ title: "Design system", details: "React components", confirmed: true }],
}

function posting(id: string, overrides: Partial<RankingPosting> = {}): RankingPosting {
  return {
    id,
    title: "Frontend Engineer",
    companyName: "Acme",
    description: "Build React TypeScript interfaces with CSS.",
    location: "Remote - Philippines",
    workType: "REMOTE",
    postedAt: "2026-11-09T00:00:00.000Z",
    url: `https://acme.example/jobs/${id}`,
    ...overrides,
  }
}

function rank(postings: RankingPosting[]) {
  return rankJobPool({ postings, profile: PROFILE, options: { now: NOW } })
}

describe("ranking feedback adjustments", () => {
  it("is deterministic with the same verdicts", () => {
    const first = rank([posting("a", { feedback: "IRRELEVANT" }), posting("b")])
    const second = rank([posting("a", { feedback: "IRRELEVANT" }), posting("b")])
    expect(second).toEqual(first)
  })

  it("applies the user's verdict after the factual score and reports it", () => {
    const baseline = rank([posting("a"), posting("b")])
    const adjusted = rank([posting("a", { feedback: "IRRELEVANT" }), posting("b")])
    const a = adjusted.entries.find((entry) => entry.postingId === "a")!
    const baseA = baseline.entries.find((entry) => entry.postingId === "a")!

    expect(a.score).toBe(Math.max(0, baseA.score - 10))
    expect(a.feedback).toMatchObject({ verdict: "IRRELEVANT", points: -10 })
    expect(a.explanation.at(-1)).toContain("Irrelevant")
    expect(a.factors).toEqual(baseA.factors)
    expect(adjusted.snapshot.feedbackAdjustedCount).toBe(1)
  })

  it("lets an offer raise a posting without changing its factual factors", () => {
    const baseline = rank([posting("a")])
    const offered = rank([posting("a", { feedback: "OFFERED" })])
    expect(offered.entries[0]!.score).toBe(
      Math.min(100, baseline.entries[0]!.score + 8)
    )
    expect(offered.entries[0]!.fitScore).toBe(baseline.entries[0]!.fitScore)
    expect(offered.entries[0]!.coverage).toBe(baseline.entries[0]!.coverage)
  })

  it("restores the original score when the user clears or rejects feedback", () => {
    const baseline = rank([posting("a")])
    const cleared = rank([posting("a", { feedback: null })])
    const rejected = rank([posting("a", { feedback: "REJECTED" })])
    expect(cleared.entries[0]!.score).toBe(baseline.entries[0]!.score)
    expect(rejected.entries[0]!.score).toBe(baseline.entries[0]!.score)
    expect(rejected.entries[0]!.feedback).toMatchObject({ points: 0 })
    expect(rejected.snapshot.feedbackAdjustedCount).toBe(1)
  })

  it("applies the adjusted score to the threshold, not the factual score", () => {
    const baseline = rank([posting("a")]).entries[0]!.score
    expect(baseline).toBeGreaterThan(10)

    const kept = rankJobPool({
      postings: [posting("a")],
      profile: PROFILE,
      options: { now: NOW, minScore: baseline },
    })
    expect(kept.entries).toHaveLength(1)

    // The factual score still passes; the explicit demotion is what moves it
    // below the user's cutoff, and the exclusion says why.
    const demoted = rankJobPool({
      postings: [posting("a", { feedback: "IRRELEVANT" })],
      profile: PROFILE,
      options: { now: NOW, minScore: baseline },
    })
    expect(demoted.entries).toHaveLength(0)
    expect(demoted.excluded).toEqual([
      { postingId: "a", reason: "below-threshold" },
    ])
  })
})
