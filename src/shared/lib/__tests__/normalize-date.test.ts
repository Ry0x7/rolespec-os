import { describe, it, expect } from "vitest"
import { dateSortKey, normalizeDateString } from "../normalize-date"

describe("normalizeDateString", () => {
  it("passes through already-valid MMM YYYY", () => {
    expect(normalizeDateString("Jan 2024")).toBe("Jan 2024")
    expect(normalizeDateString("Dec 2023")).toBe("Dec 2023")
  })

  it("normalizes present aliases to Present", () => {
    expect(normalizeDateString("Present")).toBe("Present")
    expect(normalizeDateString("present")).toBe("Present")
    expect(normalizeDateString("Current")).toBe("Present")
    expect(normalizeDateString("current")).toBe("Present")
    expect(normalizeDateString("Ongoing")).toBe("Present")
    expect(normalizeDateString("ongoing")).toBe("Present")
    expect(normalizeDateString("Now")).toBe("Present")
    expect(normalizeDateString("now")).toBe("Present")
  })

  it("converts ISO YYYY-MM to MMM YYYY", () => {
    expect(normalizeDateString("2024-01")).toBe("Jan 2024")
    expect(normalizeDateString("2023-12")).toBe("Dec 2023")
  })

  it("converts ISO YYYY-MM-DD to MMM YYYY", () => {
    expect(normalizeDateString("2024-03-15")).toBe("Mar 2024")
  })

  it("converts full month names to MMM YYYY", () => {
    expect(normalizeDateString("January 2024")).toBe("Jan 2024")
    expect(normalizeDateString("December 2023")).toBe("Dec 2023")
    expect(normalizeDateString("March, 2022")).toBe("Mar 2022")
  })

  it("passes through year-only strings", () => {
    expect(normalizeDateString("2024")).toBe("2024")
  })

  it("returns undefined for undefined input", () => {
    expect(normalizeDateString(undefined)).toBeUndefined()
  })

  it("returns raw value for empty string", () => {
    expect(normalizeDateString("")).toBe("")
  })

  it("converts MM-YYYY and MM.YYYY to MMM YYYY", () => {
    expect(normalizeDateString("08-2024")).toBe("Aug 2024")
    expect(normalizeDateString("11-2024")).toBe("Nov 2024")
    expect(normalizeDateString("08.2024")).toBe("Aug 2024")
    expect(normalizeDateString("08.2023")).toBe("Aug 2023")
    expect(normalizeDateString("1-2024")).toBe("Jan 2024")
  })

  it("returns raw value for unrecognized input without crashing", () => {
    expect(normalizeDateString("some weird date")).toBe("some weird date")
    expect(normalizeDateString("Q1 2024")).toBe("Q1 2024")
  })
})

describe("dateSortKey", () => {
  it("orders months within a year", () => {
    expect(dateSortKey("May 2023")).toBeLessThan(dateSortKey("Dec 2023"))
    expect(dateSortKey("Jan 2023")).toBeLessThan(dateSortKey("Feb 2023"))
  })

  it("orders across years", () => {
    expect(dateSortKey("Dec 2020")).toBeLessThan(dateSortKey("Jan 2021"))
    expect(dateSortKey("2020")).toBeLessThan(dateSortKey("Aug 2024"))
  })

  it("treats equivalent formats as equal", () => {
    expect(dateSortKey("2023-05")).toBe(dateSortKey("May 2023"))
    expect(dateSortKey("May 2023")).toBe(dateSortKey("05-2023"))
    expect(dateSortKey("2023-05-14")).toBe(dateSortKey("May 2023"))
  })

  it("sorts year-only input at the start of that year", () => {
    expect(dateSortKey("2024")).toBe(dateSortKey("Jan 2024"))
  })

  it("sorts present aliases last", () => {
    expect(dateSortKey("Present")).toBe(Infinity)
    expect(dateSortKey("current")).toBe(Infinity)
  })

  it("returns NaN for missing or unparseable input", () => {
    expect(dateSortKey(undefined)).toBeNaN()
    expect(dateSortKey(null)).toBeNaN()
    expect(dateSortKey("")).toBeNaN()
    expect(dateSortKey("   ")).toBeNaN()
    expect(dateSortKey("some weird date")).toBeNaN()
    expect(dateSortKey("Q1 2024")).toBeNaN()
  })
})
