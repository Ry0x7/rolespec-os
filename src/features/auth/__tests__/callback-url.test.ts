// @vitest-environment node
import { describe, it, expect } from "vitest"

import { DEFAULT_SIGN_IN_REDIRECT, safeCallbackUrl } from "../callback-url"

describe("safeCallbackUrl", () => {
  it.each([
    "/dashboard",
    "/extension/connect?state=abcdefgh&redirect_uri=https%3A%2F%2Fx.chromiumapp.org%2F",
    "/resumes/123?jobId=456",
    "/",
  ])("keeps the same-origin path %o", (value) => {
    expect(safeCallbackUrl(value)).toBe(value)
  })

  it.each([
    ["an absolute URL", "https://evil.com/"],
    ["a protocol-relative URL", "//evil.com/"],
    ["a backslash protocol-relative URL", "/\\evil.com/"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,x"],
    ["a bare path with no slash", "dashboard"],
    ["an empty string", ""],
    ["a leading newline", "\n//evil.com"],
    ["an embedded tab", "/dash\tboard"],
  ])("falls back for %s", (_label, value) => {
    expect(safeCallbackUrl(value)).toBe(DEFAULT_SIGN_IN_REDIRECT)
  })

  it.each([undefined, null, 42, {}, ["/dashboard"]])("falls back for the non-string %o", (value) => {
    expect(safeCallbackUrl(value)).toBe(DEFAULT_SIGN_IN_REDIRECT)
  })

  it("falls back for an over-long value", () => {
    expect(safeCallbackUrl(`/${"a".repeat(2100)}`)).toBe(DEFAULT_SIGN_IN_REDIRECT)
  })

  it("honours a caller-supplied fallback", () => {
    expect(safeCallbackUrl("https://evil.com", "/onboarding")).toBe("/onboarding")
  })
})
