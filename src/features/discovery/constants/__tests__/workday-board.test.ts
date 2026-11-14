import { describe, it, expect } from "vitest"

import { parseWorkdayBoardUrl, parseWorkdayExternalPath } from "../workday-board"

describe("parseWorkdayBoardUrl", () => {
  it("takes a board URL apart into tenant, data centre and site", () => {
    expect(parseWorkdayBoardUrl("https://globe.wd3.myworkdayjobs.com/GLB_Careers")).toEqual({
      tenant: "globe",
      wd: "wd3",
      site: "GLB_Careers",
      boardUrl: "https://globe.wd3.myworkdayjobs.com/GLB_Careers",
    })
  })

  it.each([
    "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers",
    "https://globe.wd3.myworkdayjobs.com/GLB_Careers/",
    "https://GLOBE.WD3.MyWorkdayJobs.com/GLB_Careers",
    "  https://globe.wd3.myworkdayjobs.com/GLB_Careers  ",
    "globe.wd3.myworkdayjobs.com/GLB_Careers",
    "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/26F-The-Globe-Tower/AI-Engineer_R0000021435",
  ])("reduces %p to the same canonical board", (raw) => {
    expect(parseWorkdayBoardUrl(raw)?.boardUrl).toBe(
      "https://globe.wd3.myworkdayjobs.com/GLB_Careers"
    )
  })

  it("keeps the site id's case, which Workday is sensitive to", () => {
    expect(parseWorkdayBoardUrl("https://globe.wd3.myworkdayjobs.com/glb_careers")?.site).toBe(
      "glb_careers"
    )
  })

  it.each([
    "",
    "   ",
    "not a url",
    "https://example.com/careers",
    "https://globe.myworkdayjobs.com/GLB_Careers",
    "https://globe.wdX.myworkdayjobs.com/GLB_Careers",
    "https://globe.wd3.myworkdayjobs.com.evil.com/GLB_Careers",
    "https://globe.wd3.myworkdayjobs.com",
    "https://globe.wd3.myworkdayjobs.com/en-US",
    "http://globe.wd3.myworkdayjobs.com/GLB_Careers",
    "javascript:alert(1)",
    `https://globe.wd3.myworkdayjobs.com/${"a".repeat(400)}`,
  ])("refuses %p", (raw) => {
    expect(parseWorkdayBoardUrl(raw)).toBeNull()
  })
})

describe("parseWorkdayExternalPath", () => {
  it("returns the `/job/...` tail, with or without a locale segment", () => {
    expect(
      parseWorkdayExternalPath(
        new URL(
          "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/26F-The-Globe-Tower/AI-Engineer_R0000021435"
        )
      )
    ).toBe("/job/26F-The-Globe-Tower/AI-Engineer_R0000021435")

    expect(
      parseWorkdayExternalPath(
        new URL(
          "https://globe.wd3.myworkdayjobs.com/GLB_Careers/job/26F-The-Globe-Tower/AI-Engineer_R0000021435"
        )
      )
    ).toBe("/job/26F-The-Globe-Tower/AI-Engineer_R0000021435")
  })

  it.each([
    "https://globe.wd3.myworkdayjobs.com/GLB_Careers",
    "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers",
    "https://globe.wd3.myworkdayjobs.com/GLB_Careers/job",
    "https://globe.wd3.myworkdayjobs.com/GLB_Careers/job/only-one",
    "https://globe.wd3.myworkdayjobs.com/GLB_Careers/search/something/else",
  ])("returns null for %p, which does not name one posting", (raw) => {
    expect(parseWorkdayExternalPath(new URL(raw))).toBeNull()
  })
})
