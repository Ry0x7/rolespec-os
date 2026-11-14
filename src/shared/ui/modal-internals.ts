/**
 * Shared mechanics behind every portalled modal shell (`Dialog`, `Drawer`).
 * Kept dependency-free of JSX on purpose: both consumers own their own markup,
 * this module owns only the DOM/focus/scroll bookkeeping neither should
 * duplicate.
 */
import { useEffect, type RefObject } from "react"

/**
 * Anything that can hold focus. `offsetParent` is deliberately not consulted —
 * it is always null under jsdom, which would empty the trap in tests.
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",")

export function focusableWithin(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(
    (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true"
  )
}

/** The store never changes; only its server vs client snapshot differs. */
export const subscribeToNothing = () => () => {}

/**
 * Nested modals (a Dialog opened over a Drawer, or vice versa) share one lock:
 * only the first one to open stores the previous overflow, only the last one
 * to close puts it back. Module-level on purpose — Dialog and Drawer must
 * share the SAME counter, not one each.
 */
let scrollLockCount = 0
let previousOverflow: { html: string; body: string } | null = null

export function lockBodyScroll() {
  scrollLockCount += 1
  if (scrollLockCount > 1) return
  previousOverflow = {
    html: document.documentElement.style.overflow,
    body: document.body.style.overflow,
  }
  document.documentElement.style.overflow = "hidden"
  document.body.style.overflow = "hidden"
}

export function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount > 0 || !previousOverflow) return
  document.documentElement.style.overflow = previousOverflow.html
  document.body.style.overflow = previousOverflow.body
  previousOverflow = null
}

/**
 * Every open modal listens on `document`, so without an owner the innermost
 * and outermost both react to the same key: Escape over a Dialog nested inside
 * a Drawer (the ATS view sits inside the ATS inspector) closed BOTH, and their
 * Tab traps fought over focus, each yanking it back out of the other. Only the
 * top of this stack acts. Module-level for the same reason the scroll lock is:
 * Dialog and Drawer must share ONE stack, not one each.
 */
const modalStack: object[] = []

/** Escape to close, Tab/Shift+Tab kept inside the panel. Identical for every modal shell. */
export function useModalKeydownTrap(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return
    // Identity for this particular open modal — the stack holds tokens rather
    // than refs so two modals sharing a panel ref could still be told apart.
    const token = {}
    modalStack.push(token)

    function onKey(e: KeyboardEvent) {
      // Nested modals: defer to whichever opened last.
      if (modalStack[modalStack.length - 1] !== token) return
      if (e.key === "Escape") {
        onClose()
        return
      }
      if (e.key !== "Tab") return
      const panel = panelRef.current
      if (!panel) return
      const items = focusableWithin(panel)
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (!active || !panel.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      const index = modalStack.lastIndexOf(token)
      if (index !== -1) modalStack.splice(index, 1)
    }
  }, [open, onClose, panelRef])
}

/**
 * Scroll lock + focus in / focus back out. `mounted` is in the deps because
 * the panel only exists in the DOM once the portal has rendered.
 */
export function useModalScrollLockAndFocus(
  open: boolean,
  mounted: boolean,
  panelRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open || !mounted) return
    lockBodyScroll()
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    if (panel) {
      const items = focusableWithin(panel)
      ;(items[0] ?? panel).focus()
    }
    return () => {
      unlockBodyScroll()
      previouslyFocused?.focus?.()
    }
  }, [open, mounted, panelRef])
}
