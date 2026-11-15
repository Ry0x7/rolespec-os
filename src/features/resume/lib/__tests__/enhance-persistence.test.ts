import { describe, it, expect, beforeEach } from "vitest"
import type { EnhanceSuggestion } from "../../hooks/use-resume-store"
import {
  ENHANCE_STATE_VERSION,
  clearEnhanceState,
  enhanceStateKey,
  loadEnhanceState,
  saveEnhanceState,
} from "../enhance-persistence"

const row: EnhanceSuggestion = {
  id: "s1::i1::b0",
  sectionId: "s1",
  itemId: "i1",
  field: "bullet",
  action: "rewrite",
  bulletIndex: 0,
  original: "Old",
  suggested: "New",
  reason: "Clearer",
  status: "applied",
}

const put = (value: unknown) =>
  window.localStorage.setItem(enhanceStateKey("r1"), JSON.stringify(value))

describe("enhance-persistence", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("keys state per resume", () => {
    expect(enhanceStateKey("abc")).toBe("rolespec:enhance:abc")
  })

  it("round-trips suggestions, grounding and focus", () => {
    const grounding = [{ keyword: "Go", verdict: "unsupported" as const, reason: "Absent" }]
    saveEnhanceState("r1", { suggestions: [row], grounding, focus: { sectionId: "s1" } })

    const raw = JSON.parse(window.localStorage.getItem(enhanceStateKey("r1"))!)
    expect(raw.v).toBe(ENHANCE_STATE_VERSION)
    expect(typeof raw.savedAt).toBe("string")
    expect(loadEnhanceState("r1")).toEqual({
      suggestions: [row],
      grounding,
      focus: { sectionId: "s1" },
    })
  })

  it("returns null when nothing is stored", () => {
    expect(loadEnhanceState("r1")).toBeNull()
  })

  it("returns null on malformed JSON without throwing", () => {
    window.localStorage.setItem(enhanceStateKey("r1"), "{nope")
    expect(loadEnhanceState("r1")).toBeNull()
  })

  it("returns null for a different version", () => {
    put({ v: 2, suggestions: [row], grounding: [], focus: null })
    expect(loadEnhanceState("r1")).toBeNull()
  })

  it("returns null for the wrong shape", () => {
    put({ v: 1, suggestions: "nope" })
    expect(loadEnhanceState("r1")).toBeNull()
    put([row])
    expect(loadEnhanceState("r1")).toBeNull()
  })

  it("drops malformed rows and returns null when none are valid", () => {
    put({
      v: 1,
      suggestions: [
        row,
        { ...row, id: 7 },
        { ...row, status: "rejected" },
        { ...row, action: "replace" },
        null,
      ],
      grounding: [{ keyword: "Go" }],
      focus: { sectionId: 3 },
    })
    expect(loadEnhanceState("r1")).toEqual({ suggestions: [row], grounding: [], focus: null })

    put({ v: 1, suggestions: [{ ...row, original: null }], grounding: [], focus: null })
    expect(loadEnhanceState("r1")).toBeNull()
  })

  it("clears only the given resume's key", () => {
    saveEnhanceState("r1", { suggestions: [row], grounding: [], focus: null })
    saveEnhanceState("r2", { suggestions: [row], grounding: [], focus: null })

    clearEnhanceState("r1")

    expect(loadEnhanceState("r1")).toBeNull()
    expect(loadEnhanceState("r2")).not.toBeNull()
  })
})
