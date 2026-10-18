import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { localCalendarDateString } from "@/shared/lib/dates"
import { JobDetailActions } from "../job-detail-actions"
import { OUTCOME_FOCUS_KEY } from "../outcome-panel"
import type { JobFormApplication } from "../job-form-application"

const deleteJobApplication = vi.fn()
const updateJobApplication = vi.fn()
const updateJobApplicationStatus = vi.fn()
const selectJobApplicationResume = vi.fn()
const push = vi.fn()
const refresh = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => push(...args),
    refresh: (...args: unknown[]) => refresh(...args),
  }),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

vi.mock("../../actions/job-application.actions", () => ({
  updateJobApplication: (...args: unknown[]) => updateJobApplication(...args),
  updateJobApplicationStatus: (...args: unknown[]) =>
    updateJobApplicationStatus(...args),
  deleteJobApplication: (...args: unknown[]) => deleteJobApplication(...args),
  selectJobApplicationResume: (...args: unknown[]) =>
    selectJobApplicationResume(...args),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  deleteJobApplication.mockResolvedValue({ success: true })
})

const application: JobFormApplication = {
  id: "app-1",
  companyName: "Globex",
  jobTitle: "Staff Engineer",
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

describe("JobDetailActions", () => {
  it("opens the edit dialog", () => {
    render(<JobDetailActions application={application} />)

    fireEvent.click(screen.getByRole("button", { name: "Edit Globex" }))

    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>("Company").value).toBe("Globex")
  })

  it("confirms with the shared copy and navigates to /jobs after delete", async () => {
    render(<JobDetailActions application={application} />)

    fireEvent.click(screen.getByRole("button", { name: "Delete Globex" }))
    expect(
      screen.getByText(
        /Delete Globex\? Linked cover letters will be unlinked, not deleted\./
      )
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(deleteJobApplication).toHaveBeenCalledWith("app-1"))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/jobs"))
    expect(toastSuccess).toHaveBeenCalledWith("Application deleted")
  })

  it("marks an INTERESTED application applied and refreshes", async () => {
    updateJobApplicationStatus.mockResolvedValue({ success: true })
    render(<JobDetailActions application={application} />)

    fireEvent.click(
      screen.getByRole("button", { name: "Mark Globex as applied" })
    )

    await waitFor(() =>
      // The third argument is the browser's own calendar day: the server cannot
      // work out which day "today" is for this user on its own.
      expect(updateJobApplicationStatus).toHaveBeenCalledWith(
        "app-1",
        "APPLIED",
        localCalendarDateString()
      )
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Marked as applied")
  })

  it("commits the unsaved recommended resume before marking applied", async () => {
    const calls: string[] = []
    selectJobApplicationResume.mockImplementation(async () => {
      calls.push("select")
      return { success: true }
    })
    updateJobApplicationStatus.mockImplementation(async () => {
      calls.push("status")
      return { success: true }
    })
    render(
      <JobDetailActions
        application={application}
        savedResumeId={null}
        effectiveResumeId="resume-rec"
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Mark Globex as applied" })
    )

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(selectJobApplicationResume).toHaveBeenCalledWith("app-1", "resume-rec")
    expect(updateJobApplicationStatus).toHaveBeenCalledWith(
      "app-1",
      "APPLIED",
      localCalendarDateString()
    )
    expect(calls).toEqual(["select", "status"])
    expect(toastSuccess).toHaveBeenCalledWith("Marked as applied")
  })

  it("only moves the status when a resume is already saved", async () => {
    updateJobApplicationStatus.mockResolvedValue({ success: true })
    render(
      <JobDetailActions
        application={application}
        savedResumeId="resume-saved"
        effectiveResumeId="resume-saved"
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Mark Globex as applied" })
    )

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(selectJobApplicationResume).not.toHaveBeenCalled()
    expect(updateJobApplicationStatus).toHaveBeenCalledTimes(1)
  })

  it("does not mark applied when committing the recommended resume fails", async () => {
    selectJobApplicationResume.mockResolvedValue({ error: "Resume not found" })
    updateJobApplicationStatus.mockResolvedValue({ success: true })
    render(
      <JobDetailActions
        application={application}
        savedResumeId={null}
        effectiveResumeId="resume-rec"
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Mark Globex as applied" })
    )

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Resume not found")
    )
    expect(updateJobApplicationStatus).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("flags the outcome note for focus after a terminal pick, not after an in-flight one", async () => {
    window.sessionStorage.clear()
    updateJobApplicationStatus.mockResolvedValue({ success: true })
    const { unmount } = render(
      <JobDetailActions application={{ ...application, status: "APPLIED" }} />
    )

    fireEvent.change(screen.getByLabelText("Status for Globex"), {
      target: { value: "SCREENING" },
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(window.sessionStorage.getItem(OUTCOME_FOCUS_KEY)).toBeNull()
    unmount()

    render(
      <JobDetailActions application={{ ...application, status: "INTERVIEW" }} />
    )
    fireEvent.change(screen.getByLabelText("Status for Globex"), {
      target: { value: "WITHDRAWN" },
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(window.sessionStorage.getItem(OUTCOME_FOCUS_KEY)).toBe("app-1")
    window.sessionStorage.clear()
  })

  it("surfaces the error and does not refresh when the transition fails", async () => {
    updateJobApplicationStatus.mockResolvedValue({ error: "Not found" })
    render(<JobDetailActions application={application} />)

    fireEvent.click(
      screen.getByRole("button", { name: "Mark Globex as applied" })
    )

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not found"))
    expect(refresh).not.toHaveBeenCalled()
  })

  it("hides Mark applied once the application has moved past INTERESTED", () => {
    render(
      <JobDetailActions application={{ ...application, status: "APPLIED" }} />
    )

    expect(screen.queryByText("Mark applied")).toBeNull()
  })

  it("offers no inline status select while the application is still INTERESTED", () => {
    render(<JobDetailActions application={application} />)

    expect(screen.queryByLabelText("Status for Globex")).toBeNull()
  })

  it("advances an in-flight application from the inline select with the client's day", async () => {
    updateJobApplicationStatus.mockResolvedValue({ success: true })
    render(
      <JobDetailActions application={{ ...application, status: "APPLIED" }} />
    )

    const select = screen.getByLabelText<HTMLSelectElement>("Status for Globex")
    expect(select.value).toBe("APPLIED")
    fireEvent.change(select, { target: { value: "SCREENING" } })

    await waitFor(() =>
      expect(updateJobApplicationStatus).toHaveBeenCalledWith(
        "app-1",
        "SCREENING",
        localCalendarDateString()
      )
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Moved to Screening")
  })

  it("sends a terminal pick through the same action, which stamps the outcome", async () => {
    updateJobApplicationStatus.mockResolvedValue({ success: true })
    render(
      <JobDetailActions application={{ ...application, status: "INTERVIEW" }} />
    )

    fireEvent.change(screen.getByLabelText("Status for Globex"), {
      target: { value: "REJECTED" },
    })

    await waitFor(() =>
      expect(updateJobApplicationStatus).toHaveBeenCalledWith(
        "app-1",
        "REJECTED",
        localCalendarDateString()
      )
    )
    expect(toastSuccess).toHaveBeenCalledWith("Moved to Rejected")
  })

  it("never offers a move back to INTERESTED, and keeps Edit and Delete", () => {
    render(
      <JobDetailActions application={{ ...application, status: "SCREENING" }} />
    )

    const options = Array.from(
      screen.getByLabelText<HTMLSelectElement>("Status for Globex").options
    ).map((option) => option.value)
    expect(options).toEqual([
      "APPLIED",
      "SCREENING",
      "INTERVIEW",
      "OFFER",
      "REJECTED",
      "WITHDRAWN",
    ])
    expect(screen.getByRole("button", { name: "Edit Globex" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete Globex" })).toBeTruthy()
  })

  it("reports the error and does not refresh when the inline move fails", async () => {
    updateJobApplicationStatus.mockResolvedValue({ error: "Not found" })
    render(
      <JobDetailActions application={{ ...application, status: "APPLIED" }} />
    )

    fireEvent.change(screen.getByLabelText("Status for Globex"), {
      target: { value: "OFFER" },
    })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not found"))
    expect(refresh).not.toHaveBeenCalled()
  })

  it("keeps the user on the page when the delete fails", async () => {
    deleteJobApplication.mockResolvedValue({ error: "Not found" })
    render(<JobDetailActions application={application} />)

    fireEvent.click(screen.getByRole("button", { name: "Delete Globex" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not found"))
    expect(push).not.toHaveBeenCalled()
  })
})
