import { describe, expect, it } from "vitest"

import {
  EMPTY_SUPPORT_PROMPT_STATE,
  SUPPORT_PROMPT_MIN_DAYS,
  answerSupportPrompt,
  parseSupportPromptState,
  recordVisit,
  shouldShowSupportPrompt,
} from "../support-prompt"

const day = (n: number) => new Date(2026, 10, n, 12)

function visitedOn(...days: number[]) {
  return days.reduce((state, n) => recordVisit(state, day(n)), EMPTY_SUPPORT_PROMPT_STATE)
}

describe("support prompt", () => {
  it("waits for a few different days of use, counting each day once", () => {
    expect(shouldShowSupportPrompt(visitedOn(1, 1, 1, 2), day(2))).toBe(false)
    expect(visitedOn(1, 2, 3).days).toHaveLength(SUPPORT_PROMPT_MIN_DAYS)
    expect(shouldShowSupportPrompt(visitedOn(1, 2, 3), day(3))).toBe(true)
  })

  it("keeps only the last few days", () => {
    expect(visitedOn(1, 2, 3, 4, 5).days).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"])
  })

  it("snoozes after Maybe later and much longer after a visit to Ko-fi", () => {
    const later = answerSupportPrompt(visitedOn(1, 2, 3), "LATER", day(3))
    expect(shouldShowSupportPrompt(later, day(20))).toBe(false)
    expect(shouldShowSupportPrompt(later, new Date(2026, 11, 10))).toBe(true)

    const supported = answerSupportPrompt(visitedOn(1, 2, 3), "SUPPORTED", day(3))
    expect(shouldShowSupportPrompt(supported, new Date(2027, 2, 1))).toBe(false)
    expect(shouldShowSupportPrompt(supported, new Date(2027, 5, 1))).toBe(true)
  })

  it("never asks again after Don't show again", () => {
    const never = answerSupportPrompt(visitedOn(1, 2, 3), "NEVER", day(3))
    expect(shouldShowSupportPrompt(never, new Date(2030, 0, 1))).toBe(false)
  })

  it("reads damaged storage as a fresh start", () => {
    expect(parseSupportPromptState("{not json")).toEqual(EMPTY_SUPPORT_PROMPT_STATE)
    expect(parseSupportPromptState(JSON.stringify({ days: [1, "2026-11-01"], never: "yes" }))).toEqual({
      days: ["2026-11-01"],
      snoozedUntil: null,
      never: false,
    })
  })
})
