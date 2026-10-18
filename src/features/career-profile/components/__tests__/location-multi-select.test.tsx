import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LocationMultiSelect } from "../location-multi-select"
import { COUNTRY_OPTIONS, MAX_LOCATIONS } from "../../constants/locations"

afterEach(cleanup)

describe("LocationMultiSelect", () => {
  it("appends a picked country and resets to the placeholder", () => {
    const onChange = vi.fn()
    render(<LocationMultiSelect id="loc" value={["Germany"]} onChange={onChange} />)

    const select = screen.getByRole("combobox") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "Philippines" } })

    expect(onChange).toHaveBeenCalledWith(["Germany", "Philippines"])
    expect(select.value).toBe("")
  })

  it("hides already-selected countries from the options", () => {
    render(<LocationMultiSelect value={["Germany"]} onChange={() => {}} />)

    expect(screen.queryByRole("option", { name: "Germany" })).toBeNull()
    expect(screen.getByRole("option", { name: "France" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "Add a location…" })).toBeTruthy()
  })

  it("removes a chip", () => {
    const onChange = vi.fn()
    render(<LocationMultiSelect value={["Germany", "Japan"]} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Remove Germany" }))

    expect(onChange).toHaveBeenCalledWith(["Japan"])
  })

  it("disables the select at the cap and ignores further picks", () => {
    const onChange = vi.fn()
    const full = COUNTRY_OPTIONS.slice(0, MAX_LOCATIONS)
    render(<LocationMultiSelect value={full} onChange={onChange} />)

    const select = screen.getByRole("combobox") as HTMLSelectElement
    expect(select.disabled).toBe(true)
    fireEvent.change(select, { target: { value: COUNTRY_OPTIONS[MAX_LOCATIONS] } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps legacy free-text values as removable chips", () => {
    const onChange = vi.fn()
    render(
      <LocationMultiSelect value={["Berlin, Germany", "Remote — APAC"]} onChange={onChange} />
    )

    expect(screen.getByText("Berlin, Germany")).toBeTruthy()
    expect(screen.getByText("Remote — APAC")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Remove Berlin, Germany" }))
    expect(onChange).toHaveBeenCalledWith(["Remote — APAC"])
  })
})
