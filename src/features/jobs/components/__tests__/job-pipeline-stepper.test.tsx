import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { JobPipelineStepper, type PipelineEvidence } from "../job-pipeline-stepper"

const BASE: PipelineEvidence = {
  jobApplicationId: "job-1",
  status: "INTERESTED",
  hasCareerProfile: false,
  hasQualification: false,
  hasCompanyResearch: false,
  hasTailoredResume: false,
  hasCoverLetter: false,
  hasMatchScore: false,
  hasApplied: false,
  hasTracking: false,
  hasFollowUp: false,
  hasFollowedUp: false,
  isFollowUpDue: false,
  chosenResumeId: null,
}

function renderStepper(overrides: Partial<PipelineEvidence> = {}) {
  return render(<JobPipelineStepper {...BASE} {...overrides} />)
}

function currentLinks() {
  return screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "step")
}

afterEach(cleanup)

describe("JobPipelineStepper", () => {
  it("does not mark the profile complete when no profile evidence exists", () => {
    renderStepper()

    expect(screen.getByText("0 of 8 stages complete")).toBeTruthy()
    const profile = screen.getByRole("link", { name: /1\. Career Profile/ })
    expect(profile.getAttribute("aria-current")).toBe("step")
    expect(profile.getAttribute("href")).toBe("/career-profile")
    expect(currentLinks()).toHaveLength(1)
  })

  it("makes the first gap current even when a later stage has evidence", () => {
    renderStepper({
      hasCareerProfile: true,
      hasQualification: true,
      hasTailoredResume: true,
    })

    const research = screen.getByRole("link", { name: /3\. Company Research/ })
    const resume = screen.getByRole("link", { name: /4\. Resume Tailoring/ })

    expect(research.getAttribute("aria-current")).toBe("step")
    expect(research.getAttribute("aria-label")).toBe("3. Company Research: current")
    expect(resume.getAttribute("aria-current")).toBeNull()
    expect(resume.getAttribute("aria-label")).toBe("4. Resume Tailoring: pending")
    expect(screen.getByText("2 of 8 stages complete")).toBeTruthy()
    expect(currentLinks()).toHaveLength(1)
  })

  it("does not count legacy or unverified company research as complete", () => {
    renderStepper({
      hasCareerProfile: true,
      hasQualification: true,
      hasCompanyResearch: false,
    })

    expect(
      screen.getByRole("link", { name: /3\. Company Research/ }).getAttribute("aria-current"),
    ).toBe("step")
    expect(screen.getByText("2 of 8 stages complete")).toBeTruthy()
  })

  it("only links to destinations that exist on the job page", () => {
    renderStepper()

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"))

    expect(hrefs).toContain("/career-profile")
    expect(hrefs).toContain("#decide")
    expect(hrefs).toContain("#research")
    expect(hrefs).toContain("#prepare")
    expect(hrefs).toContain("#track")
    for (const broken of ["#match", "#outline", "#outreach", "#tasks", "#timeline", "/profile"]) {
      expect(hrefs).not.toContain(broken)
    }
  })

  it("uses the chosen resume link when one is set", () => {
    renderStepper({ chosenResumeId: "resume-9" })

    const resume = screen.getByRole("link", { name: /4\. Resume Tailoring/ })
    expect(resume.getAttribute("href")).toBe("/resumes/resume-9?jobId=job-1")
  })

  it("reaches 8 of 8 when every stage has persisted evidence", () => {
    renderStepper({
      hasCareerProfile: true,
      hasQualification: true,
      hasCompanyResearch: true,
      hasTailoredResume: true,
      hasCoverLetter: true,
      hasApplied: true,
      hasTracking: true,
      hasFollowedUp: true,
      status: "SCREENING",
    })

    expect(screen.getByText("8 of 8 stages complete")).toBeTruthy()
    expect(currentLinks()).toHaveLength(0)
  })

  it("does not complete tracking from the same move that completed apply", () => {
    renderStepper({
      hasCareerProfile: true,
      hasQualification: true,
      hasCompanyResearch: true,
      hasTailoredResume: true,
      hasCoverLetter: true,
      hasApplied: true,
      status: "APPLIED",
    })

    expect(screen.getByText("6 of 8 stages complete")).toBeTruthy()
    expect(currentLinks()).toHaveLength(1)
    expect(currentLinks()[0].getAttribute("aria-label")).toBe("7. Tracking: current")
  })

  it("leaves a scheduled future follow-up as the final current stage", () => {
    renderStepper({
      hasCareerProfile: true,
      hasQualification: true,
      hasCompanyResearch: true,
      hasTailoredResume: true,
      hasCoverLetter: true,
      hasApplied: true,
      hasTracking: true,
      hasFollowUp: true,
      hasFollowedUp: false,
      status: "SCREENING",
    })

    expect(screen.getByText("7 of 8 stages complete")).toBeTruthy()
    expect(currentLinks()).toHaveLength(1)
    expect(currentLinks()[0].getAttribute("aria-label")).toBe("8. Follow-up: current")
  })
})
