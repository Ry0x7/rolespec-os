import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Progress } from "../progress"

afterEach(cleanup)

describe("Progress", () => {
  it("exposes progressbar role and aria value attributes", () => {
    render(<Progress value={40} label="XP progress" />)
    const bar = screen.getByRole("progressbar")
    expect(bar.getAttribute("aria-valuenow")).toBe("40")
    expect(bar.getAttribute("aria-valuemin")).toBe("0")
    expect(bar.getAttribute("aria-valuemax")).toBe("100")
    expect(bar.getAttribute("aria-label")).toBe("XP progress")
  })

  it("scales the fill against a custom max", () => {
    render(<Progress value={3} max={12} label="Quests" />)
    const bar = screen.getByRole("progressbar")
    expect(bar.getAttribute("aria-valuemax")).toBe("12")
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("25%")
  })

  it("clamps out-of-range values", () => {
    const { rerender } = render(<Progress value={150} label="over" />)
    let bar = screen.getByRole("progressbar")
    expect(bar.getAttribute("aria-valuenow")).toBe("100")
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%")

    rerender(<Progress value={-20} label="under" />)
    bar = screen.getByRole("progressbar")
    expect(bar.getAttribute("aria-valuenow")).toBe("0")
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("0%")
  })

  it("animates width within the 150-250ms band", () => {
    render(<Progress value={50} label="x" />)
    const fill = screen.getByRole("progressbar").firstElementChild as HTMLElement
    expect(fill.className).toContain("duration-200")
    expect(fill.className).toContain("transition-[width]")
  })

  it("applies the color prop to the fill", () => {
    render(<Progress value={50} color="success" label="x" />)
    const fill = screen.getByRole("progressbar").firstElementChild as HTMLElement
    expect(fill.className).toContain("bg-green-500")
  })
})
