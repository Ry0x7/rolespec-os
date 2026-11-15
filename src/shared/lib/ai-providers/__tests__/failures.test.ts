import { describe, expect, it } from "vitest"

import { describeAiFailure } from "../failures"

describe("describeAiFailure", () => {
  it("explains an unauthenticated CLI instead of leaking its output", () => {
    expect(describeAiFailure(new Error("Not logged in · Please run /login"))).toMatch(
      /not signed in/i
    )
  })

  it("explains a rejected API key", () => {
    expect(describeAiFailure(new Error("401 Incorrect API key provided"))).toMatch(
      /API key/i
    )
  })

  it("explains a missing provider binary", () => {
    expect(describeAiFailure(new Error("spawn claude ENOENT"))).toMatch(/not installed/i)
  })

  it("explains a rate limit", () => {
    expect(describeAiFailure(new Error("429 Too Many Requests"))).toMatch(/rate limiting/i)
  })

  it("returns null for an unknown failure so callers keep their generic message", () => {
    expect(describeAiFailure(new Error("socket hang up"))).toBeNull()
    expect(describeAiFailure(undefined)).toBeNull()
  })
})
