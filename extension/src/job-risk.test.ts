import { describe, expect, it } from "vitest"
import { parseJobRisk } from "./job-risk"

describe("parseJobRisk", () => {
  it("reads a HIGH payload", () => {
    expect(parseJobRisk({ level: "HIGH", reasons: ["No company website", "Asks for a fee"] })).toEqual(
      { level: "HIGH", reasons: ["No company website", "Asks for a fee"] }
    )
  })

  it("reads a LOW payload", () => {
    expect(parseJobRisk({ level: "LOW", reasons: ["Reposted several times"] })).toEqual({
      level: "LOW",
      reasons: ["Reposted several times"],
    })
  })

  it("returns null when the server sent no risk at all", () => {
    expect(parseJobRisk(undefined)).toBeNull()
    expect(parseJobRisk(null)).toBeNull()
  })

  it("returns null for a level outside the three known values", () => {
    expect(parseJobRisk({ level: "CRITICAL", reasons: ["Something"] })).toBeNull()
    expect(parseJobRisk({ level: "high", reasons: ["Something"] })).toBeNull()
    expect(parseJobRisk({ level: 3, reasons: ["Something"] })).toBeNull()
    expect(parseJobRisk({ reasons: ["Something"] })).toBeNull()
  })

  it("drops non-string and blank reasons but keeps the flag", () => {
    expect(parseJobRisk({ level: "MEDIUM", reasons: ["Real reason", 42, null, "  ", {}] })).toEqual({
      level: "MEDIUM",
      reasons: ["Real reason"],
    })
  })

  it("keeps a flag whose reasons all fell away", () => {
    expect(parseJobRisk({ level: "HIGH", reasons: [] })).toEqual({ level: "HIGH", reasons: [] })
  })

  it("returns null when reasons is not an array", () => {
    expect(parseJobRisk({ level: "HIGH", reasons: "Asks for a fee" })).toBeNull()
    expect(parseJobRisk({ level: "HIGH" })).toBeNull()
  })

  it("returns null for non-object values", () => {
    expect(parseJobRisk("HIGH")).toBeNull()
    expect(parseJobRisk(["HIGH"])).toBeNull()
  })
})
