import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { mockUseSession, mockUpdate, mockAnalyze, mockToastError } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUpdate: vi.fn(),
  mockAnalyze: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock("next-auth/react", () => ({ useSession: mockUseSession }))
vi.mock("sonner", () => ({ toast: { error: mockToastError } }))
vi.mock("../../actions/job-match.actions", () => ({ analyzeJobMatch: mockAnalyze }))

import { JobMatchPanel } from "../job-match-panel"

const resumeOptions = [
  { id: "r1", title: "Engineer", atsScore: 70 },
  { id: "r2", title: "Designer", atsScore: 55 },
]

function renderPanel() {
  return render(
    <JobMatchPanel
      jobApplicationId="j1"
      hasJobDescription
      resumeOptions={resumeOptions}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({})
  mockUseSession.mockReturnValue({ update: mockUpdate })
})

afterEach(cleanup)

describe("job match panel", () => {
  it("renders the skeleton and the wait-time copy while analyzing", async () => {
    let resolve: (v: unknown) => void = () => {}
    mockAnalyze.mockReturnValue(new Promise((r) => (resolve = r)))

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /analyze match/i }))

    await waitFor(() =>
      expect(screen.getByText(/usually takes 30–60 seconds/i)).toBeTruthy(),
    )

    resolve({ error: "Something went wrong. Please try again." })
    await waitFor(() =>
      expect(screen.queryByText(/usually takes 30–60 seconds/i)).toBeNull(),
    )
  })

  it("toasts errors", async () => {
    mockAnalyze.mockResolvedValue({ error: "Resume not found" })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /analyze match/i }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("Resume not found"))
  })
})

describe("job match panel stored result hydration", () => {
  const storedMatch = {
    matchScore: 71,
    summary: "Stored summary.",
    matchedKeywords: ["React"],
    missingKeywords: ["Kubernetes"],
    suggestions: ["Add a deployment bullet."],
    resumeId: "r2",
    checkedAt: "2026-08-15T00:00:00.000Z",
  }

  it("renders the stored result before any analyze runs", () => {
    render(
      <JobMatchPanel
        jobApplicationId="j1"
        hasJobDescription
        resumeOptions={resumeOptions}
        initialMatch={storedMatch}
      />,
    )

    expect(screen.getByText("71")).toBeTruthy()
    expect(screen.getByText("Stored summary.")).toBeTruthy()
    expect(mockAnalyze).not.toHaveBeenCalled()
  })

  it("preselects the resume the stored result was measured against", () => {
    render(
      <JobMatchPanel
        jobApplicationId="j1"
        hasJobDescription
        resumeOptions={resumeOptions}
        initialMatch={storedMatch}
      />,
    )

    expect((screen.getByLabelText("Resume") as HTMLSelectElement).value).toBe("r2")
    expect(screen.getByText(/last checked against Designer/i)).toBeTruthy()
  })

  it("falls back to the first resume and says so when the stored one is gone", () => {
    render(
      <JobMatchPanel
        jobApplicationId="j1"
        hasJobDescription
        resumeOptions={resumeOptions}
        initialMatch={{ ...storedMatch, resumeId: "archived" }}
      />,
    )

    expect((screen.getByLabelText("Resume") as HTMLSelectElement).value).toBe("r1")
    // `resumeOptions` only carries live resumes, so a stored id that is absent
    // from it was archived — and the score is stale until it is re-run.
    expect(
      screen.getByText(
        /last checked against a resume that has since been archived/i,
      ),
    ).toBeTruthy()
    expect(screen.getByText(/re-check for a current score/i)).toBeTruthy()
    // The stored verdict still shows — losing the resume does not lose the analysis.
    expect(screen.getByText("Stored summary.")).toBeTruthy()
  })

  it("does not call a legacy snapshot with no recorded resume archived", () => {
    render(
      <JobMatchPanel
        jobApplicationId="j1"
        hasJobDescription
        resumeOptions={resumeOptions}
        initialMatch={{ ...storedMatch, resumeId: null }}
      />,
    )

    expect(screen.queryByText(/has since been archived/i)).toBeNull()
    expect(screen.queryByText(/re-check for a current score/i)).toBeNull()
  })

  it("says nothing about archiving when the stored resume is still live", () => {
    render(
      <JobMatchPanel
        jobApplicationId="j1"
        hasJobDescription
        resumeOptions={resumeOptions}
        initialMatch={storedMatch}
      />,
    )

    expect(screen.queryByText(/has since been archived/i)).toBeNull()
    expect(screen.queryByText(/re-check for a current score/i)).toBeNull()
  })

  it("replaces the stored result and drops its provenance line on a new check", async () => {
    mockAnalyze.mockResolvedValue({
      matchScore: 88,
      summary: "Fresh summary.",
      matchedKeywords: ["React"],
      missingKeywords: [],
      suggestions: [],
    })

    render(
      <JobMatchPanel
        jobApplicationId="j1"
        hasJobDescription
        resumeOptions={resumeOptions}
        initialMatch={storedMatch}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /analyze match/i }))

    await waitFor(() => expect(screen.getByText("Fresh summary.")).toBeTruthy())
    expect(screen.queryByText("Stored summary.")).toBeNull()
    expect(screen.queryByText(/last checked against/i)).toBeNull()
  })
})

describe("job match panel resume editor hand-off", () => {
  it("links to the editor for the preselected resume with the job id", () => {
    renderPanel()

    const link = screen.getByRole("link", { name: /open in resume editor/i })
    expect(link.getAttribute("href")).toBe("/resumes/r1?jobId=j1")
  })

  it("updates the href when a different resume is selected", () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText("Resume"), { target: { value: "r2" } })

    expect(
      screen.getByRole("link", { name: /open in resume editor/i }).getAttribute("href"),
    ).toBe("/resumes/r2?jobId=j1")
  })

  it("hides the editor link when no resume is selected", () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText("Resume"), { target: { value: "" } })

    expect(screen.queryByRole("link", { name: /open in resume editor/i })).toBeNull()
  })

  it("keeps the empty state untouched when there are no resumes", () => {
    render(
      <JobMatchPanel jobApplicationId="j1" hasJobDescription resumeOptions={[]} />,
    )

    expect(screen.getByText(/no resume to match/i)).toBeTruthy()
    expect(screen.getByRole("link", { name: /go to resumes/i })).toBeTruthy()
    expect(screen.queryByRole("link", { name: /open in resume editor/i })).toBeNull()
  })

  it("shows the results CTA after an analyze that returns gaps", async () => {
    mockAnalyze.mockResolvedValue({
      matchScore: 62,
      summary: "Decent overlap.",
      matchedKeywords: ["React"],
      missingKeywords: ["Kubernetes"],
      suggestions: ["Add a deployment bullet."],
    })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /analyze match/i }))

    await waitFor(() => {
      expect(
        screen
          .getByRole("link", { name: /fix these in the resume editor/i })
          .getAttribute("href"),
      ).toBe("/resumes/r1?jobId=j1")
    })
  })

  it("omits the results CTA when there are no gaps to fix", async () => {
    mockAnalyze.mockResolvedValue({
      matchScore: 95,
      summary: "Strong match.",
      matchedKeywords: ["React"],
      missingKeywords: [],
      suggestions: [],
    })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /analyze match/i }))

    await waitFor(() => expect(screen.getByText("Strong match.")).toBeTruthy())
    expect(
      screen.queryByRole("link", { name: /fix these in the resume editor/i }),
    ).toBeNull()
  })
})

describe("job match panel — one resume per job", () => {
  it("defaults to the resume the job page resolved, not the stored match's", () => {
    // The page passes chosen ?? recommended; an older stored match may name a
    // resume tailored to a different job entirely.
    render(
      <JobMatchPanel
        jobApplicationId="j1"
        hasJobDescription
        resumeOptions={resumeOptions}
        chosenResumeId="r2"
        initialMatch={{
          matchScore: 71,
          summary: "Stored summary.",
          matchedKeywords: [],
          missingKeywords: [],
          suggestions: [],
          resumeId: "r1",
          checkedAt: null,
        }}
      />,
    )

    expect((screen.getByLabelText(/resume/i) as HTMLSelectElement).value).toBe("r2")
  })

  it("falls back to the stored match's resume when the page resolved none", () => {
    render(
      <JobMatchPanel
        jobApplicationId="j1"
        hasJobDescription
        resumeOptions={resumeOptions}
        chosenResumeId={null}
        initialMatch={{
          matchScore: 71,
          summary: "Stored summary.",
          matchedKeywords: [],
          missingKeywords: [],
          suggestions: [],
          resumeId: "r1",
          checkedAt: null,
        }}
      />,
    )

    expect((screen.getByLabelText(/resume/i) as HTMLSelectElement).value).toBe("r1")
  })
})
