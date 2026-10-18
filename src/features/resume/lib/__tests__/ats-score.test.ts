import { describe, it, expect } from "vitest"

import { analysisModeFromDb, analysisModeToDb } from "../ats-score"

describe("analysisModeFromDb", () => {
  it("maps the persisted enum to the client-side mode string", () => {
    expect(analysisModeFromDb("QUALITY")).toBe("quality")
    expect(analysisModeFromDb("JOB_MATCH")).toBe("job-match")
  })
})

describe("analysisModeToDb", () => {
  it("maps the client-side mode string to the persisted enum", () => {
    expect(analysisModeToDb("quality")).toBe("QUALITY")
    expect(analysisModeToDb("job-match")).toBe("JOB_MATCH")
  })

  it("round-trips both modes", () => {
    for (const mode of ["quality", "job-match"] as const) {
      expect(analysisModeFromDb(analysisModeToDb(mode))).toBe(mode)
    }
  })
})
