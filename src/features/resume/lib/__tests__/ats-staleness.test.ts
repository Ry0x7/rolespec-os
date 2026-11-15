import { describe, it, expect } from "vitest"
import { ANALYSIS_OWN_WRITE_MS, isAnalysisOutdated } from "../ats-staleness"

const ANALYZED = new Date("2026-10-01T10:00:00.000Z")
const after = (ms: number) => new Date(ANALYZED.getTime() + ms)

describe("isAnalysisOutdated", () => {
  it("treats the analysis's own atsScore write (tens of ms later) as current", () => {
    expect(isAnalysisOutdated(after(59), ANALYZED)).toBe(false)
  })

  it("treats a save at the edge of the window as current", () => {
    expect(isAnalysisOutdated(after(ANALYSIS_OWN_WRITE_MS), ANALYZED)).toBe(false)
  })

  it("flags a save that lands after the window, e.g. an 8 s autosave", () => {
    expect(isAnalysisOutdated(after(8_000), ANALYZED)).toBe(true)
  })

  it("treats a resume last saved before the analysis as current", () => {
    expect(isAnalysisOutdated(after(-60_000), ANALYZED)).toBe(false)
  })
})
