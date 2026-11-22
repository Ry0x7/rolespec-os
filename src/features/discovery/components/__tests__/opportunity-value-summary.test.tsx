import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { SerializedOpportunityValue } from "../../lib/opportunity-value"
import { OpportunityValueSummary } from "../opportunity-value-summary"

const URL = "https://example.com/jobs/42"

function value(overrides: Partial<SerializedOpportunityValue> = {}): SerializedOpportunityValue {
  return {
    score: 61,
    grade: "DECENT",
    preset: "BALANCED",
    accepted: true,
    coverage: 0.4,
    rejections: [],
    contradictions: [],
    explanation: ["Not scored: effective hourly pay."],
    dimensions: [
      {
        id: "COMPENSATION",
        label: "Verified compensation",
        score: null,
        weight: 22,
        state: "UNKNOWN",
        reason: "The posting's pay does not say which currency it is in.",
        evidence: [],
      },
      {
        id: "WORKLOAD",
        label: "Workload",
        score: 76,
        weight: 15,
        state: "SUPPORTED",
        reason: "The posting mentions on-call.",
        evidence: [],
      },
    ],
    workload: {
      score: 76,
      state: "SUPPORTED",
      reason: "The posting mentions on-call.",
      indicators: [
        {
          id: "ON_CALL",
          state: "SUPPORTED",
          reason: "The posting mentions on-call.",
          evidence: { excerpt: "You will join the on-call rotation.", sourceUrl: URL, source: "POSTING_TEXT" },
        },
        {
          id: "TRAVEL",
          state: "UNKNOWN",
          reason: "The posting does not state how much travel is involved.",
          evidence: null,
        },
      ],
    },
    friction: {
      score: null,
      state: "UNKNOWN",
      reason: "The posting does not describe its application process.",
      interviewStages: null,
      indicators: [],
    },
    compensation: {
      min: null,
      max: null,
      currency: null,
      period: null,
      annualMin: null,
      annualMax: null,
      annualMidpoint: null,
      expectedMidpoint: null,
      ratio: null,
      score: null,
      state: "UNKNOWN",
      reason: "The posting's pay does not say which currency it is in.",
      signals: [],
    },
    hourly: {
      effectiveHourly: null,
      hoursPerWeek: null,
      weeksPerYear: 52,
      expectedHourly: null,
      ratio: null,
      score: null,
      state: "UNKNOWN",
      reason: "The posting does not state working hours, so effective hourly pay cannot be estimated.",
      evidence: null,
    },
    ...overrides,
  }
}

describe("OpportunityValueSummary", () => {
  it("shows an unknown dimension as unknown, never as zero", () => {
    render(<OpportunityValueSummary value={value()} defaultExpanded />)
    expect(screen.getByText("Verified compensation")).toBeTruthy()
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0)
    // The score column is an em dash for an unscored dimension.
    expect(screen.queryByText("0/100")).toBeNull()
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
  })

  it("keeps the quoted sentence and links to its source", () => {
    render(<OpportunityValueSummary value={value()} defaultExpanded />)
    expect(screen.getByText(/You will join the on-call rotation/)).toBeTruthy()
    const link = screen.getByRole("link", { name: "source" })
    expect(link.getAttribute("href")).toBe(URL)
  })

  it("explains that no hourly figure is estimated without stated hours", () => {
    render(<OpportunityValueSummary value={value()} defaultExpanded />)
    expect(
      screen.getByText(/does not state working hours, so no hourly figure is estimated/i)
    ).toBeTruthy()
  })

  it("renders both sides of a contradiction", () => {
    render(
      <OpportunityValueSummary
        value={value({
          contradictions: [
            { id: "OVERTIME", excerpts: ["Overtime is required.", "There is no overtime."] },
          ],
        })}
        defaultExpanded
      />
    )
    expect(screen.getByTestId("opportunity-contradictions")).toBeTruthy()
    expect(screen.getByText(/Overtime is required/)).toBeTruthy()
    expect(screen.getByText(/There is no overtime/)).toBeTruthy()
  })

  it("surfaces a blocking rejection reason", () => {
    render(
      <OpportunityValueSummary
        value={value({
          accepted: false,
          grade: "BLOCKED",
          rejections: [
            {
              code: "MINIMUM_PAY",
              message: "The posting's top of range is below your minimum pay.",
              severity: "BLOCK",
            },
          ],
        })}
      />
    )
    expect(screen.getByTestId("opportunity-blocks").textContent).toMatch(/below your minimum pay/i)
  })

  it("is collapsed by default and opens on request", () => {
    render(<OpportunityValueSummary value={value()} />)
    expect(screen.queryByText("Workload evidence")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Value breakdown/ }))
    expect(screen.getByText("Workload evidence")).toBeTruthy()
  })
})
