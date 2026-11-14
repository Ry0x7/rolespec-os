import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { mockSelect, mockRefresh, mockToast } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockRefresh: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("sonner", () => ({ toast: mockToast }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))
vi.mock("../../actions/job-application.actions", () => ({
  selectJobApplicationResume: mockSelect,
}))

import { JobResumePanel, type JobResumeOption } from "../job-resume-panel"

const options: JobResumeOption[] = [
  { id: "master", title: "Master Resume", variant: "MASTER", forThisJob: false },
  {
    id: "other-tailored",
    title: "Globex Resume",
    variant: "JOB_TAILORED",
    forThisJob: false,
  },
  {
    id: "family",
    title: "Platform Resume",
    variant: "ROLE_FAMILY",
    forThisJob: false,
  },
  {
    id: "this-tailored",
    title: "Acme Resume",
    variant: "JOB_TAILORED",
    forThisJob: true,
  },
]

function renderPanel(props: Partial<Parameters<typeof JobResumePanel>[0]> = {}) {
  return render(
    <JobResumePanel
      jobApplicationId="job-1"
      selectedResumeId={null}
      resumeOptions={options}
      recommendation={null}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSelect.mockResolvedValue({ success: true })
})

afterEach(cleanup)

describe("job resume panel", () => {
  it("names the tier of every option", () => {
    renderPanel()

    const labels = Array.from(
      screen.getByLabelText("Or pick another").querySelectorAll("option"),
    ).map((option) => option.textContent)

    expect(labels).toContain("Acme Resume · Tailored for this job")
    expect(labels).toContain("Platform Resume · Role family")
    expect(labels).toContain("Master Resume · Master")
    expect(labels).toContain("Globex Resume · Tailored (other job)")
  })

  it("orders the options tailored-for-this-job, role family, master, then others", () => {
    renderPanel()

    const values = Array.from(
      screen.getByLabelText("Or pick another").querySelectorAll("option"),
    ).map((option) => (option as HTMLOptionElement).value)

    expect(values).toEqual([
      "",
      "this-tailored",
      "family",
      "master",
      "other-tailored",
    ])
  })

  it("persists a pick and keeps the tier label on the chosen option", async () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText("Or pick another"), {
      target: { value: "family" },
    })

    await waitFor(() =>
      expect(mockSelect).toHaveBeenCalledWith("job-1", "family"),
    )
    // The plain title is what the sentence above the picker reads.
    expect(screen.getByText("Platform Resume")).toBeTruthy()
    expect(
      (screen.getByLabelText("Change resume") as HTMLSelectElement).value,
    ).toBe("family")
  })

  it("reads the recommendation reason without repeating the tier word", () => {
    renderPanel({
      recommendation: { resumeId: "family", reason: "Matches role family" },
    })

    expect(
      screen.getByText(/Matches role family/, { selector: "p" }),
    ).toBeTruthy()
  })

  it("displays the recommendation as the picker's value and flags it as unsaved", () => {
    renderPanel({
      recommendation: { resumeId: "this-tailored", reason: "Tailored for this job" },
    })

    const select = screen.getByLabelText(
      "Or pick another (recommended, not saved)",
    ) as HTMLSelectElement
    // The effective resume — what Resume Match and the email already use.
    expect(select.value).toBe("this-tailored")
    expect(
      select.options[select.selectedIndex].textContent,
    ).toBe("Acme Resume · Tailored for this job")
    expect(screen.getByRole("button", { name: "Use recommended" })).toBeTruthy()
  })

  it("drops the unsaved hint once a choice is persisted", () => {
    renderPanel({
      selectedResumeId: "family",
      recommendation: { resumeId: "this-tailored", reason: "Tailored for this job" },
    })

    const select = screen.getByLabelText("Change resume") as HTMLSelectElement
    expect(select.value).toBe("family")
    expect(screen.queryByText(/recommended, not saved/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Use recommended" })).toBeNull()
  })

  it("persists the recommendation from the picker and clears the unsaved hint", async () => {
    renderPanel({
      recommendation: { resumeId: "this-tailored", reason: "Tailored for this job" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Use recommended" }))

    await waitFor(() =>
      expect(mockSelect).toHaveBeenCalledWith("job-1", "this-tailored"),
    )
    expect(screen.queryByText(/recommended, not saved/)).toBeNull()
    expect(
      (screen.getByLabelText("Change resume") as HTMLSelectElement).value,
    ).toBe("this-tailored")
  })

  it("shows the saved state once a refresh brings in a choice saved elsewhere", () => {
    const recommendation = {
      resumeId: "this-tailored",
      reason: "Tailored for this job",
    }
    const { rerender } = renderPanel({ recommendation })
    expect(screen.getByText(/recommended, not saved/)).toBeTruthy()

    // What `router.refresh()` does after Mark applied commits the recommendation.
    rerender(
      <JobResumePanel
        jobApplicationId="job-1"
        selectedResumeId="this-tailored"
        resumeOptions={options}
        recommendation={recommendation}
      />,
    )

    expect(screen.getByText(/Applying with/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Acme Resume" })).toBeTruthy()
    expect(screen.queryByText(/recommended, not saved/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Use recommended" })).toBeNull()
    expect(
      (screen.getByLabelText("Change resume") as HTMLSelectElement).value,
    ).toBe("this-tailored")
  })

  it("offers the empty state when there are no resumes at all", () => {
    renderPanel({ resumeOptions: [] })

    expect(screen.getByText("No resume to send")).toBeTruthy()
  })

  it("opens the chosen resume with this job carried as ?jobId=", () => {
    renderPanel({ selectedResumeId: "master" })

    expect(
      screen.getByRole("link", { name: "Master Resume" }).getAttribute("href"),
    ).toBe("/resumes/master?jobId=job-1")
  })

  it("sends the empty state to /resumes with this job ready to tailor", () => {
    renderPanel({ resumeOptions: [] })

    expect(
      screen.getByRole("link", { name: "Go to resumes" }).getAttribute("href"),
    ).toBe("/resumes?tailorJobId=job-1")
  })
})
