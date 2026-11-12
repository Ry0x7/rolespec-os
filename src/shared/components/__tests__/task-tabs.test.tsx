import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TaskTabs } from "../task-tabs"

const items = [{ id: "first", label: "First" }, { id: "second", label: "Second" }]
function fixture() {
  return render(<><a href="#deep">Open nested field</a><TaskTabs label="Tasks" items={items}><div id="first"><input aria-label="Draft" /></div><div id="second"><button id="deep">Deep action</button></div></TaskTabs></>)
}
beforeEach(() => {
  history.replaceState(null, "", "/")
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)
describe("TaskTabs", () => {
  it("shows one panel and preserves draft fields when switching", () => {
    fixture()
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Unsaved work" } })
    fireEvent.click(screen.getByRole("tab", { name: "Second" }))
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Deep action" })).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "First" }))
    expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("Unsaved work")
  })
  it("reveals deep links and supports keyboard activation and history", () => {
    fixture()
    fireEvent.click(screen.getByRole("link", { name: "Open nested field" }))
    expect(screen.getByRole("tab", { name: "Second" }).getAttribute("aria-selected")).toBe("true")
    fireEvent.keyDown(screen.getByRole("tab", { name: "Second" }), { key: "Home" })
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "First" }))
    history.replaceState(null, "", "#deep")
    fireEvent(window, new PopStateEvent("popstate"))
    expect(screen.getByRole("tab", { name: "Second" }).getAttribute("aria-selected")).toBe("true")
  })
  it("ignores malformed fragments without crashing", () => {
    history.replaceState(null, "", "#%E0%A4")
    fixture()
    expect(screen.getByRole("tab", { name: "First" }).getAttribute("aria-selected")).toBe("true")
  })
  it("cancels pending deep-link scrolling when the page unmounts", () => {
    history.replaceState(null, "", "#deep")
    const request = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(123)
    const cancel = vi.spyOn(window, "cancelAnimationFrame")
    const view = fixture()
    view.unmount()
    expect(cancel).toHaveBeenCalledWith(123)
    request.mockRestore()
    cancel.mockRestore()
  })
})
