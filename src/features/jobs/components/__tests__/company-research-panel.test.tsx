import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

vi.mock("../../actions/company-research.actions", () => ({
  runCompanyResearch: vi.fn(),
}))

import { CompanyResearchPanel } from "../company-research-panel"
import type { CompanyResearchResult } from "../../services/company-research.service"

afterEach(cleanup)

const base: CompanyResearchResult = {
  companyName: "Acme",
  industry: "Software",
  headquarters: "San Francisco, CA",
  companySize: "500",
  overview: "Acme builds developer tools.",
  keyProducts: ["Acme Cloud"],
  statedMissionOrValues: ["Ship reliable software"],
  techStack: ["TypeScript"],
  interviewTips: ["Be ready to discuss TypeScript."],
  citations: [],
  confidence: "HIGH",
  confidenceExplanation: "Extracted directly from the official job posting and verified company listing.",
  researchedAt: "2026-11-09T00:00:00.000Z",
}

describe("CompanyResearchPanel", () => {
  it("hides legacy facts that were never checked against a fetched source", () => {
    render(
      <CompanyResearchPanel
        jobApplicationId="app-1"
        companyName="Acme"
        initialResearch={base}
      />
    )

    expect(screen.getByText("Saved research is unverified")).toBeTruthy()
    expect(screen.queryByText(/San Francisco/)).toBeNull()
    expect(screen.queryByText("Acme Cloud")).toBeNull()
    expect(screen.queryByText(/Extracted directly/)).toBeNull()
    expect(screen.getByText("Unverified / Legacy")).toBeTruthy()
  })

  it("shows facts only when a citation was actually fetched", () => {
    render(
      <CompanyResearchPanel
        jobApplicationId="app-1"
        companyName="Acme"
        initialResearch={{
          ...base,
          validationVersion: 2,
          citations: [
            {
              title: "About Acme",
              url: "https://acme.test/about",
              verified: true,
              fetchedAt: "2026-11-09T00:00:00.000Z",
              sourceType: "COMPANY",
            },
          ],
        }}
      />
    )

    expect(screen.queryByText("Saved research is unverified")).toBeNull()
    expect(screen.getByText(/San Francisco/)).toBeTruthy()
    expect(screen.getByText("Acme Cloud")).toBeTruthy()
    expect(screen.getByText("Verified Citations & Sources (1)")).toBeTruthy()
    expect(screen.getByText("High Confidence")).toBeTruthy()
  })

  it("calls a fresh no-source run unchecked, not legacy, and never shows a confidence label", () => {
    render(
      <CompanyResearchPanel
        jobApplicationId="app-1"
        companyName="Acme"
        initialResearch={{
          ...base,
          confidence: "LOW",
          validationVersion: 2,
          citations: [],
        }}
      />
    )

    expect(screen.getAllByText("No verified sources").length).toBeGreaterThan(0)
    expect(screen.queryByText("Unverified / Legacy")).toBeNull()
    expect(screen.queryByText("Saved research is unverified")).toBeNull()
    expect(screen.queryByText(/San Francisco/)).toBeNull()
    expect(screen.queryByText("High Confidence")).toBeNull()
    expect(screen.queryByText(/Extracted directly/)).toBeNull()
    expect(screen.getAllByText(/No source could be fetched and verified/).length).toBeGreaterThan(0)
  })
})
