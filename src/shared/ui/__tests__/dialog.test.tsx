import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "../dialog"

afterEach(cleanup)

/** A trigger plus a dialog with three focusables, so the trap has edges. */
function Harness({ showCloseButton = false }: { showCloseButton?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        showCloseButton={showCloseButton}
        aria-label="Test dialog"
      >
        <DialogHeader>
          <h2>Title</h2>
        </DialogHeader>
        <DialogBody>
          <input aria-label="First" />
          <input aria-label="Second" />
        </DialogBody>
        <DialogFooter>
          <button type="button">Done</button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

describe("Dialog", () => {
  it("renders nothing while closed and portals to document.body when open", () => {
    const { container } = render(<Harness />)
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Open" }))

    const dialog = screen.getByRole("dialog")
    expect(dialog).not.toBeNull()
    // Portalled: it is not inside the component's own container.
    expect(container.contains(dialog)).toBe(false)
    expect(document.body.contains(dialog)).toBe(true)
  })

  it("focuses the first focusable on open and restores focus on close", () => {
    render(<Harness />)
    const trigger = screen.getByRole("button", { name: "Open" })
    trigger.focus()

    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByLabelText("First"))

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("keeps Tab and Shift+Tab inside the panel", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Open" }))

    const first = screen.getByLabelText("First")
    const done = screen.getByRole("button", { name: "Done" })

    // Forward off the last focusable wraps to the first.
    done.focus()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(first)

    // Backward off the first wraps to the last.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(done)
  })

  it("locks body scroll while open and restores it on close", () => {
    render(<Harness />)
    expect(document.body.style.overflow).toBe("")

    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    expect(document.body.style.overflow).toBe("hidden")
    expect(document.documentElement.style.overflow).toBe("hidden")

    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.body.style.overflow).toBe("")
    expect(document.documentElement.style.overflow).toBe("")
  })

  it("closes from the X button, which is opt-out", () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open onClose={onClose} aria-label="X test">
        <p>Body</p>
      </Dialog>
    )
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(
      <Dialog open onClose={onClose} showCloseButton={false} aria-label="X test">
        <p>Body</p>
      </Dialog>
    )
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("only the body scrolls: the footer sits outside the scroll container", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Open" }))

    const panel = screen.getByRole("dialog")
    const scroller = panel.querySelector(".overflow-y-auto")
    expect(scroller).not.toBeNull()
    const done = screen.getByRole("button", { name: "Done" })
    expect(scroller!.contains(done)).toBe(false)
    expect(panel.contains(done)).toBe(true)
  })
})
