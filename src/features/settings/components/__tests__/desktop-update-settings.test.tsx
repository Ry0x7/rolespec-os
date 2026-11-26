import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

type ActionResult = { success: true } | { error: string }
type RequestResult = { id: string } | { error: string }
type StatusResult =
  | {
      status: {
        id: string
        state:
          | "checking"
          | "upToDate"
          | "available"
          | "downloading"
          | "installing"
          | "declined"
          | "error"
          | "unavailable"
          | "busy"
        currentVersion?: string
        version?: string
        progress?: number
        message?: string
        checkedAt?: string
      } | null
    }
  | { error: string }

const updateDesktopAutoCheck = vi.fn(
  async (input: { autoCheck: boolean }): Promise<ActionResult> => {
    void input
    return { success: true }
  }
)
const requestDesktopUpdateCheck = vi.fn(async (): Promise<RequestResult> => ({
  id: "req-1",
}))
const getDesktopUpdateStatus = vi.fn(async (): Promise<StatusResult> => ({
  status: null,
}))
const refresh = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock("../../actions/desktop-updates.actions", () => ({
  updateDesktopAutoCheck: (input: { autoCheck: boolean }) =>
    updateDesktopAutoCheck(input),
  requestDesktopUpdateCheck: () => requestDesktopUpdateCheck(),
  getDesktopUpdateStatus: () => getDesktopUpdateStatus(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }))

const { DesktopUpdateSettings } = await import("../desktop-update-settings")

beforeEach(() => {
  updateDesktopAutoCheck.mockClear()
  requestDesktopUpdateCheck.mockClear()
  getDesktopUpdateStatus.mockClear()
  requestDesktopUpdateCheck.mockResolvedValue({ id: "req-1" })
  getDesktopUpdateStatus.mockResolvedValue({ status: null })
  refresh.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("DesktopUpdateSettings", () => {
  it("shows the stored off state", () => {
    render(<DesktopUpdateSettings autoCheck={false} />)

    expect(
      screen
        .getByRole("switch", { name: "Check for updates automatically" })
        .getAttribute("aria-checked")
    ).toBe("false")
  })

  it("saves the flipped value and refreshes the page", async () => {
    render(<DesktopUpdateSettings autoCheck />)
    const toggle = screen.getByRole("switch", { name: "Check for updates automatically" })

    fireEvent.click(toggle)

    await waitFor(() =>
      expect(updateDesktopAutoCheck).toHaveBeenCalledWith({ autoCheck: false })
    )
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"))
    expect(toastSuccess).toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })

  it("keeps the current value and reports a save failure", async () => {
    updateDesktopAutoCheck.mockResolvedValueOnce({ error: "Could not save the update setting." })
    render(<DesktopUpdateSettings autoCheck />)
    const toggle = screen.getByRole("switch", { name: "Check for updates automatically" })

    fireEvent.click(toggle)

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not save the update setting.")
    )
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("requests an immediate check and reports the up-to-date result", async () => {
    vi.useFakeTimers()
    getDesktopUpdateStatus.mockResolvedValue({
      status: {
        id: "req-1",
        state: "upToDate",
        currentVersion: "2.1.0",
        checkedAt: "2026-11-26T00:00:00Z",
      },
    })
    render(<DesktopUpdateSettings autoCheck />)

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(requestDesktopUpdateCheck).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("status").textContent).toContain("Checking for updates")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(screen.getByRole("status").textContent).toContain(
      "You're on the latest version (2.1.0)."
    )
    expect(getDesktopUpdateStatus).toHaveBeenCalled()
  })

  it("shows download progress while installing", async () => {
    vi.useFakeTimers()
    getDesktopUpdateStatus.mockResolvedValue({
      status: {
        id: "req-1",
        state: "downloading",
        version: "2.1.1",
        progress: 42,
        checkedAt: "2026-11-26T00:00:00Z",
      },
    })
    render(<DesktopUpdateSettings autoCheck />)

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(screen.getByRole("status").textContent).toContain("42%")
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42")
  })

  it("reports a request failure without polling", async () => {
    requestDesktopUpdateCheck.mockResolvedValueOnce({
      error: "Could not start an update check.",
    })
    render(<DesktopUpdateSettings autoCheck />)

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not start an update check.")
    )
    expect(getDesktopUpdateStatus).not.toHaveBeenCalled()
  })
})
