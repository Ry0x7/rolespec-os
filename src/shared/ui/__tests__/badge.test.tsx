import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Badge } from "../badge"

afterEach(cleanup)

describe("Badge", () => {
  it("defaults to the neutral variant at md size", () => {
    render(<Badge>Draft</Badge>)
    const el = screen.getByText("Draft")
    expect(el.className).toContain("bg-muted")
    expect(el.className).toContain("text-muted-foreground")
    expect(el.className).toContain("text-xs")
  })

  it.each([
    ["brand", "bg-brand-500/10"],
    ["success", "bg-green-500/10"],
    ["warning", "bg-amber-500/10"],
    ["error", "bg-red-500/10"],
    ["info", "bg-blue-500/10"],
    ["outline", "bg-transparent"],
  ] as const)("applies the %s variant class", (variant, expected) => {
    render(<Badge variant={variant}>Label</Badge>)
    expect(screen.getByText("Label").className).toContain(expected)
  })

  it("applies the sm size and merges consumer classNames", () => {
    render(
      <Badge size="sm" className="uppercase">
        Tiny
      </Badge>
    )
    const el = screen.getByText("Tiny")
    expect(el.className).toContain("px-1.5")
    expect(el.className).toContain("uppercase")
  })
})
