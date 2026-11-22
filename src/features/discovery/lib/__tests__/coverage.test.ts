import { describe, expect, it } from "vitest"

import { buildDiscoveryCoverage, type CoverageCandidate } from "../coverage"

const NOW = new Date("2026-11-11T00:00:00.000Z")

function candidate(overrides: Partial<CoverageCandidate> = {}): CoverageCandidate {
  return {
    qualification: { marketFit: { fit: "OPEN" } },
    ...overrides,
  }
}

describe("buildDiscoveryCoverage", () => {
  it("separates stated pay, parsed pay, and no pay at all", () => {
    const coverage = buildDiscoveryCoverage({
      candidates: [
        candidate({ salaryText: "₱50,000 - ₱70,000 per month" }),
        candidate({ salaryText: "Competitive" }),
        candidate(),
      ],
      received: 3,
      duplicatesRemoved: 0,
      unreadable: 0,
      now: NOW,
    })
    expect(coverage.pay).toEqual({ stated: 2, parsed: 1, unknown: 1 })
  })

  it("counts known, restricted and unknown regional eligibility", () => {
    const coverage = buildDiscoveryCoverage({
      candidates: [
        candidate({ qualification: { marketFit: { fit: "OPEN" } } }),
        candidate({ qualification: { marketFit: { fit: "RESTRICTED" } } }),
        candidate({ qualification: { marketFit: { fit: "UNKNOWN" } } }),
      ],
      received: 3,
      duplicatesRemoved: 0,
      unreadable: 0,
      now: NOW,
    })
    expect(coverage.regionalEligibility).toEqual({
      known: 2,
      restricted: 1,
      unknown: 1,
    })
  })

  it("counts fresh, stale and undated postings against a fixed clock", () => {
    const coverage = buildDiscoveryCoverage({
      candidates: [
        candidate({ postedAt: "2026-11-09T00:00:00.000Z" }),
        candidate({ postedAt: "2026-09-01T00:00:00.000Z" }),
        candidate({ postedAt: null }),
        candidate({ postedAt: "not-a-date" }),
      ],
      received: 4,
      duplicatesRemoved: 0,
      unreadable: 0,
      now: NOW,
    })
    expect(coverage.freshness).toEqual({ dated: 2, fresh: 1, stale: 1, undated: 2 })
  })

  it("reports dedupe, unreadable rows and explicit user feedback", () => {
    const coverage = buildDiscoveryCoverage({
      candidates: [candidate({ feedback: "INTERESTED" }), candidate()],
      received: 5,
      duplicatesRemoved: 2,
      unreadable: 1,
      now: NOW,
    })
    expect(coverage.received).toBe(5)
    expect(coverage.unique).toBe(2)
    expect(coverage.duplicatesRemoved).toBe(2)
    expect(coverage.unreadable).toBe(1)
    expect(coverage.userFeedback).toBe(1)
  })
})
