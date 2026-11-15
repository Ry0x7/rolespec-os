import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { ArchivedResumeList } from "../archived-resume-list"

const restoreResume = vi.fn()

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("../../actions", () => ({
  restoreResume: (...args: unknown[]) => restoreResume(...args),
}))

afterEach(() => {
  cleanup()
  restoreResume.mockReset()
})

function resumes(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${index + 1}`,
    title: `Archived resume ${index + 1}`,
    updatedAt: new Date("2026-01-15T00:00:00.000Z"),
  }))
}

describe("ArchivedResumeList", () => {
  it("starts collapsed and says how many are in there", () => {
    render(<ArchivedResumeList resumes={resumes(3)} />)

    const toggle = screen.getByRole("button", { name: "Archived (3)" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Archived resume 1")).toBeNull()
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull()
  })

  it("shows the resumes once opened and hides them again", () => {
    render(<ArchivedResumeList resumes={resumes(3)} />)
    const toggle = screen.getByRole("button", { name: "Archived (3)" })

    fireEvent.click(toggle)

    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Archived resume 1")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(3)

    fireEvent.click(toggle)

    expect(screen.queryByText("Archived resume 1")).toBeNull()
  })

  it("still restores a resume from the expanded list", () => {
    restoreResume.mockResolvedValue({})
    render(<ArchivedResumeList resumes={resumes(2)} />)

    fireEvent.click(screen.getByRole("button", { name: "Archived (2)" }))
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[1])

    expect(restoreResume).toHaveBeenCalledWith("r2")
  })

  it("pages the expanded list ten at a time", () => {
    render(<ArchivedResumeList resumes={resumes(23)} />)
    fireEvent.click(screen.getByRole("button", { name: "Archived (23)" }))

    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(10)
    expect(screen.getByText("Archived resume 10")).toBeTruthy()
    expect(screen.queryByText("Archived resume 11")).toBeNull()
    expect(screen.getByText("Page 1 of 3")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Archived resume 11")).toBeTruthy()
    expect(screen.queryByText("Archived resume 10")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(3)
    expect(
      screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")
    ).toBe(true)
  })

  it("shows no pager when ten or fewer are archived", () => {
    render(<ArchivedResumeList resumes={resumes(10)} />)
    fireEvent.click(screen.getByRole("button", { name: "Archived (10)" }))

    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(10)
    expect(
      screen.queryByRole("navigation", { name: "Archived resume pages" })
    ).toBeNull()
  })
})
