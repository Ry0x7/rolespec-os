import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Pagination } from "../pagination"

afterEach(cleanup)

describe("Pagination", () => {
  it("renders nothing when everything fits on one page", () => {
    const { container } = render(<Pagination page={1} pageCount={1} onPageChange={() => {}} />)
    expect(container.innerHTML).toBe("")
  })

  it("is a labelled nav with a live page status and a disabled Previous on page 1", () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} pageCount={3} onPageChange={onPageChange} label="Roles pages" />)
    expect(screen.getByRole("navigation", { name: "Roles pages" })).toBeTruthy()
    expect(screen.getByText("Page 1 of 3").getAttribute("aria-live")).toBe("polite")
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it("defaults the nav label and disables Next on the last page", () => {
    const onPageChange = vi.fn()
    render(<Pagination page={3} pageCount={3} onPageChange={onPageChange} />)
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true)
    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })
})
