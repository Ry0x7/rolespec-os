import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { computeOpportunityValue } from "@/features/opportunity/value"
import { DEFAULT_OPPORTUNITY_SETTINGS, type OpportunityInput } from "@/features/opportunity/types"

import { OpportunityValueBadge, OpportunityValueCard } from "../opportunity-value-card"

const URL = "https://example.com/jobs/42"

function value(overrides: Partial<OpportunityInput> = {}) {
  return computeOpportunityValue({
    posting: {
      title: "Senior Platform Engineer",
      companyName: "Example",
      url: URL,
      description:
        "The role requires an on-call rotation. There is no travel. Fixed schedule in core hours.",
      salary: {
        min: 200000,
        max: 240000,
        currency: "USD",
        period: "YEARLY",
        text: "$200,000 - $240,000 per year",
        verified: true,
      },
    },
    expectation: { annualMin: 200000, annualMax: 220000, currency: "USD" },
    context: { fitScore: 78, eligibility: "GOOD", confidence: "HIGH", risk: "LOW" },
    settings: { ...DEFAULT_OPPORTUNITY_SETTINGS },
    ...overrides,
  })
}

describe("OpportunityValueCard", () => {
  it("renders the score and grade", () => {
    const result = value()
    render(<OpportunityValueCard value={result} />)

    expect(screen.getByTestId("opportunity-score").textContent).toContain(String(result.score))
    expect(screen.getByTestId("opportunity-grade").textContent).toContain(
      result.grade === "STRONG" ? "Strong value" : "value"
    )
    expect(screen.getByTestId("opportunity-value").getAttribute("aria-label")).toBe(
      "Opportunity value"
    )
  })

  it("shows a supported signal with its quoted excerpt and source link", () => {
    render(<OpportunityValueCard value={value()} />)

    const onCall = screen.getByTestId("opportunity-signal-ON_CALL")
    expect(onCall.getAttribute("data-state")).toBe("SUPPORTED")
    expect(onCall.textContent).toContain("on-call rotation")
    expect(onCall.textContent).toContain("Stated")

    const source = onCall.querySelector("a")
    expect(source?.getAttribute("href")).toBe(URL)
    expect(source?.getAttribute("rel")).toBe("noopener noreferrer")
  })

  it("words a dimension with no data as unknown, never as zero", () => {
    render(<OpportunityValueCard value={value()} />)

    const friction = screen.getByTestId("opportunity-dimension-FRICTION")
    expect(friction.getAttribute("data-state")).toBe("UNKNOWN")
    expect(friction.textContent).toContain("unknown")
    expect(screen.getByTestId("opportunity-dimension-EFFECTIVE_HOURLY").textContent).toContain(
      "unknown"
    )
  })

  it("renders a blocking rejection with its reason", () => {
    const result = value({
      posting: {
        title: "Mystery role",
        companyName: "Example",
        url: URL,
        description: null,
        salary: null,
      },
      settings: { ...DEFAULT_OPPORTUNITY_SETTINGS, unknownPay: "REJECT" },
    })
    render(<OpportunityValueCard value={result} />)

    const rejection = screen.getAllByTestId("opportunity-rejection")[0]!
    expect(rejection.getAttribute("data-severity")).toBe("BLOCK")
    expect(rejection.textContent).toContain("Blocked")
    expect(rejection.textContent).toContain("reject unknown pay")
    expect(screen.getByTestId("opportunity-grade").textContent).toContain("Blocked")
  })

  it("renders a contradiction with both sentences", () => {
    const result = value({
      posting: {
        title: "Platform Engineer",
        companyName: "Example",
        url: URL,
        description: "No overtime. Overtime is required during quarterly close.",
        salary: {
          min: 200000,
          max: 240000,
          currency: "USD",
          period: "YEARLY",
          text: "$200k-$240k",
        },
      },
    })
    render(<OpportunityValueCard value={result} />)

    const block = screen.getByTestId("opportunity-contradictions")
    expect(block.textContent).toContain("Overtime is required")
    expect(block.textContent).toContain("No overtime")
  })
})

describe("OpportunityValueBadge", () => {
  it("renders the score and a readable title", () => {
    const result = value()
    render(<OpportunityValueBadge value={result} />)

    const badge = screen.getByTestId("opportunity-value-badge")
    expect(badge.textContent).toContain(`Value ${result.score}`)
    expect(badge.getAttribute("title")).toContain(`${result.score}/100`)
  })
})
