import { describe, it, expect } from "vitest"

import { parseStoredQualification } from "../job-qualification.schema"

const SNAPSHOT = {
  verdict: "WORTH_A_LOOK",
  nextAction: "Read the posting before you spend time on it.",
  checkedAt: "2026-01-02T03:04:05.000Z",
  worthIt: {
    signal: "NEUTRAL",
    reasons: ["Couldn't check location or work mode from this posting — it does not say."],
    unchecked: ["work-mode", "location"],
  },
  eligible: { signal: "NEUTRAL", reasons: [] },
  match: {
    signal: "GOOD",
    reasons: ["Mentions 2 of your capabilities."],
    matched: ["React", "TypeScript"],
    confirmedCount: 2,
  },
  risk: { signal: "NEUTRAL", reasons: [], level: null },
}

describe("parseStoredQualification", () => {
  it("returns the snapshot shaped for the summary component", () => {
    const parsed = parseStoredQualification(SNAPSHOT)

    expect(parsed?.checkedAt).toBe("2026-01-02T03:04:05.000Z")
    expect(parsed?.qualification.verdict).toBe("WORTH_A_LOOK")
    expect(parsed?.qualification.worthIt.unchecked).toEqual(["work-mode", "location"])
    expect(parsed?.qualification.match.matched).toEqual(["React", "TypeScript"])
    expect(parsed?.qualification.risk.level).toBeNull()
  })

  it("carries sponsorshipRelevant through when the snapshot recorded it", () => {
    expect(
      parseStoredQualification({ ...SNAPSHOT, sponsorshipRelevant: false })?.qualification
        .sponsorshipRelevant
    ).toBe(false)
    expect(
      parseStoredQualification({ ...SNAPSHOT, sponsorshipRelevant: true })?.qualification
        .sponsorshipRelevant
    ).toBe(true)
    // Older snapshots never recorded it; absent stays absent, not false.
    expect(
      parseStoredQualification(SNAPSHOT)?.qualification.sponsorshipRelevant
    ).toBeUndefined()
  })

  it("leaves requirementFlags empty — the page renders those from its own column", () => {
    expect(parseStoredQualification(SNAPSHOT)?.qualification.requirementFlags).toEqual([])
  })

  it("keeps the optional unchecked key absent when the snapshot omitted it", () => {
    const parsed = parseStoredQualification(SNAPSHOT)

    expect(parsed?.qualification.eligible).not.toHaveProperty("unchecked")
  })

  it("returns null for a null column, so pre-existing jobs render nothing", () => {
    expect(parseStoredQualification(null)).toBeNull()
    expect(parseStoredQualification(undefined)).toBeNull()
  })

  it("returns null rather than rendering a half-formed snapshot", () => {
    expect(parseStoredQualification({ verdict: "STRONG" })).toBeNull()
    expect(parseStoredQualification("STRONG")).toBeNull()
    expect(parseStoredQualification([SNAPSHOT])).toBeNull()
    // An unrecognised verdict has no badge copy, so it is not renderable.
    expect(parseStoredQualification({ ...SNAPSHOT, verdict: "MAYBE" })).toBeNull()
    // Same for a signal there is no dot colour for.
    expect(
      parseStoredQualification({ ...SNAPSHOT, risk: { ...SNAPSHOT.risk, signal: "FINE" } })
    ).toBeNull()
  })
})
