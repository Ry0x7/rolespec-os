import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { localCalendarDateString } from "@/shared/lib/dates"
import { FollowUpActions, LastFollowUpNote } from "../follow-up-actions"

const clearJobApplicationFollowUp = vi.fn()
const snoozeJobApplicationFollowUp = vi.fn()
const refresh = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
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
  clearJobApplicationFollowUp: (...args: unknown[]) =>
    clearJobApplicationFollowUp(...args),
  snoozeJobApplicationFollowUp: (...args: unknown[]) =>
    snoozeJobApplicationFollowUp(...args),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("FollowUpActions", () => {
  it("snoozes the follow-up by a week from the client's day", async () => {
    snoozeJobApplicationFollowUp.mockResolvedValue({ success: true })
    render(<FollowUpActions jobApplicationId="app-1" />)

    fireEvent.click(
      screen.getByRole("button", { name: "Snooze the follow-up by 1 week" })
    )

    await waitFor(() =>
      expect(snoozeJobApplicationFollowUp).toHaveBeenCalledWith(
        "app-1",
        localCalendarDateString()
      )
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Follow-up snoozed for a week")
    expect(clearJobApplicationFollowUp).not.toHaveBeenCalled()
  })

  it("reports a failed snooze and does not refresh", async () => {
    snoozeJobApplicationFollowUp.mockResolvedValue({ error: "Not found" })
    render(<FollowUpActions jobApplicationId="app-1" />)

    fireEvent.click(
      screen.getByRole("button", { name: "Snooze the follow-up by 1 week" })
    )

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not found"))
    expect(refresh).not.toHaveBeenCalled()
  })

  it("still clears the follow-up with Done", async () => {
    clearJobApplicationFollowUp.mockResolvedValue({ success: true })
    render(<FollowUpActions jobApplicationId="app-1" />)

    fireEvent.click(
      screen.getByRole("button", { name: "Mark the follow-up as done" })
    )

    await waitFor(() =>
      expect(clearJobApplicationFollowUp).toHaveBeenCalledWith("app-1")
    )
    expect(toastSuccess).toHaveBeenCalledWith("Follow-up logged")
    expect(snoozeJobApplicationFollowUp).not.toHaveBeenCalled()
  })
})

describe("LastFollowUpNote", () => {
  const today = new Date("2026-09-14T00:00:00.000Z")

  it.each([
    ["2026-09-14T10:00:00.000Z", "Followed up today"],
    ["2026-09-13T23:30:00.000Z", "Followed up 1 day ago"],
    ["2026-09-09T08:00:00.000Z", "Followed up 5 days ago"],
  ])("reads %s as %s against the day passed in", (at, text) => {
    render(<LastFollowUpNote lastFollowedUpAt={new Date(at)} today={today} />)

    expect(screen.getByText(text)).toBeTruthy()
  })
})
