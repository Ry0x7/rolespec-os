import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("../../actions/cover-letter.actions", () => ({
  deleteCoverLetter: vi.fn(),
}))

import { CoverLetterCard } from "../cover-letter-card"

afterEach(cleanup)

const base = {
  id: "cl-1",
  createdAt: new Date("2026-01-15T10:00:00.000Z"),
  resume: { title: "Senior Engineer Resume" },
  contentExcerpt: "Dear hiring manager,",
}

describe("cover letter card — job context", () => {
  it("labels a linked letter with company and job title, linking to the job", () => {
    render(
      <CoverLetterCard
        coverLetter={{
          ...base,
          jobApplication: { id: "app-1", companyName: "Globex", jobTitle: "Staff Engineer" },
        }}
      />
    )

    const jobLink = screen.getByRole("link", { name: "Globex — Staff Engineer" })
    expect(jobLink.getAttribute("href")).toBe("/jobs/app-1")
    // The card still opens the editor.
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === "/jobs/cover-letter/cl-1")
    ).toBe(true)
  })

  it("says so when the letter is not linked to a job", () => {
    render(<CoverLetterCard coverLetter={{ ...base, jobApplication: null }} />)

    expect(screen.getByText("Not linked to a job")).not.toBeNull()
    expect(screen.queryByRole("link", { name: /—/ })).toBeNull()
    expect(
      screen.getAllByRole("link").map((a) => a.getAttribute("href"))
    ).toEqual(["/jobs/cover-letter/cl-1"])
  })
})

describe("cover letter card — delete button label", () => {
  it("names the job in the delete label for a linked letter", () => {
    render(
      <CoverLetterCard
        coverLetter={{
          ...base,
          jobApplication: { id: "app-1", companyName: "Globex", jobTitle: "Staff Engineer" },
        }}
      />
    )

    expect(
      screen.getByRole("button", {
        name: "Delete cover letter for Globex — Staff Engineer",
      })
    ).not.toBeNull()
  })

  it("names the resume in the delete label for an unlinked letter", () => {
    render(<CoverLetterCard coverLetter={{ ...base, jobApplication: null }} />)

    expect(
      screen.getByRole("button", {
        name: "Delete cover letter for Senior Engineer Resume",
      })
    ).not.toBeNull()
    expect(screen.queryByRole("button", { name: /Standalone/ })).toBeNull()
  })
})
