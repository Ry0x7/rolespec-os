import { describe, expect, it } from "vitest"
import { badgeEnableState } from "./badge-enable"

describe("badgeEnableState", () => {
  it("offers the button on a supported board without a grant", () => {
    expect(
      badgeEnableState({ url: "https://ph.jobstreet.com/nurse-jobs", granted: false }),
    ).toEqual({ show: true, host: "ph.jobstreet.com", pattern: "https://ph.jobstreet.com/*" })
  })

  it("hides the button once the board is granted", () => {
    expect(
      badgeEnableState({ url: "https://www.linkedin.com/jobs/view/123", granted: true }),
    ).toEqual({ show: false, host: "www.linkedin.com", pattern: "https://www.linkedin.com/*" })
  })

  it("hides the button on an unsupported site, granted or not", () => {
    for (const granted of [false, true]) {
      expect(badgeEnableState({ url: "https://jobs.example.com/postings/1", granted })).toEqual({
        show: false,
        host: null,
        pattern: null,
      })
    }
  })

  it("hides the button on non-http pages and missing URLs", () => {
    for (const url of [
      "chrome://extensions",
      "chrome-extension://abcdef/sidepanel.html",
      "about:blank",
      "file:///C:/tmp/jobstreet.com.html",
      "",
      undefined,
      null,
    ]) {
      expect(badgeEnableState({ url, granted: false })).toEqual({
        show: false,
        host: null,
        pattern: null,
      })
    }
  })
})
