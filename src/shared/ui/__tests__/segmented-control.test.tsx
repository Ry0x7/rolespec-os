import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SegmentedControl } from "../segmented-control"

afterEach(cleanup)

describe("SegmentedControl", () => {
  it("is a labelled group of aria-pressed buttons with muted counts", () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        label="Filter things"
        value="b"
        onChange={onChange}
        options={[
          { value: "a", label: "Alpha", count: 2 },
          { value: "b", label: "Beta" },
        ]}
      />
    )
    expect(screen.getByRole("group", { name: "Filter things" })).toBeTruthy()
    const alpha = screen.getByRole("button", { name: "Alpha (2)" })
    expect(alpha.getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByRole("button", { name: "Beta" }).getAttribute("aria-pressed")).toBe("true")
    expect(alpha.querySelector("span")?.className).toContain("text-muted-foreground")

    fireEvent.click(alpha)
    expect(onChange).toHaveBeenCalledWith("a")
  })
})
