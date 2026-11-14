import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CreateJobDialog } from "../create-job-dialog"

const createJobApplication = vi.fn()
const updateJobApplicationStatus = vi.fn()
const push = vi.fn()
const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => push(...args),
    refresh: (...args: unknown[]) => refresh(...args),
  }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("../../actions/job-application.actions", () => ({
  createJobApplication: (...args: unknown[]) => createJobApplication(...args),
  updateJobApplicationStatus: (...args: unknown[]) =>
    updateJobApplicationStatus(...args),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

/** Opens the dialog and fills the two required fields. */
function openAndFill() {
  render(<CreateJobDialog />)
  fireEvent.click(screen.getByRole("button", { name: "Add application" }))
  fireEvent.change(screen.getByLabelText(/company/i), {
    target: { value: "Yngen Datacom Corp." },
  })
  fireEvent.change(screen.getByLabelText(/job title/i), {
    target: { value: "IT Network Help Desk" },
  })
}

describe("CreateJobDialog duplicate notice", () => {
  it("shows the existing posting and a link to it when the URL already exists", async () => {
    createJobApplication.mockResolvedValue({
      error: "You already track this posting.",
      code: "DUPLICATE",
      existing: {
        jobId: "job-1",
        applicationId: "app-9",
        companyName: "Yngen Datacom Corp.",
        title: "IT Network Help Desk",
      },
    })

    openAndFill()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("You already track this posting.")
    expect(
      screen.getByRole("link", { name: "Open existing" }).getAttribute("href")
    ).toBe("/jobs/app-9")
    // A hard duplicate cannot be overruled: the unique key would reject it.
    expect(screen.queryByRole("button", { name: "Add anyway" })).toBeNull()
  })

  it("offers Add anyway for a name-only match and forces the retry", async () => {
    createJobApplication.mockResolvedValueOnce({
      error: "You may already track this application at the same company.",
      code: "POSSIBLE_DUPLICATE",
      existing: {
        jobId: "job-2",
        applicationId: "app-8",
        companyName: "Yngen Datacom Corp.",
        title: "IT Network Help Desk",
      },
    })
    createJobApplication.mockResolvedValueOnce({ success: true, id: "app-10" })

    openAndFill()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect((await screen.findByRole("alert")).textContent).toContain(
      "You may already track this application at the same company."
    )
    expect(createJobApplication.mock.calls[0][1]).toEqual({ force: false })

    fireEvent.click(screen.getByRole("button", { name: "Add anyway" }))

    await waitFor(() => expect(createJobApplication).toHaveBeenCalledTimes(2))
    expect(createJobApplication.mock.calls[1][1]).toEqual({ force: true })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("renders a plain error unchanged", async () => {
    createJobApplication.mockResolvedValue({ error: "Something went wrong." })

    openAndFill()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Something went wrong.")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
