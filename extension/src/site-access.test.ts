import { describe, expect, it } from "vitest"
import { hostLabelFor, isReadableUrl, originPatternFor, planBlockedRead } from "./site-access"

describe("originPatternFor", () => {
  it("narrows an https page to its origin", () => {
    expect(originPatternFor("https://jobs.example.com/postings/123?utm=x#top")).toBe(
      "https://jobs.example.com/*",
    )
  })

  it("keeps the port so a grant does not cover every service on the host", () => {
    expect(originPatternFor("http://localhost:8899/clean-jsonld.html")).toBe(
      "http://localhost:8899/*",
    )
  })

  it("treats a subdomain as its own origin", () => {
    expect(originPatternFor("https://careers.example.com/a")).toBe("https://careers.example.com/*")
    expect(originPatternFor("https://example.com/a")).toBe("https://example.com/*")
  })

  it("returns null for pages Chrome never lets an extension read", () => {
    expect(originPatternFor("chrome://version")).toBeNull()
    expect(originPatternFor("chrome-extension://abcdef/sidepanel.html")).toBeNull()
    expect(originPatternFor("about:blank")).toBeNull()
    expect(originPatternFor("edge://settings")).toBeNull()
    expect(originPatternFor("file:///C:/tmp/job.html")).toBeNull()
    expect(originPatternFor("view-source:https://example.com/")).toBeNull()
  })

  it("returns null for garbage and for nothing at all", () => {
    expect(originPatternFor("not a url")).toBeNull()
    expect(originPatternFor("")).toBeNull()
    expect(originPatternFor(undefined)).toBeNull()
    expect(originPatternFor(null)).toBeNull()
    expect(originPatternFor("https:///")).toBeNull()
  })
})

describe("isReadableUrl", () => {
  it("is true only for http and https pages", () => {
    expect(isReadableUrl("https://example.com/a")).toBe(true)
    expect(isReadableUrl("http://localhost:8899/a")).toBe(true)
    expect(isReadableUrl("chrome://version")).toBe(false)
    expect(isReadableUrl("chrome-extension://abcdef/sidepanel.html")).toBe(false)
    expect(isReadableUrl("about:blank")).toBe(false)
    expect(isReadableUrl("nonsense")).toBe(false)
    expect(isReadableUrl(undefined)).toBe(false)
  })
})

describe("hostLabelFor", () => {
  it("names the host the user is asked to allow", () => {
    expect(hostLabelFor("https://jobs.example.com/x")).toBe("jobs.example.com")
    expect(hostLabelFor("http://localhost:8899/x")).toBe("localhost:8899")
    expect(hostLabelFor("chrome://version")).toBeNull()
  })
})

describe("planBlockedRead", () => {
  const pageB = "https://boards.example.com/jobs/42"

  it("clears the whole form when a replacing read of an ungranted page is blocked", () => {
    // Clip page A, switch to ungranted page B: B's link must not sit next to A's fields.
    expect(
      planBlockedRead({ url: pageB, granted: false, clearFirst: true, currentLink: "https://a.example.com/1" }),
    ).toEqual({ reason: "needs-grant", clearForm: true, link: pageB })
  })

  it("leaves a filled link alone when a non-replacing read is blocked", () => {
    expect(
      planBlockedRead({ url: pageB, granted: false, clearFirst: false, currentLink: "https://a.example.com/1" }),
    ).toEqual({ reason: "needs-grant", clearForm: false, link: null })
  })

  it("fills an empty link when a non-replacing read is blocked", () => {
    expect(planBlockedRead({ url: pageB, granted: false, clearFirst: false, currentLink: "  " })).toEqual({
      reason: "needs-grant",
      clearForm: false,
      link: pageB,
    })
  })

  it("calls a granted http(s) page that still fails unreadable, not a browser page", () => {
    expect(
      planBlockedRead({
        url: "https://chromewebstore.google.com/detail/x",
        granted: true,
        clearFirst: true,
        currentLink: "",
      }).reason,
    ).toBe("unreadable")
  })

  it("never writes a browser-owned URL as the job link", () => {
    expect(planBlockedRead({ url: "chrome://newtab", granted: false, clearFirst: true, currentLink: "x" })).toEqual({
      reason: "browser-page",
      clearForm: true,
      link: null,
    })
    expect(planBlockedRead({ url: undefined, granted: false, clearFirst: false, currentLink: "" })).toEqual({
      reason: "browser-page",
      clearForm: false,
      link: null,
    })
  })
})
