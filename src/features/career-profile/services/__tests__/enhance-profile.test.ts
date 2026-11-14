// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ generateObjectTracked: vi.fn() }))

vi.mock("@/shared/lib/ai-generate", () => ({
  AI_USAGE_FEATURES: { PROFILE_ENHANCE: "career.profile_enhance" },
  generateObjectTracked: mocks.generateObjectTracked,
}))

import { enhanceProfileText } from "../enhance-profile"

const BASE = {
  userId: "user_1",
  field: "careerGoals" as const,
  text: "  want to be like a manager maybe  ",
}

function respond(object: { improved: string | null; unchanged: boolean }) {
  mocks.generateObjectTracked.mockResolvedValue({ object })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("enhanceProfileText", () => {
  it("returns the tightened text and routes the call to the light tier", async () => {
    respond({ improved: "Move into engineering management.", unchanged: false })

    const result = await enhanceProfileText(BASE)

    expect(result).toEqual({
      improved: "Move into engineering management.",
      unchanged: false,
    })
    const call = mocks.generateObjectTracked.mock.calls[0][0]
    expect(call.tier).toBe("light")
    expect(call.tracking).toEqual({
      feature: "career.profile_enhance",
      surface: "app",
      userId: "user_1",
    })
  })

  it.each([
    ["the model says unchanged", { improved: "Something else", unchanged: true }],
    ["the model returns null", { improved: null, unchanged: false }],
    ["the model returns blank text", { improved: "   ", unchanged: false }],
    [
      "the rewrite is identical",
      { improved: "want to be like a manager maybe", unchanged: false },
    ],
  ])("falls back to the user's own text when %s", async (_case, object) => {
    respond(object)

    await expect(enhanceProfileText(BASE)).resolves.toEqual({
      improved: "want to be like a manager maybe",
      unchanged: true,
    })
  })

  it("caps the stored text at the field length", async () => {
    respond({ improved: "x".repeat(6000), unchanged: false })

    const result = await enhanceProfileText(BASE)

    expect(result.improved).toHaveLength(5000)
    expect(result.unchanged).toBe(false)
  })

  it("fences the user's text rather than splicing it into the instructions", async () => {
    respond({ improved: "Clearer goals.", unchanged: false })

    await enhanceProfileText(BASE)

    const { prompt } = mocks.generateObjectTracked.mock.calls[0][0]
    expect(prompt).toContain("PROFILE_TEXT")
    expect(prompt).toContain("want to be like a manager maybe")
  })
})
