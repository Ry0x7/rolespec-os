import { describe, it, expect } from "vitest"

import { looksLikeUrl, normalizeUrl, displayUrl, parseLinkValue } from "../url"

describe("looksLikeUrl", () => {
  it("accepts protocol, www and bare domains", () => {
    expect(looksLikeUrl("https://example.com")).toBe(true)
    expect(looksLikeUrl("HTTP://example.com")).toBe(true)
    expect(looksLikeUrl("www.example.com")).toBe(true)
    expect(looksLikeUrl("linkedin.com/in/johndoe")).toBe(true)
    expect(looksLikeUrl("  johndoe.dev  ")).toBe(true)
  })

  it("rejects plain text and empty values", () => {
    expect(looksLikeUrl("")).toBe(false)
    expect(looksLikeUrl("   ")).toBe(false)
    expect(looksLikeUrl("John Doe")).toBe(false)
    expect(looksLikeUrl("San Francisco, CA")).toBe(false)
  })
})

describe("normalizeUrl", () => {
  it("adds https:// when the protocol is missing", () => {
    expect(normalizeUrl("linkedin.com/in/johndoe")).toBe("https://linkedin.com/in/johndoe")
    expect(normalizeUrl("www.johndoe.dev")).toBe("https://www.johndoe.dev")
  })

  it("preserves an existing protocol", () => {
    expect(normalizeUrl("https://johndoe.dev")).toBe("https://johndoe.dev")
    expect(normalizeUrl("http://johndoe.dev")).toBe("http://johndoe.dev")
  })

  it("trims and keeps empty input empty", () => {
    expect(normalizeUrl("  johndoe.dev ")).toBe("https://johndoe.dev")
    expect(normalizeUrl("")).toBe("")
    expect(normalizeUrl("   ")).toBe("")
  })
})

describe("displayUrl", () => {
  it("strips protocol, www and trailing slash", () => {
    expect(displayUrl("https://www.linkedin.com/in/johndoe/")).toBe("linkedin.com/in/johndoe")
    expect(displayUrl("http://johndoe.dev/")).toBe("johndoe.dev")
    expect(displayUrl("www.github.com/johndoe")).toBe("github.com/johndoe")
    expect(displayUrl("github.com/johndoe")).toBe("github.com/johndoe")
  })

  it("handles empty input", () => {
    expect(displayUrl("")).toBe("")
    expect(displayUrl("  ")).toBe("")
  })
})

describe("parseLinkValue", () => {
  it("returns a display label and absolute href for plain URLs", () => {
    expect(parseLinkValue("linkedin.com/in/johndoe")).toEqual({
      label: "linkedin.com/in/johndoe",
      href: "https://linkedin.com/in/johndoe",
    })
    expect(parseLinkValue("https://www.johndoe.dev/")).toEqual({
      label: "johndoe.dev",
      href: "https://www.johndoe.dev/",
    })
  })

  it("degrades markdown link artifacts into label + href", () => {
    expect(parseLinkValue("[My LinkedIn](https://linkedin.com/in/johndoe)")).toEqual({
      label: "My LinkedIn",
      href: "https://linkedin.com/in/johndoe",
    })
  })

  it("shortens a URL-looking markdown label", () => {
    expect(parseLinkValue("[https://www.github.com/johndoe/](https://www.github.com/johndoe/)")).toEqual({
      label: "github.com/johndoe",
      href: "https://www.github.com/johndoe/",
    })
  })

  it("never leaks brackets for markdown artifacts", () => {
    const { label } = parseLinkValue("[Portfolio](https://johndoe.dev)")
    expect(label).not.toContain("[")
    expect(label).not.toContain("]")
    expect(label).not.toContain("(")
  })

  it("falls back to plain text with no href for non-URLs", () => {
    expect(parseLinkValue("ask me for my profile")).toEqual({
      label: "ask me for my profile",
      href: "",
    })
  })

  it("handles empty input", () => {
    expect(parseLinkValue("")).toEqual({ label: "", href: "" })
  })
})
