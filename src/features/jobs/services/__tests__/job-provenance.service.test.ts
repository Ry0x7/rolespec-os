import { describe, it, expect } from "vitest"

import { describeJobProvenance, type JobProvenanceInput } from "../job-provenance.service"

const INPUT: JobProvenanceInput = {
  sourceProvider: null,
  source: "MANUAL",
  postedAt: new Date("2026-09-08T12:00:00.000Z"),
  discoveredAt: null,
  jobCreatedAt: new Date("2026-09-01T12:00:00.000Z"),
  savedAt: new Date("2026-09-10T12:00:00.000Z"),
}

describe("describeJobProvenance", () => {
  it("ends with the Saved segment by default", () => {
    expect(describeJobProvenance(INPUT)).toMatch(/^Added manually · Posted .+ · Saved .+$/)
  })

  it("drops the Saved segment when includeSaved is false", () => {
    const line = describeJobProvenance(INPUT, { includeSaved: false })
    expect(line).toMatch(/^Added manually · Posted [^·]+$/)
    expect(line).not.toMatch("Saved")
  })
})
