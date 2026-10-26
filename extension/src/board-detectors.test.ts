import { describe, expect, it } from "vitest"
import { boardReadHint, detectBoard, detectBoardFromUrl, isKnownBoard } from "./board-detectors"

describe("detectBoard", () => {
  it("matches Greenhouse, Lever, Ashby and Workday hosts", () => {
    expect(detectBoard("boards.greenhouse.io")).toBe("greenhouse")
    expect(detectBoard("jobs.lever.co")).toBe("lever")
    expect(detectBoard("jobs.ashby.hq")).toBe("ashby")
    expect(detectBoard("acme.myworkdayjobs.com")).toBe("workday")
  })

  it("falls back to generic for unknown hosts", () => {
    expect(detectBoard("example.com")).toBe("generic")
    expect(detectBoard(null)).toBe("generic")
    expect(detectBoard("")).toBe("generic")
  })
})

describe("detectBoardFromUrl", () => {
  it("reads the hostname out of a posting URL", () => {
    expect(detectBoardFromUrl("https://www.linkedin.com/jobs/view/123")).toBe("linkedin")
    expect(detectBoardFromUrl("not a url")).toBe("generic")
  })
})

describe("isKnownBoard", () => {
  it("flags only adapted boards", () => {
    expect(isKnownBoard("lever")).toBe(true)
    expect(isKnownBoard("generic")).toBe(false)
  })
})

describe("boardReadHint", () => {
  it("names the board and the missing fields", () => {
    expect(boardReadHint("lever", { jobTitle: "Engineer" })).toContain("Lever")
    expect(boardReadHint("generic", {})).toBeNull()
    expect(boardReadHint("lever", { companyName: "Acme", jobTitle: "Eng" })).toBeNull()
  })
})
