import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { RatingResults, deCamelize, orderedScores } from "../rating-results"
import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"

afterEach(cleanup)

function makeLinkedInRating(
  overrides: Partial<ProfileRatingData> = {}
): ProfileRatingData {
  return {
    id: "rating-1",
    kind: "LINKEDIN",
    sourceUrl: null,
    overallScore: 82,
    scores: {
      headline: 90,
      about: 71,
      experienceImpact: 64,
      skillsKeywords: 45,
      completeness: 88,
    },
    issues: [
      { severity: "critical", message: "Headline has no target role", category: "headline" },
      { severity: "warning", message: "About section is thin", category: "about" },
      { severity: "info", message: "Add two more skills", category: "skillsKeywords" },
    ],
    suggestions: { items: ["Lead with outcomes", "Add metrics to your last role"] },
    benchmark: null,
    createdAt: "2026-07-20T12:00:00.000Z",
    ...overrides,
  }
}

function makePortfolioRating(
  overrides: Partial<ProfileRatingData> = {}
): ProfileRatingData {
  return {
    id: "rating-2",
    kind: "PORTFOLIO",
    sourceUrl: "https://example.com",
    overallScore: 57,
    scores: {
      contentClarity: 60,
      projectShowcase: 55,
      professionalPositioning: 50,
      contactability: 70,
      keywordsSeo: 40,
    },
    issues: [
      { severity: "warning", message: "No contact link above the fold", category: "contactability" },
    ],
    suggestions: { items: ["Add a short positioning line to the hero"] },
    benchmark: null,
    createdAt: "2026-07-25T09:30:00.000Z",
    ...overrides,
  }
}

describe("RatingResults", () => {
  it("renders the overall score and the five LinkedIn category labels", () => {
    render(<RatingResults data={makeLinkedInRating()} />)

    expect(screen.getByText("Score: 82")).toBeTruthy()
    expect(screen.getByRole("img", { name: "Overall score 82 out of 100" })).toBeTruthy()

    // Issue categories echo some labels, so at-least-once is the assertion.
    for (const label of [
      "Headline",
      "About",
      "Experience impact",
      "Skills & keywords",
      "Completeness",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it("renders the five portfolio category labels and the source link", () => {
    render(<RatingResults data={makePortfolioRating()} />)

    for (const label of [
      "Content clarity",
      "Project showcase",
      "Professional positioning",
      "Contactability",
      "Keywords & SEO",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }

    const link = screen.getByRole("link", { name: /example\.com/ })
    expect(link.getAttribute("href")).toBe("https://example.com")
  })

  it("renders issues with severity hooks, critical first", () => {
    const { container } = render(<RatingResults data={makeLinkedInRating()} />)

    expect(screen.getByText("Issues")).toBeTruthy()
    const severities = Array.from(
      container.querySelectorAll("[data-severity]")
    ).map((el) => el.getAttribute("data-severity"))
    expect(severities).toEqual(["critical", "warning", "info"])
    expect(screen.getByText("Headline has no target role")).toBeTruthy()
  })

  it("renders every suggestion", () => {
    render(<RatingResults data={makeLinkedInRating()} />)

    expect(screen.getByText("Suggestions")).toBeTruthy()
    expect(screen.getByText("Lead with outcomes")).toBeTruthy()
    expect(screen.getByText("Add metrics to your last role")).toBeTruthy()
  })

  it("renders the rating date", () => {
    render(<RatingResults data={makePortfolioRating()} />)

    expect(screen.getByText(/Rated Jul 2[45], 2026/)).toBeTruthy()
  })

  it("renders the empty state when there is no rating", () => {
    render(<RatingResults data={null} emptyHint="Add your portfolio URL above." />)

    expect(screen.getByText("No rating yet — run your first scan")).toBeTruthy()
    expect(screen.getByText("Add your portfolio URL above.")).toBeTruthy()
  })

  it("falls back to a de-camelized label for unknown score keys", () => {
    render(
      <RatingResults
        data={makeLinkedInRating({ scores: { headline: 80, freshSignal: 30 } })}
      />
    )

    expect(screen.getAllByText("Headline").length).toBeGreaterThan(0)
    expect(screen.getByText("Fresh signal")).toBeTruthy()
  })
})

describe("orderedScores", () => {
  it("keeps known keys in declared order and appends unknown ones", () => {
    const result = orderedScores("PORTFOLIO", {
      keywordsSeo: 10,
      contentClarity: 20,
      mysteryMetric: 30,
    })

    expect(result.map((r) => r.key)).toEqual([
      "contentClarity",
      "keywordsSeo",
      "mysteryMetric",
    ])
    expect(result.map((r) => r.label)).toEqual([
      "Content clarity",
      "Keywords & SEO",
      "Mystery metric",
    ])
  })
})

describe("deCamelize", () => {
  it("splits camelCase into sentence case", () => {
    expect(deCamelize("keywordsSeo")).toBe("Keywords seo")
    expect(deCamelize("about")).toBe("About")
    expect(deCamelize("skills_keywords")).toBe("Skills keywords")
  })
})
