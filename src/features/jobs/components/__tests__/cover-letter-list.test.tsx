import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("../../actions/cover-letter.actions", () => ({
  deleteCoverLetter: vi.fn(),
}))

import { CoverLetterList } from "../cover-letter-list"

afterEach(cleanup)

/** Letter n is linked to "Company nn" unless it is a multiple of five. */
function makeCoverLetters(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = String(index + 1).padStart(2, "0")
    return {
      id: `cl-${n}`,
      createdAt: new Date("2026-01-15T10:00:00.000Z"),
      resume: { title: (index + 1) % 5 === 0 ? `Standalone Resume ${n}` : "Main Resume" },
      jobApplication:
        (index + 1) % 5 === 0
          ? null
          : { id: `app-${n}`, companyName: `Company ${n}`, jobTitle: "Staff Engineer" },
      contentExcerpt: `Letter ${n}`,
    }
  })
}

function visibleExcerpts() {
  return screen.queryAllByText(/^Letter \d\d/).map((node) => node.textContent)
}

describe("CoverLetterList", () => {
  it("shows every letter and no pager at twelve or fewer", () => {
    render(<CoverLetterList coverLetters={makeCoverLetters(7)} />)
    expect(visibleExcerpts()).toHaveLength(7)
    expect(screen.getByText("Showing 1–7 of 7")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Cover letter pages" })).toBeNull()
  })

  it("pages at twelve with Previous and Next", () => {
    render(<CoverLetterList coverLetters={makeCoverLetters(26)} />)
    const pager = screen.getByRole("navigation", { name: "Cover letter pages" })
    expect(pager.textContent).toContain("Page 1 of 3")
    expect(visibleExcerpts()).toHaveLength(12)
    expect(screen.getByText("Showing 1–12 of 26")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Showing 13–24 of 26")).toBeTruthy()
    expect(screen.queryByText(/^Letter 01/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Showing 25–26 of 26")).toBeTruthy()
    expect(visibleExcerpts()).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    expect(screen.getByText("Showing 13–24 of 26")).toBeTruthy()
  })

  it("searches company, job title and resume title, and returns to page 1", () => {
    render(<CoverLetterList coverLetters={makeCoverLetters(26)} />)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    const search = screen.getByLabelText("Search cover letters")

    // Company 11..14, 16..19 (10, 15 and 20 are unlinked).
    fireEvent.change(search, { target: { value: "company 1" } })
    expect(screen.getByText("Showing 1–8 of 8")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Cover letter pages" })).toBeNull()

    fireEvent.change(search, { target: { value: "standalone" } })
    expect(screen.getByText("Showing 1–5 of 5")).toBeTruthy()

    fireEvent.change(search, { target: { value: "staff engineer" } })
    expect(screen.getByText("Showing 1–12 of 21")).toBeTruthy()
  })

  it("says so when nothing matches the search", () => {
    render(<CoverLetterList coverLetters={makeCoverLetters(3)} />)
    fireEvent.change(screen.getByLabelText("Search cover letters"), {
      target: { value: "nothing like this" },
    })
    expect(screen.getByText("No results")).toBeTruthy()
    expect(screen.queryByText(/^Showing/)).toBeNull()
  })

  it("clamps to the last page when a letter is deleted from it", () => {
    const { rerender } = render(<CoverLetterList coverLetters={makeCoverLetters(13)} />)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Showing 13–13 of 13")).toBeTruthy()

    rerender(<CoverLetterList coverLetters={makeCoverLetters(12)} />)
    expect(screen.getByText("Showing 1–12 of 12")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Cover letter pages" })).toBeNull()
  })
})
