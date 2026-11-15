import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { IntelligentMatchingCard } from "../intelligent-matching-card"
import type {
  DimensionScore,
  IntelligentMatchingResult,
  MatchDimensionKey,
} from "../../services/intelligent-matching.service"

function dimension(
  label: string,
  score: number | null,
  status: DimensionScore["status"] = score === null ? "UNKNOWN" : "GOOD",
  explanation = "Explained from evidence."
): DimensionScore {
  return { score, weight: 0.1, label, status, explanation }
}

function result(overrides: Partial<IntelligentMatchingResult> = {}): IntelligentMatchingResult {
  const dimensions: Record<MatchDimensionKey, DimensionScore> = {
    eligibility: dimension("Eligibility & Authorization", null),
    skills: dimension("Skills & Capabilities", null),
    evidence: dimension("Verified Evidence", null),
    experience: dimension("Experience & Seniority", null),
    locationAndWorkMode: dimension("Location & Work Mode", null),
    salary: dimension("Salary Alignment", null),
    freshness: dimension("Posting Freshness", null),
  }

  return {
    compositeScore: null,
    priority: "UNKNOWN",
    summary: "Not enough evidence to score this job. Based on 0 of 7 factors (0% of the score weight).",
    dimensions,
    knownWeight: 0,
    knownDimensions: 0,
    strengths: [],
    gaps: [],
    ...overrides,
  }
}

describe("IntelligentMatchingCard", () => {
  it("shows a dash and an unknown badge instead of a fabricated percentage", () => {
    render(<IntelligentMatchingCard matchingResult={result()} />)

    expect(screen.getByText("Not enough data")).toBeTruthy()
    expect(screen.getByText("Based on 0 of 7 factors")).toBeTruthy()
    expect(screen.getByText("—")).toBeTruthy()
    expect(screen.queryByText("0%")).toBeNull()
  })

  it("renders known dimensions with a percentage and a factor count", () => {
    const matching = result({
      compositeScore: 72,
      priority: "MODERATE",
      knownWeight: 0.7,
      knownDimensions: 5,
      summary: "Moderate evidence match (72%). Based on 5 of 7 factors (70% of the score weight).",
    })
    matching.dimensions.skills = dimension("Skills & Capabilities", 80, "GOOD")
    matching.dimensions.experience = dimension("Experience & Seniority", 75, "NEUTRAL")
    matching.dimensions.locationAndWorkMode = dimension("Location & Work Mode", 100, "GOOD")
    matching.dimensions.evidence = dimension("Verified Evidence", 60, "NEUTRAL")
    matching.dimensions.salary = dimension("Salary Alignment", 40, "CONCERN")

    render(<IntelligentMatchingCard matchingResult={matching} />)

    expect(screen.getByText("72%")).toBeTruthy()
    expect(screen.getByText("Based on 5 of 7 factors")).toBeTruthy()
    expect(screen.getByText("Moderate Match")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /score breakdown/i }))

    expect(screen.getByText("80%")).toBeTruthy()
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0)
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
  })
})
