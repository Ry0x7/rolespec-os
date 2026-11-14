import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { BulletTextarea } from "../editors/bullet-textarea"

function renderBullet(props: Partial<React.ComponentProps<typeof BulletTextarea>> = {}) {
  const onChange = vi.fn()
  const onEnter = vi.fn()
  const onRemoveEmpty = vi.fn()
  render(
    <BulletTextarea
      value=""
      onChange={onChange}
      onEnter={onEnter}
      onRemoveEmpty={onRemoveEmpty}
      {...props}
    />
  )
  return { onChange, onEnter, onRemoveEmpty, field: screen.getByRole("textbox") }
}

describe("BulletTextarea", () => {
  it("renders a textarea rather than a single-line input", () => {
    const { field } = renderBullet()
    expect(field.tagName).toBe("TEXTAREA")
  })

  it("treats Enter as 'add a bullet below', not a newline", () => {
    const { field, onEnter, onChange } = renderBullet({ value: "Led the team" })
    const event = fireEvent.keyDown(field, { key: "Enter" })
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
    // fireEvent returns false when preventDefault() was called.
    expect(event).toBe(false)
  })

  it("removes the bullet on Backspace when it is already empty", () => {
    const { field, onRemoveEmpty } = renderBullet({ value: "" })
    fireEvent.keyDown(field, { key: "Backspace" })
    expect(onRemoveEmpty).toHaveBeenCalledTimes(1)
  })

  it("leaves Backspace alone when the bullet still has text", () => {
    const { field, onRemoveEmpty } = renderBullet({ value: "a" })
    fireEvent.keyDown(field, { key: "Backspace" })
    expect(onRemoveEmpty).not.toHaveBeenCalled()
  })

  it("does not remove the bullet when no onRemoveEmpty handler is given (last bullet)", () => {
    const onChange = vi.fn()
    render(<BulletTextarea value="" onChange={onChange} />)
    const event = fireEvent.keyDown(screen.getByRole("textbox"), { key: "Backspace" })
    // Not prevented, so the browser's own Backspace behaviour stands.
    expect(event).toBe(true)
  })

  it("flattens newlines out of pasted text", () => {
    const { field, onChange } = renderBullet({ value: "" })
    fireEvent.paste(field, {
      clipboardData: { getData: () => "Led the team\n  and shipped it" },
    })
    expect(onChange).toHaveBeenCalledWith("Led the team and shipped it")
  })

  it("pastes single-line text through untouched", () => {
    const { field, onChange } = renderBullet({ value: "" })
    fireEvent.paste(field, { clipboardData: { getData: () => "Led the team" } })
    // No preventDefault, so the native paste path runs and onChange fires from it.
    expect(onChange).not.toHaveBeenCalled()
  })

  it("hides the character counter until the bullet gets long", () => {
    renderBullet({ value: "x".repeat(180) })
    expect(screen.queryByText(/\/220$/)).toBeNull()
  })

  it("shows the counter past 180 characters in muted text", () => {
    renderBullet({ value: "x".repeat(181) })
    const counter = screen.getByText("181/220")
    expect(counter.className).toContain("text-muted-foreground")
  })

  it("warns once the bullet passes the 220-character cap without blocking input", () => {
    const { field } = renderBullet({ value: "x".repeat(221) })
    const counter = screen.getByText("221/220")
    expect(counter.className).toContain("amber")
    expect(field.hasAttribute("maxlength")).toBe(false)
  })
})
