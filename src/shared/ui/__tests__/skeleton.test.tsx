import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { Skeleton } from "../skeleton"

afterEach(cleanup)

describe("Skeleton", () => {
  it("wires up the shimmer keyframe and stays out of the a11y tree", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain("animate-shimmer")
    expect(el.className).toContain("motion-reduce:animate-none")
    expect(el.className).toContain("h-4")
    expect(el.getAttribute("aria-hidden")).toBe("true")
  })
})
