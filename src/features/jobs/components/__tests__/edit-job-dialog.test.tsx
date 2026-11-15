import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { EditJobDialog } from "../edit-job-dialog"
import type { JobFormApplication } from "../job-form-application"

const updateJobApplication = vi.fn()
const updateJobApplicationStatus = vi.fn()
const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: (...args: unknown[]) => refresh(...args) }),
}))

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock("../../actions/job-application.actions", () => ({
  updateJobApplication: (...args: unknown[]) => updateJobApplication(...args),
  updateJobApplicationStatus: (...args: unknown[]) =>
    updateJobApplicationStatus(...args),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

const application: JobFormApplication = {
  id: "app-1",
  companyName: "Yngen Datacom Corp.",
  jobTitle: "(WFH Setup) IT Network Help Desk",
  status: "INTERESTED",
  location: null,
  salary: null,
  salaryPeriod: null,
  salaryCurrency: "USD",
  dateApplied: null,
  deadline: null,
  interviewDate: null,
  followUpAt: null,
  jobLink: null,
  contact: null,
  jobDescription: null,
  notes: null,
  jobType: null,
  workType: null,
}

describe("EditJobDialog duplicate notice", () => {
  it("names the posting an edited link collides with and links to it", async () => {
    updateJobApplication.mockResolvedValue({
      error: "You already track this posting.",
      code: "DUPLICATE",
      existing: {
        jobId: "job-1",
        applicationId: "app-9",
        companyName: "Yngen Datacom Corp.",
        title: "(WFH Setup) IT Network Help Desk",
      },
    })

    render(<EditJobDialog application={application} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/job link/i), {
      target: { value: "https://ph.jobstreet.com/job/94508928" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("You already track this posting.")
    expect(alert.textContent).toContain(
      "(WFH Setup) IT Network Help Desk — Yngen Datacom Corp."
    )
    expect(
      screen.getByRole("link", { name: "Open existing" }).getAttribute("href")
    ).toBe("/jobs/app-9")
    // A refused edit stays open on the user's unsaved changes.
    expect(refresh).not.toHaveBeenCalled()
  })
})
