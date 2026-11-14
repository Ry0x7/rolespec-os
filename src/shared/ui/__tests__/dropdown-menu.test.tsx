import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../dropdown-menu"

afterEach(cleanup)

function Menu({ onPick }: { onPick?: () => void } = {}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Account</DropdownMenuTrigger>
      <DropdownMenuContent label="Account">
        <DropdownMenuItem onClick={onPick}>Settings</DropdownMenuItem>
        <DropdownMenuItem>Billing</DropdownMenuItem>
        <DropdownMenuItem>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe("DropdownMenu", () => {
  it("is closed by default and opens on trigger click", () => {
    render(<Menu />)
    const trigger = screen.getByRole("button", { name: "Account" })
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("menu")).toBeNull()

    fireEvent.click(trigger)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("menu")).toBeTruthy()
    expect(screen.getAllByRole("menuitem")).toHaveLength(3)
  })

  it("focuses the first item on open", () => {
    render(<Menu />)
    fireEvent.click(screen.getByRole("button", { name: "Account" }))
    expect(document.activeElement?.textContent).toBe("Settings")
  })

  it("closes on Escape and returns focus to the trigger", () => {
    render(<Menu />)
    const trigger = screen.getByRole("button", { name: "Account" })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("closes on outside pointer down", () => {
    render(
      <div>
        <Menu />
        <button type="button">outside</button>
      </div>
    )
    fireEvent.click(screen.getByRole("button", { name: "Account" }))
    expect(screen.getByRole("menu")).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }))
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("runs the item handler and closes on item click", () => {
    const onPick = vi.fn()
    render(<Menu onPick={onPick} />)
    fireEvent.click(screen.getByRole("button", { name: "Account" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("wraps focus with ArrowDown / ArrowUp / Home / End", () => {
    render(<Menu />)
    fireEvent.click(screen.getByRole("button", { name: "Account" }))
    const menu = screen.getByRole("menu")

    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(document.activeElement?.textContent).toBe("Billing")

    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(document.activeElement?.textContent).toBe("Sign out")

    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(document.activeElement?.textContent).toBe("Settings")

    fireEvent.keyDown(menu, { key: "ArrowUp" })
    expect(document.activeElement?.textContent).toBe("Sign out")

    fireEvent.keyDown(menu, { key: "Home" })
    expect(document.activeElement?.textContent).toBe("Settings")

    fireEvent.keyDown(menu, { key: "End" })
    expect(document.activeElement?.textContent).toBe("Sign out")
  })

  it("skips disabled items during arrow navigation", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent label="Menu">
          <DropdownMenuItem>One</DropdownMenuItem>
          <DropdownMenuItem disabled>Two</DropdownMenuItem>
          <DropdownMenuItem>Three</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    fireEvent.click(screen.getByRole("button", { name: "Menu" }))
    expect(document.activeElement?.textContent).toBe("One")
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" })
    expect(document.activeElement?.textContent).toBe("Three")
  })

  it("renders an asChild item as the provided element with menuitem role", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent label="Menu">
          <DropdownMenuItem asChild>
            <a href="/settings">Settings</a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    fireEvent.click(screen.getByRole("button", { name: "Menu" }))
    const item = screen.getByRole("menuitem", { name: "Settings" })
    expect(item.tagName).toBe("A")
    expect(item.getAttribute("href")).toBe("/settings")
  })
})
