import { describe, expect, it } from "vitest"

import { valueForJob } from "@/features/opportunity/services/opportunity-value.service"
import {
  partitionByOpportunityValue,
  serializeOpportunityValue,
} from "../../lib/opportunity-value"
import type { DiscoveryCandidate } from "../discovery.actions"

/**
 * The partition is the only place discovery lets a user's own settings remove a
 * posting from the actionable list. Eligibility deliberately does not, because
 * the qualification verdict already owns that and has its own visible toggle.
 */

function candidate(
  externalId: string,
  salary: { min: number; max: number; currency: "USD"; period: "YEARLY"; text: string } | null,
  description: string,
  unknownPay: "ALLOW" | "FLAG" | "REJECT" = "ALLOW",
  minimumAnnualPay: string | null = null,
  minimumPayStrict = false
): DiscoveryCandidate {
  const value = valueForJob({
    posting: {
      title: "Senior Platform Engineer",
      companyName: `Company ${externalId}`,
      url: `https://example.com/jobs/${externalId}`,
      description,
      salaryText: salary?.text ?? null,
      salaryMin: salary?.min ?? null,
      salaryMax: salary?.max ?? null,
      salaryCurrency: salary?.currency ?? null,
      salaryPeriod: salary?.period ?? null,
      salaryProvenance: "POSTING_TEXT",
    },
    profile: {
      salaryMin: "200000",
      salaryMax: "220000",
      salaryCurrency: "USD",
      salaryPeriod: "YEARLY",
    },
    preferences: {
      opportunityValue: {
        preset: "BALANCED",
        weights: null,
        minimumAnnualPay,
        minimumPayCurrency: minimumAnnualPay ? "USD" : null,
        minimumPayStrict,
        workloadPreference: "BALANCED",
        unknownPay,
      },
    },
    context: { fitScore: 80, eligibility: "GOOD", confidence: "HIGH", risk: "LOW" },
  })

  return {
    externalId,
    provider: "test",
    title: "Senior Platform Engineer",
    companyName: `Company ${externalId}`,
    url: `https://example.com/jobs/${externalId}`,
    canonicalUrl: `https://example.com/jobs/${externalId}`,
    alreadySaved: false,
    qualification: {} as DiscoveryCandidate["qualification"],
    confidence: {} as DiscoveryCandidate["confidence"],
    opportunityValue: serializeOpportunityValue(value),
  }
}

describe("partitionByOpportunityValue", () => {
  it("accepts a high-pay, light-workload posting", () => {
    const { accepted, excluded } = partitionByOpportunityValue([
      candidate("light", { min: 240000, max: 260000, currency: "USD", period: "YEARLY", text: "$240k-$260k" }, "Flexible hours, no on-call."),
    ])
    expect(accepted).toHaveLength(1)
    expect(excluded).toHaveLength(0)
    expect(accepted[0]!.opportunityValue?.accepted).toBe(true)
  })

  it("excludes a below-floor posting under strict settings, with the reason kept", () => {
    const { accepted, excluded } = partitionByOpportunityValue([
      candidate(
        "low",
        { min: 120000, max: 140000, currency: "USD", period: "YEARLY", text: "$120k-$140k" },
        "",
        "ALLOW",
        "300000",
        true
      ),
    ])
    expect(accepted).toHaveLength(0)
    expect(excluded).toHaveLength(1)
    const reasons = excluded[0]!.opportunityValue!.rejections
    expect(reasons).toContainEqual(expect.objectContaining({ code: "MINIMUM_PAY", severity: "BLOCK" }))
  })

  it("keeps a below-floor posting when the floor is not strict", () => {
    const { accepted, excluded } = partitionByOpportunityValue([
      candidate(
        "soft",
        { min: 120000, max: 140000, currency: "USD", period: "YEARLY", text: "$120k-$140k" },
        "",
        "ALLOW",
        "300000",
        false
      ),
    ])
    expect(accepted).toHaveLength(1)
    expect(excluded).toHaveLength(0)
  })

  it("excludes unknown pay under REJECT and labels it", () => {
    const { accepted, excluded } = partitionByOpportunityValue([
      candidate("nopay", null, "", "REJECT"),
    ])
    expect(accepted).toHaveLength(0)
    expect(excluded).toHaveLength(1)
    expect(excluded[0]!.opportunityValue!.rejections).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_PAY", severity: "BLOCK" })
    )
  })

  it("never excludes a posting for eligibility — that stays the qualification's call", () => {
    const value = valueForJob({
      posting: {
        title: "Backend Engineer",
        companyName: "Example",
        url: "https://example.com/jobs/elig",
        salaryText: "$200,000 per year",
        salaryMin: 200000,
        salaryMax: 200000,
        salaryCurrency: "USD",
        salaryPeriod: "YEARLY",
        salaryProvenance: "POSTING_TEXT",
      },
      profile: { salaryMin: "200000", salaryMax: "220000", salaryCurrency: "USD", salaryPeriod: "YEARLY" },
      preferences: null,
      context: { fitScore: 50, eligibility: "BLOCKER", confidence: "HIGH", risk: "LOW" },
    })
    const candidateValue = serializeOpportunityValue(value)
    expect(candidateValue.accepted).toBe(false)

    const { accepted, excluded } = partitionByOpportunityValue([
      {
        ...candidate("elig", null, ""),
        opportunityValue: candidateValue,
      },
    ])
    expect(accepted).toHaveLength(1)
    expect(excluded).toHaveLength(0)
  })
})
