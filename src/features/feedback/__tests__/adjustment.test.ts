import { describe, expect, it } from "vitest"

import { applyFeedbackAdjustment, feedbackAdjustment } from "../adjustment"
import { FEEDBACK_LABELS, FEEDBACK_VERDICTS } from "../types"

describe("feedbackAdjustment", () => {
  it("returns nothing when the user has not judged the posting", () => {
    expect(feedbackAdjustment(null)).toBeNull()
    expect(feedbackAdjustment(undefined)).toBeNull()
  })

  it("maps every verdict to a fixed, named adjustment", () => {
    for (const verdict of FEEDBACK_VERDICTS) {
      const adjustment = feedbackAdjustment(verdict)!
      expect(adjustment.verdict).toBe(verdict)
      expect(adjustment.label).toContain(FEEDBACK_LABELS[verdict])
    }
  })

  it("never turns a rejection into evidence of a missing skill", () => {
    const adjustment = feedbackAdjustment("REJECTED")!
    expect(adjustment.points).toBe(0)
    expect(applyFeedbackAdjustment(62, adjustment)).toBe(62)
    expect(adjustment.label).toContain("not evidence")
  })

  it("lowers an explicitly irrelevant posting and raises an offer", () => {
    expect(applyFeedbackAdjustment(70, feedbackAdjustment("IRRELEVANT"))).toBe(60)
    expect(applyFeedbackAdjustment(70, feedbackAdjustment("OFFERED"))).toBe(78)
  })

  it("clamps the adjusted composite to 0-100", () => {
    expect(applyFeedbackAdjustment(5, feedbackAdjustment("IRRELEVANT"))).toBe(0)
    expect(applyFeedbackAdjustment(98, feedbackAdjustment("OFFERED"))).toBe(100)
    expect(applyFeedbackAdjustment(120, null)).toBe(100)
    expect(applyFeedbackAdjustment(-5, null)).toBe(0)
  })
})
