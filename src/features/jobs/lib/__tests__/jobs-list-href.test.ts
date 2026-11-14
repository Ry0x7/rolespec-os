import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  JOBS_LIST_HREF_STORAGE_KEY,
  rememberJobsListHref,
  resolveBackToJobsHref,
} from "../jobs-list-href"

const ORIGIN = window.location.origin

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("resolveBackToJobsHref", () => {
  it("uses a same-origin /jobs referrer with its query", () => {
    expect(
      resolveBackToJobsHref({
        storedHref: null,
        referrer: `${ORIGIN}/jobs?status=APPLIED&sort=confidence`,
        origin: ORIGIN,
      }),
    ).toBe("/jobs?status=APPLIED&sort=confidence")
  })

  it("ignores a cross-origin referrer", () => {
    expect(
      resolveBackToJobsHref({
        storedHref: null,
        referrer: "https://evil.example/jobs?status=APPLIED",
        origin: ORIGIN,
      }),
    ).toBe("/jobs")
  })

  it("ignores a referrer that is not the list", () => {
    for (const referrer of [`${ORIGIN}/dashboard`, `${ORIGIN}/jobs/abc`, "", "not a url"]) {
      expect(resolveBackToJobsHref({ storedHref: null, referrer, origin: ORIGIN })).toBe("/jobs")
    }
  })

  it("prefers the stored list URL over the referrer", () => {
    expect(
      resolveBackToJobsHref({
        storedHref: "/jobs?q=acme",
        referrer: `${ORIGIN}/jobs?status=APPLIED`,
        origin: ORIGIN,
      }),
    ).toBe("/jobs?q=acme")
  })

  it("ignores a stored value that is not the list on this origin", () => {
    for (const storedHref of ["/dashboard", "https://evil.example/jobs?q=x", "//evil.example/jobs"]) {
      expect(resolveBackToJobsHref({ storedHref, referrer: "", origin: ORIGIN })).toBe("/jobs")
    }
  })
})

describe("rememberJobsListHref", () => {
  it("stores the list URL in sessionStorage", () => {
    rememberJobsListHref("/jobs?status=APPLIED")
    expect(window.sessionStorage.getItem(JOBS_LIST_HREF_STORAGE_KEY)).toBe("/jobs?status=APPLIED")
  })

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })
    expect(() => rememberJobsListHref("/jobs")).not.toThrow()
  })
})
