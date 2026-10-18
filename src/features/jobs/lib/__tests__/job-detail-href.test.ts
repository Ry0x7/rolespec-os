import { describe, it, expect } from "vitest"

import { jobDetailHref } from "../job-detail-href"

describe("jobDetailHref", () => {
  it("opens the page top with no section", () => {
    expect(jobDetailHref("app-1")).toBe("/jobs/app-1")
  })

  it("deep-links to a section", () => {
    expect(jobDetailHref("app-1", "track")).toBe("/jobs/app-1#track")
    expect(jobDetailHref("app-1", "decide")).toBe("/jobs/app-1#decide")
    expect(jobDetailHref("app-1", "prepare")).toBe("/jobs/app-1#prepare")
  })
})
