import { describe, expect, it } from "vitest"
import { splitIntoBullets } from "../split-into-bullets"

describe("splitIntoBullets", () => {
  it("returns an empty array for blank input", () => {
    expect(splitIntoBullets(null)).toEqual([])
    expect(splitIntoBullets(undefined)).toEqual([])
    expect(splitIntoBullets("")).toEqual([])
    expect(splitIntoBullets("   \n \t \n ")).toEqual([])
  })

  it("keeps a single short sentence as one bullet", () => {
    expect(splitIntoBullets("Built the billing platform.")).toEqual([
      "Built the billing platform.",
    ])
    expect(splitIntoBullets("  Led the migration  ")).toEqual(["Led the migration"])
  })

  it("splits on newlines and drops blank lines", () => {
    expect(splitIntoBullets("Led onboarding\n\nOwned the roadmap\r\nShipped v2")).toEqual([
      "Led onboarding",
      "Owned the roadmap",
      "Shipped v2",
    ])
  })

  it("strips leading list markers", () => {
    expect(
      splitIntoBullets(
        [
          "• Led onboarding",
          "- Owned the roadmap",
          "* Shipped v2",
          "– Ran retros",
          "1. Hired three engineers",
          "2) Cut cycle time",
        ].join("\n")
      )
    ).toEqual([
      "Led onboarding",
      "Owned the roadmap",
      "Shipped v2",
      "Ran retros",
      "Hired three engineers",
      "Cut cycle time",
    ])
  })

  it("splits multi-sentence prose on sentence boundaries and keeps terminal punctuation", () => {
    expect(
      splitIntoBullets(
        "Built the billing platform. Led a team of six engineers! Did it ship on time? Yes."
      )
    ).toEqual([
      "Built the billing platform.",
      "Led a team of six engineers!",
      "Did it ship on time?",
      "Yes.",
    ])
  })

  it("sentence-splits chunks that survive newline splitting", () => {
    expect(splitIntoBullets("- Ran discovery. Interviewed 20 users.\n- Shipped the pilot.")).toEqual(
      ["Ran discovery.", "Interviewed 20 users.", "Shipped the pilot."]
    )
  })

  it("does not split on common abbreviations or initials", () => {
    expect(splitIntoBullets("Owned CI tooling e.g. Jenkins and GitHub Actions.")).toEqual([
      "Owned CI tooling e.g. Jenkins and GitHub Actions.",
    ])
    expect(splitIntoBullets("Reported to J. Smith at Acme Inc. Ran the audit.")).toEqual([
      "Reported to J. Smith at Acme Inc. Ran the audit.",
    ])
  })

  it("does not split mid-number or mid-word", () => {
    expect(splitIntoBullets("Improved throughput 1.5x across the fleet.")).toEqual([
      "Improved throughput 1.5x across the fleet.",
    ])
    expect(splitIntoBullets("-5% churn quarter over quarter")).toEqual([
      "-5% churn quarter over quarter",
    ])
  })

  it("never returns an empty array for non-blank input", () => {
    expect(splitIntoBullets("• ")).toEqual(["•"])
    expect(splitIntoBullets("...")).toEqual(["..."])
    expect(splitIntoBullets("-")).toEqual(["-"])
  })
})
