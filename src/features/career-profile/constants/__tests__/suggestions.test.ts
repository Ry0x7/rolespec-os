import { describe, expect, it } from "vitest"
import { mergeSuggestions } from "../suggestions"

describe("mergeSuggestions", () => {
  it("puts the user's own values before the curated defaults", () => {
    expect(mergeSuggestions(["Payments", "Nursing"], ["Frontend", "Sales"])).toEqual([
      "Payments",
      "Nursing",
      "Frontend",
      "Sales",
    ])
  })

  it("dedupes case-insensitively, keeping the user's own spelling", () => {
    expect(mergeSuggestions(["frontend", "Sales"], ["Frontend", "Sales", "Design"])).toEqual([
      "frontend",
      "Sales",
      "Design",
    ])
  })

  it("drops nulls, empties, and whitespace-only values", () => {
    expect(mergeSuggestions([null, "", "  ", " Ops "], ["Ops", "Design"])).toEqual([
      "Ops",
      "Design",
    ])
  })

  it("dedupes within the user's own values too", () => {
    expect(mergeSuggestions(["Data", "data", "Data "], [])).toEqual(["Data"])
  })
})
