import { describe, it, expect } from "vitest"
import { findMatchingSectionId } from "../match-issue-section"
import type { Section } from "../../hooks/use-resume-store"

function section(overrides: Partial<Section>): Section {
  return {
    id: "s1",
    resumeId: "r1",
    type: "SUMMARY",
    title: "Summary",
    order: 0,
    visible: true,
    items: [],
    ...overrides,
  }
}

describe("findMatchingSectionId", () => {
  it("matches by title, case-insensitively and trimmed", () => {
    const sections = [section({ id: "sum-1", title: "Summary" })]
    expect(findMatchingSectionId(sections, "  summary ")).toBe("sum-1")
  })

  it("falls back to matching by section type when no title matches", () => {
    const sections = [section({ id: "exp-1", type: "EXPERIENCE", title: "Work History" })]
    expect(findMatchingSectionId(sections, "experience")).toBe("exp-1")
  })

  it("returns null when nothing matches, when the issue names no section, or when sections are missing", () => {
    const sections = [section({ id: "sum-1", title: "Summary" })]
    expect(findMatchingSectionId(sections, "Nonexistent Section")).toBeNull()
    expect(findMatchingSectionId(sections, undefined)).toBeNull()
    expect(findMatchingSectionId(sections, "")).toBeNull()
    expect(findMatchingSectionId(undefined, "Summary")).toBeNull()
  })
})
