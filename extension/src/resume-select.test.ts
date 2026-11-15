import { describe, expect, it } from "vitest"
import { LATEST_RESUME_VALUE, preservedSelection, resumeOptionLabel } from "./resume-select"
import type { ResumeSummary } from "./types"

const resume = (over: Partial<ResumeSummary> = {}): ResumeSummary => ({
  id: "r1",
  title: "Backend Engineer",
  atsScore: 82,
  updatedAt: "2026-08-15T00:00:00.000Z",
  ...over,
})

describe("resumeOptionLabel", () => {
  it("appends the ATS score when there is one", () => {
    expect(resumeOptionLabel(resume())).toBe("Backend Engineer — ATS 82")
  })

  it("shows the title alone when the resume has never been scored", () => {
    expect(resumeOptionLabel(resume({ atsScore: null }))).toBe("Backend Engineer")
  })

  it("labels an empty title rather than rendering a blank option", () => {
    expect(resumeOptionLabel(resume({ title: "   ", atsScore: null }))).toBe("Untitled resume")
  })
})

describe("preservedSelection", () => {
  const list = [resume(), resume({ id: "r2", title: "Data Analyst" })]

  it("keeps a selection that is still in the list", () => {
    expect(preservedSelection("r2", list)).toBe("r2")
  })

  it("falls back to the latest-resume option when the selection is gone", () => {
    expect(preservedSelection("r9", list)).toBe(LATEST_RESUME_VALUE)
  })

  it("keeps the latest-resume option selected", () => {
    expect(preservedSelection("", list)).toBe(LATEST_RESUME_VALUE)
  })

  it("falls back when the list came back empty", () => {
    expect(preservedSelection("r1", [])).toBe(LATEST_RESUME_VALUE)
  })
})
