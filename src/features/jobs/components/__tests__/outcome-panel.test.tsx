import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { OUTCOME_FOCUS_KEY, OutcomePanel } from "../outcome-panel"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("../../actions/job-application.actions", () => ({
  saveJobApplicationOutcomeNote: vi.fn(),
}))

// jsdom does not implement scrollIntoView.
const scrollIntoView = vi.fn()

beforeEach(() => {
  scrollIntoView.mockClear()
  window.sessionStorage.clear()
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  })
})

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

function renderPanel() {
  return render(
    <OutcomePanel
      jobApplicationId="app-1"
      status="REJECTED"
      outcomeAt={null}
      outcomeNote={null}
    />
  )
}

describe("OutcomePanel", () => {
  it("scrolls to and focuses the note when the status move flagged it, then clears the flag", () => {
    window.sessionStorage.setItem(OUTCOME_FOCUS_KEY, "app-1")
    renderPanel()

    const textarea = screen.getByLabelText("Note (optional)")
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(textarea)
    expect(document.activeElement).toBe(textarea)
    expect(window.sessionStorage.getItem(OUTCOME_FOCUS_KEY)).toBeNull()
  })

  it("leaves focus and scroll alone on a plain load", () => {
    renderPanel()

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(
      screen.getByLabelText("Note (optional)")
    )
  })

  it("ignores a flag left for a different application", () => {
    window.sessionStorage.setItem(OUTCOME_FOCUS_KEY, "app-2")
    renderPanel()

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(OUTCOME_FOCUS_KEY)).toBe("app-2")
  })
})
