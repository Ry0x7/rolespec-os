import { describe, it, expect, afterEach, beforeAll, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from "../drawer"
import { Dialog } from "../dialog"

// jsdom ships no `matchMedia`, which framer-motion's `useReducedMotion` needs.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

afterEach(cleanup)

/** A trigger plus a drawer with three focusables, so the trap has edges. */
function Harness({ showCloseButton = false }: { showCloseButton?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        showCloseButton={showCloseButton}
        aria-label="Test drawer"
      >
        <DrawerHeader>
          <h2>Title</h2>
        </DrawerHeader>
        <DrawerBody>
          <input aria-label="First" />
          <input aria-label="Second" />
        </DrawerBody>
        <DrawerFooter>
          <button type="button">Done</button>
        </DrawerFooter>
      </Drawer>
    </div>
  )
}

describe("Drawer", () => {
  it("renders nothing while closed and portals to document.body when open", () => {
    const { container } = render(<Harness />)
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Open" }))

    const drawer = screen.getByRole("dialog")
    expect(drawer).not.toBeNull()
    // Portalled: it is not inside the component's own container.
    expect(container.contains(drawer)).toBe(false)
    expect(document.body.contains(drawer)).toBe(true)
  })

  it("closes on Escape", () => {
    const onClose = vi.fn()
    render(
      <Drawer open onClose={onClose} aria-label="Escape test">
        <input aria-label="Only" />
      </Drawer>
    )
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes on backdrop click", () => {
    const onClose = vi.fn()
    const { container } = render(
      <Drawer open onClose={onClose} aria-label="Backdrop test">
        <input aria-label="Only" />
      </Drawer>
    )
    void container
    const backdrop = document.querySelector(".bg-black\\/70") as HTMLElement
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes from the X button, which is opt-out", () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Drawer open onClose={onClose} aria-label="X test">
        <p>Body</p>
      </Drawer>
    )
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(
      <Drawer open onClose={onClose} showCloseButton={false} aria-label="X test">
        <p>Body</p>
      </Drawer>
    )
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("focuses the first focusable on open and restores focus on close", () => {
    render(<Harness />)
    const trigger = screen.getByRole("button", { name: "Open" })
    trigger.focus()

    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByLabelText("First"))

    fireEvent.keyDown(document, { key: "Escape" })
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

  it("locks body scroll while open and releases it on close, sharing the counter with a nested Dialog", () => {
    function Nested() {
      const [drawerOpen, setDrawerOpen] = useState(false)
      const [dialogOpen, setDialogOpen] = useState(false)
      return (
        <div>
          <button type="button" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </button>
          <button type="button" onClick={() => setDialogOpen(true)}>
            Open dialog
          </button>
          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            showCloseButton={false}
            aria-label="Outer"
          >
            <input aria-label="Drawer input" />
          </Drawer>
          <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} aria-label="Inner">
            <input aria-label="Dialog input" />
          </Dialog>
        </div>
      )
    }

    render(<Nested />)
    expect(document.body.style.overflow).toBe("")

    // Drawer opens first: locks.
    fireEvent.click(screen.getByRole("button", { name: "Open drawer" }))
    expect(document.body.style.overflow).toBe("hidden")

    // Dialog opens over it: still locked, second holder of the shared counter.
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }))
    expect(document.body.style.overflow).toBe("hidden")

    // Dialog closes via its own close button: drawer is still open, so the
    // lock must not release yet.
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(document.body.style.overflow).toBe("hidden")

    // Drawer closes: last holder releases the lock.
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.body.style.overflow).toBe("")
  })

  it("Escape closes only the innermost modal, not the shell underneath it", () => {
    // The regression this pins: every open modal listens on `document`, so
    // before the stack was added one Escape ran both handlers and the ATS view
    // dialog took the ATS inspector down with it.
    const onDrawerClose = vi.fn()
    const onDialogClose = vi.fn()

    render(
      <div>
        <Drawer open onClose={onDrawerClose} showCloseButton={false} aria-label="Outer">
          <input aria-label="Drawer input" />
        </Drawer>
        <Dialog open onClose={onDialogClose} showCloseButton={false} aria-label="Inner">
          <input aria-label="Dialog input" />
        </Dialog>
      </div>
    )

    fireEvent.keyDown(document, { key: "Escape" })

    expect(onDialogClose).toHaveBeenCalledTimes(1)
    expect(onDrawerClose).not.toHaveBeenCalled()
  })

  it("hands Escape back to the outer shell once the inner one has closed", () => {
    function Nested() {
      const [dialogOpen, setDialogOpen] = useState(true)
      return (
        <div>
          <Drawer open onClose={onDrawerClose} showCloseButton={false} aria-label="Outer">
            <input aria-label="Drawer input" />
          </Drawer>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            showCloseButton={false}
            aria-label="Inner"
          >
            <input aria-label="Dialog input" />
          </Dialog>
        </div>
      )
    }
    const onDrawerClose = vi.fn()

    render(<Nested />)

    // Closes the dialog only, which pops it off the stack…
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onDrawerClose).not.toHaveBeenCalled()

    // …so the drawer is top-most again and the next Escape reaches it.
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onDrawerClose).toHaveBeenCalledTimes(1)
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
