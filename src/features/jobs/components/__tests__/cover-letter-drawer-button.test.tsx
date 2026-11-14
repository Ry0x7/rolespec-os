import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { mockGenerate, mockPush, mockRefresh, mockToastSuccess } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))
vi.mock("sonner", () => ({ toast: { success: mockToastSuccess, error: vi.fn() } }))
vi.mock("../../actions/cover-letter.actions", () => ({
  generateCoverLetter: mockGenerate,
}))

import { CoverLetterDrawerButton } from "../cover-letter-drawer-button"

const resumes = [
  { id: "r-tailored", title: "Rose Eden", atsScore: null },
  { id: "r-master", title: "Full-Stack Developer Resume", atsScore: 72 },
]

const application = {
  id: "app-1",
  companyName: "Rose Eden LLC",
  jobTitle: "Web Developer",
  hasJobDescription: true,
}

function renderButton() {
  return render(
    <CoverLetterDrawerButton
      resumes={resumes}
      application={application}
      defaultResumeId="r-tailored"
      resumeHint="Recommended: Rose Eden · Tailored for this job"
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe("cover letter drawer button", () => {
  it("opens the drawer with the job named and the resume preselected", () => {
    renderButton()

    // Closed to start with: the form is not mounted at all.
    expect(screen.queryByLabelText("Resume")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /New cover letter/i }))

    expect(
      screen.getByText("New cover letter — Web Developer at Rose Eden LLC"),
    ).toBeTruthy()
    expect((screen.getByLabelText("Resume") as HTMLSelectElement).value).toBe(
      "r-tailored",
    )
    expect(
      screen.getByText("Recommended: Rose Eden · Tailored for this job"),
    ).toBeTruthy()
    // The stored job description is used, so nothing is asked for again.
    expect(screen.getByText("Using the job description saved on this application.")).toBeTruthy()
    // The header names the job once: no card title, no second "Cover letter for:".
    expect(screen.queryByText(/Cover letter for:/)).toBeNull()
    expect(screen.getAllByText("Generate Cover Letter")).toHaveLength(1)
  })

  it("closes, refreshes and offers the new letter on success", async () => {
    mockGenerate.mockResolvedValue({ id: "cl-new" })
    const { container } = renderButton()

    fireEvent.click(screen.getByRole("button", { name: /New cover letter/i }))
    fireEvent.submit(container.ownerDocument.querySelector("form")!)

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled())

    // The action is told not to navigate, and the locked id rides along.
    expect(mockGenerate).toHaveBeenCalledWith(expect.any(FormData), {
      redirect: false,
    })
    expect(
      (mockGenerate.mock.calls[0][0] as FormData).get("jobApplicationId"),
    ).toBe("app-1")

    expect(mockToastSuccess).toHaveBeenCalledWith("Cover letter created", {
      action: { label: "Open", onClick: expect.any(Function) },
    })
    const options = mockToastSuccess.mock.calls[0][1] as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    expect(mockPush).toHaveBeenCalledWith("/jobs/cover-letter/cl-new")

    expect(mockRefresh).toHaveBeenCalled()
    // Drawer closed: the form is unmounted again.
    await waitFor(() => expect(screen.queryByLabelText("Resume")).toBeNull())
  })

  it("keeps the drawer open and shows the error when generation fails", async () => {
    mockGenerate.mockResolvedValue({ error: "Resume not found" })
    const { container } = renderButton()

    fireEvent.click(screen.getByRole("button", { name: /New cover letter/i }))
    fireEvent.submit(container.ownerDocument.querySelector("form")!)

    await waitFor(() => expect(screen.getByText("Resume not found")).toBeTruthy())
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Resume")).toBeTruthy()
  })
})
