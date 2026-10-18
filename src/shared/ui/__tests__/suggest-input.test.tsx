import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SuggestInput } from "../suggest-input"

afterEach(cleanup)

const suggestions = ["Frontend", "Backend", "Full Stack"]

function renderInput(props?: { multiple?: boolean }) {
  render(
    <form>
      <SuggestInput
        aria-label="Category"
        name="category"
        suggestions={suggestions}
        {...props}
      />
    </form>
  )
  return screen.getByRole("combobox", { name: "Category" }) as HTMLInputElement
}

describe("SuggestInput", () => {
  it("keeps the list closed until focused, then shows every suggestion", () => {
    const input = renderInput()
    expect(screen.queryByRole("option")).toBeNull()

    fireEvent.focus(input)
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(
      suggestions
    )
    expect(input.getAttribute("aria-expanded")).toBe("true")
  })

  it("filters case-insensitively as the user types", () => {
    const input = renderInput()
    fireEvent.focus(input)
    fireEvent.input(input, { target: { value: "end" } })

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Frontend",
      "Backend",
    ])
  })

  it("fills the input when a suggestion is picked with the mouse", () => {
    const input = renderInput()
    fireEvent.focus(input)
    fireEvent.mouseDown(screen.getByRole("option", { name: "Backend" }))

    expect(input.value).toBe("Backend")
    expect(screen.queryByRole("option")).toBeNull()
  })

  it("supports arrow-key navigation and Enter without submitting free text", () => {
    const input = renderInput()
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(input.value).toBe("Backend")
  })

  it("closes on Escape and still allows free text", () => {
    const input = renderInput()
    fireEvent.focus(input)
    fireEvent.input(input, { target: { value: "Nursing" } })

    // Nothing matches, so the list is already closed; Escape stays a no-op.
    expect(screen.queryByRole("option")).toBeNull()
    fireEvent.keyDown(input, { key: "Escape" })
    expect(input.value).toBe("Nursing")
  })

  it("filters on the segment after the last comma when multiple", () => {
    const input = renderInput({ multiple: true })
    fireEvent.focus(input)
    fireEvent.input(input, { target: { value: "Frontend, Back" } })

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Backend",
    ])
  })

  it("replaces only the last segment of a comma-separated value when multiple", () => {
    const input = renderInput({ multiple: true })
    fireEvent.focus(input)
    fireEvent.input(input, { target: { value: "Frontend, Back" } })
    fireEvent.mouseDown(screen.getByRole("option", { name: "Backend" }))

    expect(input.value).toBe("Frontend, Backend")
  })

  it("matches and replaces the whole value by default, commas included", () => {
    // A single value may legitimately contain a comma, e.g. "Nurse, RN".
    render(
      <form>
        <SuggestInput
          aria-label="Role"
          name="title"
          suggestions={["Nurse, RN", "Frontend"]}
        />
      </form>
    )
    const input = screen.getByRole("combobox", {
      name: "Role",
    }) as HTMLInputElement

    fireEvent.focus(input)
    fireEvent.input(input, { target: { value: "Nurse, R" } })

    // Last-segment matching would have filtered on "R" and kept both.
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Nurse, RN",
    ])

    fireEvent.mouseDown(screen.getByRole("option", { name: "Nurse, RN" }))
    // Last-segment replacement would have produced "Nurse, Nurse, RN".
    expect(input.value).toBe("Nurse, RN")
  })

  it("clears its filter when the surrounding form resets", () => {
    const input = renderInput()
    fireEvent.input(input, { target: { value: "Front" } })
    fireEvent.reset(input.form!)

    fireEvent.focus(input)
    expect(screen.getAllByRole("option")).toHaveLength(suggestions.length)
  })
})
