import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

type ActionResult = { success: true } | { error: string }

const updateDesktopAutoCheck = vi.fn(
  async (input: { autoCheck: boolean }): Promise<ActionResult> => {
    void input
    return { success: true }
  }
)
const refresh = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock("../../actions/desktop-updates.actions", () => ({
  updateDesktopAutoCheck: (input: { autoCheck: boolean }) =>
    updateDesktopAutoCheck(input),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }))

const { DesktopUpdateSettings } = await import("../desktop-update-settings")

beforeEach(() => {
  updateDesktopAutoCheck.mockClear()
  refresh.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})
afterEach(cleanup)

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
})
