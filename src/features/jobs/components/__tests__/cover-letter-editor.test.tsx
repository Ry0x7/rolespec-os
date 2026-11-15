import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CoverLetterEditor, type CoverLetterDetail } from "../cover-letter-editor"

const updateCoverLetterContent = vi.fn()
const improveCoverLetter = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()
const routerPush = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

vi.mock("../../actions/cover-letter.actions", () => ({
  updateCoverLetterContent: (...args: unknown[]) =>
    updateCoverLetterContent(...args),
  improveCoverLetter: (...args: unknown[]) => improveCoverLetter(...args),
}))

afterEach(() => {
  cleanup()
  document.querySelectorAll("body > a").forEach((a) => a.remove())
})

beforeEach(() => {
  vi.clearAllMocks()
  updateCoverLetterContent.mockResolvedValue({ success: true })
  improveCoverLetter.mockResolvedValue({ improved: "IMPROVED LETTER" })
})

const ORIGINAL = "Dear hiring manager, I am the original letter."

function makeCoverLetter(
  overrides: Partial<CoverLetterDetail> = {}
): CoverLetterDetail {
  return {
    id: "cl-1",
    content: ORIGINAL,
    suggestions: null,
    jobDescription: "Some job description",
    resume: { title: "Senior Engineer Resume" },
    jobApplication: { id: "app-1", companyName: "Globex", jobTitle: "Staff Engineer" },
    ...overrides,
  }
}

/**
 * The "← Cover Letters" link lives on the page, outside this component; the
 * guard is a document-level listener, so a plain anchor in the document is a
 * faithful stand-in. Created imperatively to keep the lint rule about raw
 * `<a>` tags to internal routes happy.
 */
function mountBackLink() {
  const anchor = document.createElement("a")
  anchor.href = "/jobs/cover-letter"
  anchor.textContent = "← Cover Letters"
  document.body.appendChild(anchor)
  return anchor
}

function editor() {
  return screen.getByLabelText("Cover letter content") as HTMLTextAreaElement
}

/** Types an instruction into the AI panel and presses Improve. */
async function runImprove(instruction = "Make more concise") {
  fireEvent.change(screen.getByLabelText("Improvement instruction"), {
    target: { value: instruction },
  })
  fireEvent.click(screen.getByRole("button", { name: "Improve" }))
  await waitFor(() =>
    expect(improveCoverLetter).toHaveBeenCalledWith("cl-1", ORIGINAL, instruction)
  )
}

describe("cover letter editor — job context", () => {
  it("names the job and offers a way back to it", () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    expect(screen.getByText("Globex — Staff Engineer")).not.toBeNull()
    const back = screen.getByRole("link", { name: "Back to job: Staff Engineer" })
    expect(back.getAttribute("href")).toBe("/jobs/app-1")
  })

  it("renders without job context for an unlinked letter", () => {
    render(
      <CoverLetterEditor coverLetter={makeCoverLetter({ jobApplication: null })} />
    )

    expect(screen.getByText("Cover Letter")).not.toBeNull()
    expect(screen.queryByRole("link", { name: /Back to job/ })).toBeNull()
  })
})

describe("cover letter editor — dirty tracking", () => {
  it("is clean on mount and dirty after an edit", () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    expect(screen.queryByText("Unsaved changes")).toBeNull()

    fireEvent.change(editor(), { target: { value: `${ORIGINAL}!` } })

    expect(screen.getByText("Unsaved changes")).not.toBeNull()
  })

  it("is clean again after a successful save", async () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    fireEvent.change(editor(), { target: { value: `${ORIGINAL}!` } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(updateCoverLetterContent).toHaveBeenCalledWith(
        "cl-1",
        `${ORIGINAL}!`
      )
    )
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull())
  })

  it("stays dirty when the save action fails", async () => {
    updateCoverLetterContent.mockResolvedValue({ error: "Nope" })
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    fireEvent.change(editor(), { target: { value: `${ORIGINAL}!` } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Nope"))
    expect(screen.getByText("Nope")).not.toBeNull()
    expect(screen.getByText("Unsaved changes")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(updateCoverLetterContent).toHaveBeenCalledTimes(2)
    )
  })

  it("confirms before a link navigation while dirty and cancels it on decline", () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)
    const backLink = mountBackLink()

    // Clean: the link is not intercepted.
    let event = new MouseEvent("click", { bubbles: true, cancelable: true })
    act(() => {
      backLink.dispatchEvent(event)
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(event.defaultPrevented).toBe(false)

    fireEvent.change(editor(), { target: { value: `${ORIGINAL}!` } })

    event = new MouseEvent("click", { bubbles: true, cancelable: true })
    act(() => {
      backLink.dispatchEvent(event)
    })
    // The click is always cancelled; the dialog decides what happens next.
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole("dialog")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Stay" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(routerPush).not.toHaveBeenCalled()
  })

  it("navigates on confirm when the user leaves anyway", () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)
    const backLink = mountBackLink()

    fireEvent.change(editor(), { target: { value: `${ORIGINAL}!` } })

    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    act(() => {
      backLink.dispatchEvent(event)
    })

    fireEvent.click(screen.getByRole("button", { name: "Leave" }))
    expect(routerPush).toHaveBeenCalledWith("/jobs/cover-letter")
  })

  it("blocks unload only while dirty", () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    let unload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(false)

    fireEvent.change(editor(), { target: { value: `${ORIGINAL}!` } })

    unload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  })
})

describe("cover letter editor — improve", () => {
  it("auto-saves the improved letter and leaves the editor clean", async () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    await runImprove()

    await waitFor(() =>
      expect(updateCoverLetterContent).toHaveBeenCalledWith(
        "cl-1",
        "IMPROVED LETTER"
      )
    )
    expect(editor().value).toBe("IMPROVED LETTER")
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull())
  })

  it("does not save or offer a revert when the improve action errors", async () => {
    improveCoverLetter.mockResolvedValue({ error: "Rate limited" })
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    await runImprove()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Rate limited"))
    expect(updateCoverLetterContent).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull()
    expect(editor().value).toBe(ORIGINAL)
  })
})

describe("cover letter editor — revert", () => {
  it("shows Revert only after an improve", async () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull()

    await runImprove()

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Revert" })).not.toBeNull()
    )
  })

  it("restores the pre-improve content, persists it and hides itself", async () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    await runImprove()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Revert" })).not.toBeNull()
    )

    fireEvent.click(screen.getByRole("button", { name: "Revert" }))

    await waitFor(() => expect(editor().value).toBe(ORIGINAL))
    await waitFor(() =>
      expect(updateCoverLetterContent).toHaveBeenLastCalledWith("cl-1", ORIGINAL)
    )
    expect(updateCoverLetterContent).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Revert" })).toBeNull()
    )
    expect(screen.queryByText("Unsaved changes")).toBeNull()
  })

  it("drops the revert affordance after a manual edit-and-save", async () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    await runImprove()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Revert" })).not.toBeNull()
    )

    fireEvent.change(editor(), { target: { value: "hand edited" } })
    // Still available until the edit is committed.
    expect(screen.getByRole("button", { name: "Revert" })).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Revert" })).toBeNull()
    )
  })

  it("keeps only one level of undo across two improves", async () => {
    render(<CoverLetterEditor coverLetter={makeCoverLetter()} />)

    await runImprove()
    await waitFor(() => expect(editor().value).toBe("IMPROVED LETTER"))

    improveCoverLetter.mockResolvedValue({ improved: "IMPROVED TWICE" })
    fireEvent.change(screen.getByLabelText("Improvement instruction"), {
      target: { value: "Stronger opening" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Improve" }))
    await waitFor(() => expect(editor().value).toBe("IMPROVED TWICE"))

    fireEvent.click(screen.getByRole("button", { name: "Revert" }))

    // Reverts to the first improve's output, not all the way to the original.
    await waitFor(() => expect(editor().value).toBe("IMPROVED LETTER"))
  })
})
