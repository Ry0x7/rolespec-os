import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ResumeCard, atsVariant } from "../resume-card"

vi.mock("../../actions", () => ({
  deleteResume: vi.fn(),
}))

afterEach(cleanup)

function baseResume(atsScore: number | null) {
  return {
    id: "r1",
    title: "Backend Engineer",
    targetRole: "Platform Engineer",
    variant: "MASTER" as const,
    roleFamily: null,
    jobApplication: null,
    template: "MODERN",
    atsScore,
    updatedAt: new Date("2026-01-15T00:00:00.000Z"),
  }
}

describe("atsVariant", () => {
  // Mirrors the editor header's ATSBadge thresholds.
  it("maps 75 and above to success", () => {
    expect(atsVariant(75)).toBe("success")
    expect(atsVariant(100)).toBe("success")
  })

  it("maps 50-74 to warning", () => {
    expect(atsVariant(50)).toBe("warning")
    expect(atsVariant(74)).toBe("warning")
  })

  it("maps below 50 to error", () => {
    expect(atsVariant(49)).toBe("error")
    expect(atsVariant(0)).toBe("error")
  })
})

describe("ResumeCard", () => {
  it("renders template and updated meta", () => {
    render(<ResumeCard resume={baseResume(80)} />)
    expect(screen.getByText("modern")).toBeTruthy()
    expect(screen.getByText(/^Updated /).textContent).toContain("2026")
  })

  // A card with only a denormalized `atsScore` has no analysis row to read a
  // mode off, so it falls back to the quality label — the same inference the
  // editor header makes when no job description is retained.
  it("colour-codes the score badge with the success palette at 80", () => {
    render(<ResumeCard resume={baseResume(80)} />)
    const badge = screen.getByText("Quality 80")
    expect(badge.className).toContain("text-green-400")
  })

  it("colour-codes the score badge with the error palette at 30", () => {
    render(<ResumeCard resume={baseResume(30)} />)
    const badge = screen.getByText("Quality 30")
    expect(badge.className).toContain("text-red-400")
  })

  it("omits the score badge when there is no score", () => {
    render(<ResumeCard resume={baseResume(null)} />)
    expect(screen.queryByText(/^(ATS|Quality) /)).toBeNull()
  })

  it("labels a quality analysis 'Quality' and prefers its score", () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume(30),
          latestAnalysis: { mode: "quality", overallScore: 80 },
        }}
      />
    )
    expect(screen.getByText("Quality 80")).toBeTruthy()
    expect(screen.queryByText(/^ATS /)).toBeNull()
  })

  it("labels a job-match analysis 'ATS' and prefers its score", () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume(30),
          latestAnalysis: { mode: "job-match", overallScore: 62 },
        }}
      />
    )
    expect(screen.getByText("ATS 62")).toBeTruthy()
    expect(screen.queryByText(/^Quality /)).toBeNull()
  })

  it("falls back to atsScore with the mode-inferred label when no analysis is loaded", () => {
    render(<ResumeCard resume={{ ...baseResume(55), latestAnalysis: null }} />)
    expect(screen.getByText("Quality 55")).toBeTruthy()
  })

  it("labels the atsScore fallback 'ATS' when the resume has a job target", () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume(55),
          latestAnalysis: null,
          jobApplication: {
            id: "job-1",
            jobTitle: "Platform Engineer",
            companyName: "Acme",
          },
        }}
      />
    )

    expect(screen.getByText("ATS 55")).toBeTruthy()
    expect(screen.queryByText(/^Quality /)).toBeNull()
  })

  it("lets a loaded quality analysis outrank the job-target proxy", () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume(55),
          latestAnalysis: { mode: "quality", overallScore: 70 },
          jobApplication: {
            id: "job-1",
            jobTitle: "Platform Engineer",
            companyName: "Acme",
          },
        }}
      />
    )

    expect(screen.getByText("Quality 70")).toBeTruthy()
  })

  it("keeps the delete affordance rendered without hover", () => {
    render(<ResumeCard resume={baseResume(80)} />)
    const button = screen.getByRole("button", { name: "Delete Backend Engineer" })
    expect(button.className).not.toContain("opacity-0")
  })

  it("identifies a master resume", () => {
    render(<ResumeCard resume={baseResume(80)} />)
    expect(screen.getByText("Master")).toBeTruthy()
    expect(screen.queryByText("Role family")).toBeNull()
  })

  it("identifies a role family resume and names its family", () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume(80),
          variant: "ROLE_FAMILY",
          roleFamily: { name: "Platform Engineering" },
        }}
      />
    )

    expect(screen.getByText("Role family")).toBeTruthy()
    expect(screen.getByText("Platform Engineering")).toBeTruthy()
  })

  it("identifies a job tailored resume and links its application", () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume(80),
          variant: "JOB_TAILORED",
          jobApplication: {
            id: "job-1",
            jobTitle: "Platform Engineer",
            companyName: "Acme",
          },
        }}
      />
    )

    expect(screen.getByText("Job tailored")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Platform Engineer — Acme" })
        .getAttribute("href")
    ).toBe("/jobs/job-1")
  })

  it("omits the application link when a tailored resume's application is gone", () => {
    render(
      <ResumeCard resume={{ ...baseResume(80), variant: "JOB_TAILORED" }} />
    )

    expect(screen.getByText("Job tailored")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /—/ })).toBeNull()
  })

  it("links a derived resume to the resume it came from", () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume(80),
          variant: "JOB_TAILORED",
          sourceResume: { id: "r0", title: "Platform Master", status: "ACTIVE" },
          origin: null,
          jobApplication: {
            id: "job-1",
            jobTitle: "Platform Engineer",
            companyName: "Acme",
          },
        }}
      />
    )

    expect(
      screen
        .getByRole("link", { name: "From Platform Master" })
        .getAttribute("href")
    ).toBe("/resumes/r0")
    // The job link is still there beside it.
    expect(
      screen
        .getByRole("link", { name: "Platform Engineer — Acme" })
        .getAttribute("href")
    ).toBe("/jobs/job-1")
  })

  it("says a profile-built master came from the Career Profile", () => {
    render(<ResumeCard resume={{ ...baseResume(80), origin: "profile" }} />)

    expect(screen.getByText("From Career Profile")).toBeTruthy()
    expect(screen.queryByText("Uploaded")).toBeNull()
  })

  it("shows nothing for a master without careerProfileId", () => {
    render(<ResumeCard resume={{ ...baseResume(80), origin: null }} />)

    expect(screen.queryByText(/^From /)).toBeNull()
    expect(screen.queryByText("Uploaded")).toBeNull()
  })

  it("names an archived source without linking it", () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume(80),
          variant: "ROLE_FAMILY",
          roleFamily: { name: "Platform Engineering" },
          sourceResume: { id: "r0", title: "Old Master", status: "ARCHIVED" },
          origin: null,
        }}
      />
    )

    expect(screen.getByText("From Old Master")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "From Old Master" })).toBeNull()
  })

  it("shows no lineage for a pre-lineage derived resume", () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume(80),
          variant: "ROLE_FAMILY",
          roleFamily: { name: "Platform Engineering" },
          sourceResume: null,
          origin: null,
        }}
      />
    )

    expect(screen.queryByText(/^From /)).toBeNull()
    expect(screen.queryByText("Uploaded")).toBeNull()
  })
})
