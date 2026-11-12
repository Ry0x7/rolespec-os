import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { CommandPalette } from "../command-palette"

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push }) }))
afterEach(() => { cleanup(); push.mockReset(); localStorage.clear() })

describe("workspace command palette", () => {
  it("opens from the initial trigger and navigates the new real destinations", () => {
    render(<CommandPalette openToken={1} />)
    expect(screen.getByRole("dialog", { name: "Quick actions" })).toBeTruthy()
    const search = screen.getByRole("combobox", { name: "Search quick actions" })
    fireEvent.change(search, { target: { value: "pending decisions" } })
    fireEvent.keyDown(search, { key: "Enter" })
    expect(push).toHaveBeenCalledWith("/review")
    expect(screen.queryByRole("dialog")).toBeNull()
  })
  it("supports first-use Ctrl K, traps focus and returns it on Escape", () => {
    const trigger = document.createElement("button")
    document.body.append(trigger); trigger.focus()
    render(<CommandPalette />)
    fireEvent.keyDown(document, { key: "k", ctrlKey: true })
    const search = screen.getByRole("combobox")
    const help = screen.getByRole("button", { name: "Press ? for all shortcuts" })
    help.focus(); fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(search)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
  it("opens shortcut help without requiring a previous search hover", () => {
    render(<CommandPalette />)
    fireEvent.keyDown(document, { key: "?" })
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy()
  })
})
