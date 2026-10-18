import { describe, expect, it } from "vitest"
import {
  parseConfidence,
  parseMarketFit,
  parseQualification,
  parseRequirements,
} from "./qualification"

const FULL = {
  verdict: "WORTH_A_LOOK",
  nextAction: "  Read the description before applying.  ",
  worthIt: { level: "NEUTRAL", reasons: ["Pay is unstated"] },
  eligible: { level: "CONCERN", reasons: ["No sponsorship"] },
  match: { level: "GOOD", matchedCapabilities: ["TypeScript", "React"], confirmedCount: 2 },
  risk: { level: "LOW", reasons: ["Reposted several times"] },
}

describe("parseQualification", () => {
  it("reads a full payload", () => {
    expect(parseQualification(FULL)).toEqual({
      verdict: "WORTH_A_LOOK",
      nextAction: "Read the description before applying.",
      worthIt: { level: "NEUTRAL", reasons: ["Pay is unstated"] },
      eligible: { level: "CONCERN", reasons: ["No sponsorship"] },
      match: { level: "GOOD", matchedCapabilities: ["TypeScript", "React"], confirmedCount: 2 },
      risk: { level: "LOW", reasons: ["Reposted several times"] },
    })
  })

  it("returns null when the server sent no qualification at all", () => {
    expect(parseQualification(undefined)).toBeNull()
    expect(parseQualification(null)).toBeNull()
  })

  it("returns null for non-object values", () => {
    expect(parseQualification("STRONG")).toBeNull()
    expect(parseQualification(["STRONG"])).toBeNull()
    expect(parseQualification(7)).toBeNull()
  })

  it("returns null for a verdict outside the four known values", () => {
    expect(parseQualification({ ...FULL, verdict: "MAYBE" })).toBeNull()
    expect(parseQualification({ ...FULL, verdict: "strong" })).toBeNull()
    expect(parseQualification({ ...FULL, verdict: 1 })).toBeNull()
    expect(parseQualification({ nextAction: "Apply" })).toBeNull()
  })

  it("keeps a verdict whose breakdown is missing entirely", () => {
    expect(parseQualification({ verdict: "BLOCKED" })).toEqual({
      verdict: "BLOCKED",
      nextAction: "",
      worthIt: { level: "", reasons: [] },
      eligible: { level: "", reasons: [] },
      match: { level: "", matchedCapabilities: [], confirmedCount: 0 },
      risk: { level: "", reasons: [] },
    })
  })

  it("degrades malformed steps instead of dropping the verdict", () => {
    expect(
      parseQualification({
        verdict: "WEAK",
        nextAction: 42,
        worthIt: "CONCERN",
        eligible: { level: 3, reasons: "No sponsorship" },
        match: { level: "CONCERN", matchedCapabilities: ["Go", 5, "  ", null], confirmedCount: "2" },
        risk: null,
      })
    ).toEqual({
      verdict: "WEAK",
      nextAction: "",
      worthIt: { level: "", reasons: [] },
      eligible: { level: "", reasons: [] },
      match: { level: "CONCERN", matchedCapabilities: ["Go"], confirmedCount: 0 },
      risk: { level: "", reasons: [] },
    })
  })

  it("keeps an unknown step level as-is", () => {
    const parsed = parseQualification({
      verdict: "STRONG",
      worthIt: { level: "EXCELLENT", reasons: [] },
    })
    expect(parsed?.worthIt.level).toBe("EXCELLENT")
  })

  it("treats a negative or non-finite confirmedCount as none", () => {
    expect(
      parseQualification({ verdict: "STRONG", match: { matchedCapabilities: [], confirmedCount: -3 } })
        ?.match.confirmedCount
    ).toBe(0)
    expect(
      parseQualification({
        verdict: "STRONG",
        match: { matchedCapabilities: [], confirmedCount: Number.NaN },
      })?.match.confirmedCount
    ).toBe(0)
  })
})

describe("parseRequirements", () => {
  it("reads the eligibility flags", () => {
    expect(parseRequirements(["NO_SPONSORSHIP", "US_ONLY"])).toEqual([
      "NO_SPONSORSHIP",
      "US_ONLY",
    ])
  })

  it("drops non-string and blank entries", () => {
    expect(parseRequirements(["US_ONLY", 42, null, "   ", {}, " CLEARANCE "])).toEqual([
      "US_ONLY",
      "CLEARANCE",
    ])
  })

  it("returns an empty list when the field is absent or not an array", () => {
    expect(parseRequirements(undefined)).toEqual([])
    expect(parseRequirements(null)).toEqual([])
    expect(parseRequirements("NO_SPONSORSHIP")).toEqual([])
    expect(parseRequirements({ 0: "US_ONLY" })).toEqual([])
  })
})

describe("parseMarketFit", () => {
  it("reads the chip label, the sentence behind it and the opaque fit", () => {
    expect(
      parseMarketFit({
        fit: "IN_MARKET",
        label: "  Open to PH  ",
        reason: " Open to candidates in the Philippines. ",
      })
    ).toEqual({
      fit: "IN_MARKET",
      label: "Open to PH",
      reason: "Open to candidates in the Philippines.",
    })
  })

  it("keeps a fit value this build has never heard of", () => {
    expect(parseMarketFit({ fit: "SOMETHING_NEW", label: "Elsewhere" })).toEqual({
      fit: "SOMETHING_NEW",
      label: "Elsewhere",
      reason: "",
    })
  })

  it("returns null without a label, since there would be no chip to show", () => {
    expect(parseMarketFit({ fit: "OPEN", reason: "Open worldwide." })).toBeNull()
    expect(parseMarketFit({ fit: "OPEN", label: "   " })).toBeNull()
  })

  it("returns null for anything that is not an object", () => {
    expect(parseMarketFit(undefined)).toBeNull()
    expect(parseMarketFit(null)).toBeNull()
    expect(parseMarketFit("IN_MARKET")).toBeNull()
    expect(parseMarketFit([{ label: "Open to PH" }])).toBeNull()
  })
})

describe("parseConfidence", () => {
  it("reads a level and its summary", () => {
    expect(parseConfidence({ level: "HIGH", summary: "  Posted 3 days ago.  " })).toEqual({
      level: "HIGH",
      summary: "Posted 3 days ago.",
    })
  })

  it("accepts UNKNOWN and tolerates a missing summary", () => {
    expect(parseConfidence({ level: "UNKNOWN" })).toEqual({ level: "UNKNOWN", summary: "" })
  })

  it("refuses a level it cannot explain to the user", () => {
    expect(parseConfidence({ level: "VERY_HIGH", summary: "Trust us." })).toBeNull()
    expect(parseConfidence({ summary: "Trust us." })).toBeNull()
  })

  it("returns null for anything that is not an object", () => {
    expect(parseConfidence(undefined)).toBeNull()
    expect(parseConfidence(null)).toBeNull()
    expect(parseConfidence("HIGH")).toBeNull()
    expect(parseConfidence(["HIGH"])).toBeNull()
  })
})
