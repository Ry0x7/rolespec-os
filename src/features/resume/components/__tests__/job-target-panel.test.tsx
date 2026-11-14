import { describe, it, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const { mockGetJobDescription } = vi.hoisted(() => ({
  mockGetJobDescription: vi.fn(),
}))

vi.mock("../../actions/get-job-description", () => ({
  getJobDescriptionForResume: mockGetJobDescription,
}))

import { JobTargetPanel, type JobOption } from "../job-target-panel"
import { useResumeStore, type ResumeData } from "../../hooks/use-resume-store"
import { MAX_ATS_JOB_DESCRIPTION_LENGTH } from "../../constants/ats"

const makeResume = (overrides: Partial<ResumeData> = {}): ResumeData => ({
  id: "r1",
  title: "Test",
  targetRole: null,
  targetCompany: null,
  template: "MINIMAL",
  sections: [],
  atsScore: null,
  jobDescription: null,
  latestAnalysis: null,
  ...overrides,
})

const jobOptions: JobOption[] = [
  { id: "job-1", companyName: "Acme", jobTitle: "Backend Engineer", hasJobDescription: true },
  { id: "job-2", companyName: "Globex", jobTitle: "Platform Engineer", hasJobDescription: false },
]

describe("JobTargetPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetJobDescription.mockResolvedValue({ jobDescription: "Loaded listing text" })
    useResumeStore.getState().setResume(makeResume())
  })

  it("renders the job description editor even with no target role or keywords", () => {
    render(<JobTargetPanel />)

    expect(screen.getByLabelText("Job Description")).toBeTruthy()
    expect(screen.getByText(/Required for Analyze/)).toBeTruthy()
  })

  it("writes typed text into the store and caps the field at the shared limit", () => {
    render(<JobTargetPanel />)

    const textarea = screen.getByLabelText("Job Description") as HTMLTextAreaElement
    expect(textarea.maxLength).toBe(MAX_ATS_JOB_DESCRIPTION_LENGTH)

    fireEvent.change(textarea, { target: { value: "Kubernetes required." } })

    expect(useResumeStore.getState().jobDescription).toBe("Kubernetes required.")
    expect(screen.getByText(`20/${MAX_ATS_JOB_DESCRIPTION_LENGTH}`)).toBeTruthy()
  })

  it("seeds the textarea from the resume's retained job description", () => {
    useResumeStore.getState().setResume(makeResume({ jobDescription: "Retained listing" }))

    render(<JobTargetPanel />)

    expect((screen.getByLabelText("Job Description") as HTMLTextAreaElement).value).toBe(
      "Retained listing"
    )
  })

  it("still shows the target role", () => {
    useResumeStore.getState().setResume(makeResume({ targetRole: "Backend Engineer" }))

    render(<JobTargetPanel />)

    expect(screen.getByText("— Backend Engineer")).toBeTruthy()
  })

  // The keyword list now lives only in the ATS inspector (diagnostic) and
  // the Skills editor (actionable) — this panel's own copy was a third,
  // inert repetition of the same 20 strings and is gone.
  it("no longer renders a missing-keywords block, even when the store has some", () => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.getState().setMissingKeywords(["Kubernetes", "Terraform"])

    render(<JobTargetPanel />)

    expect(screen.queryByText("Keywords to Include")).toBeNull()
    expect(screen.queryByText("Kubernetes")).toBeNull()
  })

  it("hides the saved-job picker when there are no jobs", () => {
    render(<JobTargetPanel jobOptions={[]} />)

    expect(screen.queryByLabelText("Load from saved job")).toBeNull()
  })

  it("renders one option per job and disables jobs without a description", () => {
    render(<JobTargetPanel jobOptions={jobOptions} />)

    const select = screen.getByLabelText("Load from saved job") as HTMLSelectElement
    expect(select.options.length).toBe(3)
    expect(select.options[0].textContent).toBe("Paste manually or pick a job…")
    expect(select.options[1].textContent).toBe("Backend Engineer — Acme")
    expect(select.options[1].disabled).toBe(false)
    expect(select.options[2].textContent).toBe("Platform Engineer — Globex (no description)")
    expect(select.options[2].disabled).toBe(true)
  })

  it("loads the picked job's description into the store", async () => {
    render(<JobTargetPanel jobOptions={jobOptions} />)

    fireEvent.change(screen.getByLabelText("Load from saved job"), {
      target: { value: "job-1" },
    })

    await waitFor(() => {
      expect(useResumeStore.getState().jobDescription).toBe("Loaded listing text")
    })
    expect(mockGetJobDescription).toHaveBeenCalledWith("job-1")
  })

  it("shows the action's error inline and leaves the textarea alone", async () => {
    mockGetJobDescription.mockResolvedValue({ error: "This job has no description saved." })

    render(<JobTargetPanel jobOptions={jobOptions} />)

    fireEvent.change(screen.getByLabelText("Load from saved job"), {
      target: { value: "job-1" },
    })

    await waitFor(() => {
      expect(screen.getByText("This job has no description saved.")).toBeTruthy()
    })
    expect(useResumeStore.getState().jobDescription).toBe("")
  })

  // The deep-link fetch itself now runs from `ResumeEditor` (always mounted,
  // covered in resume-editor.test.tsx) rather than this panel, because the
  // panel only mounts while the Job Target drawer is open. This panel's job
  // is just to preselect the picker from the id it's handed, with no fetch
  // of its own — that's what this test guards.
  it("preselects the saved-job picker from initialJobId without fetching", () => {
    render(<JobTargetPanel jobOptions={jobOptions} initialJobId="job-1" />)

    expect((screen.getByLabelText("Load from saved job") as HTMLSelectElement).value).toBe(
      "job-1"
    )
    expect(mockGetJobDescription).not.toHaveBeenCalled()
  })

  it("drops the card chrome in bare mode but keeps the same fields", () => {
    const { container } = render(<JobTargetPanel bare />)

    expect(container.querySelector(".rounded-lg.border")).toBeNull()
    expect(screen.getByLabelText("Job Description")).toBeTruthy()
  })

  // jsdom does not lay out, so the flex plumbing is asserted by class rather
  // than by measured height — the visual result is checked in the browser pass.
  it("lets the textarea absorb the leftover drawer height in bare mode", () => {
    const { container } = render(<JobTargetPanel bare />)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain("flex-col")

    const textarea = screen.getByLabelText("Job Description") as HTMLTextAreaElement
    expect(textarea.className).toContain("flex-1")
    expect(textarea.className).not.toContain("45vh")
  })

  it("keeps the fixed textarea sizing outside the drawer", () => {
    render(<JobTargetPanel />)

    const textarea = screen.getByLabelText("Job Description") as HTMLTextAreaElement
    expect(textarea.className).toContain("lg:min-h-[45vh]")
    expect(textarea.className).toContain("resize-y")
    expect(textarea.className).not.toContain("flex-1")
  })

  it("resets the picker to the placeholder when the textarea is edited by hand", async () => {
    render(<JobTargetPanel jobOptions={jobOptions} />)

    const select = screen.getByLabelText("Load from saved job") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "job-1" } })
    await waitFor(() => expect(select.value).toBe("job-1"))

    fireEvent.change(screen.getByLabelText("Job Description"), {
      target: { value: "Typed over it" },
    })

    expect(select.value).toBe("")
  })
})
