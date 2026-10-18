import { describe, expect, it } from "vitest"

import { deriveLocationFromHost, descriptionStatesRestriction } from "../market-fit.service"

describe("deriveLocationFromHost", () => {
  it("labels a PH-only board host as Philippines", () => {
    expect(deriveLocationFromHost("https://bossjob.ph/en-us/job/web-developer-remote-500169")).toBe(
      "Philippines"
    )
    expect(deriveLocationFromHost("https://ph.jobstreet.com/job/12345")).toBe("Philippines")
    expect(deriveLocationFromHost("https://onlinejobs.ph/jobseekers/job/1")).toBe("Philippines")
  })

  it("ignores the www. prefix the same board sometimes carries", () => {
    expect(deriveLocationFromHost("https://www.kalibrr.com/c/acme/jobs/1")).toBe("Philippines")
    expect(deriveLocationFromHost("https://www.onlinejobs.ph/jobseekers/job/1")).toBe(
      "Philippines"
    )
  })

  it("returns null for a host that publishes for no single market", () => {
    expect(deriveLocationFromHost("https://boards.greenhouse.io/x/jobs/1")).toBeNull()
    expect(deriveLocationFromHost("https://www.indeed.com/viewjob?jk=1")).toBeNull()
  })

  it("returns null for a missing, empty or malformed url", () => {
    expect(deriveLocationFromHost(null)).toBeNull()
    expect(deriveLocationFromHost(undefined)).toBeNull()
    expect(deriveLocationFromHost("")).toBeNull()
    expect(deriveLocationFromHost("not a url")).toBeNull()
  })
})

describe("descriptionStatesRestriction", () => {
  it("is true when the description states an other-market restriction", () => {
    expect(descriptionStatesRestriction("This role is US only. We cannot hire elsewhere.")).toBe(
      true
    )
    expect(descriptionStatesRestriction("Remote, USA only.")).toBe(true)
  })

  it("is false for a description that states no restriction", () => {
    expect(
      descriptionStatesRestriction("Our office is in Berlin and we meet twice a year.")
    ).toBe(false)
  })

  it("is false for a missing or empty description", () => {
    expect(descriptionStatesRestriction(null)).toBe(false)
    expect(descriptionStatesRestriction(undefined)).toBe(false)
    expect(descriptionStatesRestriction("")).toBe(false)
  })
})
