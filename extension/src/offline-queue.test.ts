import { describe, expect, it } from "vitest"
import {
  MAX_PENDING_CLIPS,
  coercePendingClips,
  pendingLabel,
  withQueuedClip,
  withoutQueuedClip,
} from "./offline-queue"

describe("coercePendingClips", () => {
  it("drops malformed rows and caps the list", () => {
    const rows = [
      { companyName: "Acme", jobTitle: "Eng" },
      { companyName: "", jobTitle: "Eng" },
      null,
      { companyName: "Globex", jobTitle: "Designer", queuedAt: "2026-01-01", attempts: 2 },
    ]
    expect(coercePendingClips(rows)).toHaveLength(2)
    expect(coercePendingClips("nope")).toEqual([])
  })
})

describe("withQueuedClip", () => {
  it("caps at MAX_PENDING_CLIPS keeping the newest", () => {
    const existing = Array.from({ length: MAX_PENDING_CLIPS }, (_, i) => ({
      companyName: `Co ${i}`,
      jobTitle: "Eng",
      queuedAt: "2026-01-01",
      attempts: 0,
    }))
    const next = withQueuedClip(existing, { companyName: "New", jobTitle: "Eng" })
    expect(next).toHaveLength(MAX_PENDING_CLIPS)
    expect(next[next.length - 1]?.companyName).toBe("New")
  })
})

describe("withoutQueuedClip + pendingLabel", () => {
  it("removes by index and pluralizes", () => {
    const rows = [
      { companyName: "A", jobTitle: "Eng", queuedAt: "x", attempts: 0 },
      { companyName: "B", jobTitle: "Eng", queuedAt: "x", attempts: 0 },
    ]
    expect(withoutQueuedClip(rows, 0)).toHaveLength(1)
    expect(pendingLabel(1)).toBe("1 job waiting to retry")
    expect(pendingLabel(3)).toBe("3 jobs waiting to retry")
  })
})
