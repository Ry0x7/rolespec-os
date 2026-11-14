import { describe, expect, it } from "vitest"
import {
  GUIDED_TOUR_STEPS,
  GUIDED_TOUR_STORAGE_KEY,
  tourTargetForHref,
} from "../guided-tour"

describe("guided tour", () => {
  it("keeps a stable sidebar target for every tour stop", () => {
    expect(tourTargetForHref("/career-profile")).toBe("nav-career")
    expect(tourTargetForHref("/jobs")).toBe("nav-jobs")
    expect(tourTargetForHref("/workspace")).toBe("nav-workspace")
    expect(tourTargetForHref("/settings")).toBe("nav-settings")
    expect(tourTargetForHref("/dashboard")).toBeUndefined()
  })

  it("has a target for each stop except the finish card", () => {
    expect(GUIDED_TOUR_STEPS).toHaveLength(5)
    expect(GUIDED_TOUR_STEPS.at(-1)?.target).toBeNull()
    for (const step of GUIDED_TOUR_STEPS.slice(0, -1)) {
      expect(step.target).toMatch(/^\[data-tour="nav-/)
    }
  })

  it("uses a versioned storage key so old choices do not hide a new tour", () => {
    expect(GUIDED_TOUR_STORAGE_KEY).toBe("rolespec-tour")
  })
})
