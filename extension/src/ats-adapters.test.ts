import { describe, expect, it } from "vitest"

import {
  ATS_ADAPTERS,
  detectAtsAdapter,
  fillingLabel,
} from "./ats-adapters"

describe("ATS adapters", () => {
  it.each([
    ["https://boards.greenhouse.io/acme/jobs/1", "greenhouse"],
    ["https://jobs.lever.co/acme/123", "lever"],
    ["https://jobs.ashbyhq.com/acme/123", "ashby"],
    ["https://apply.workable.com/acme/j/ABC", "workable"],
    ["https://acme.bamboohr.com/careers/1", "bamboohr"],
    ["https://jobs.smartrecruiters.com/Acme/123", "smartrecruiters"],
    ["https://acme.wd3.myworkdayjobs.com/External/job/1", "workday"],
    ["https://acme.icims.com/jobs/1/apply", "icims"],
    ["https://acme.taleo.net/careersection/1/jobdetail.ftl", "taleo"],
  ])("detects %s as %s", (url, expected) => {
    expect(detectAtsAdapter(url)?.key).toBe(expected)
  })

  it.each([
    "https://example.com/careers",
    "https://greenhouse.io.evil.example/jobs/1",
    "https://notgreenhouse.io/jobs/1",
    "chrome://extensions",
    "file:///C:/form.html",
    "",
    null,
  ])("rejects %s", (url) => {
    expect(detectAtsAdapter(url)).toBeNull()
  })

  it("keeps ingestion and form filling as separate capabilities", () => {
    for (const adapter of ATS_ADAPTERS) {
      if (adapter.key === "generic") continue
      expect(adapter.ingestion).toBe(true)
      expect(adapter.note.length).toBeGreaterThan(0)
    }
    const taleo = ATS_ADAPTERS.find((adapter) => adapter.key === "taleo")
    expect(taleo?.formFilling).toBe("manual")
    expect(fillingLabel(taleo?.formFilling ?? "manual")).toContain("manual fallback")
  })
})
