// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  contactValuesMatch,
  dedupeDrafts,
  fingerprintFor,
  normalizeUrl,
  skillKey,
} from "../lib/patch-fingerprint"
import type { IntakePatchDraft, IntakeProvenance } from "../types"

const provenance: IntakeProvenance = {
  adapter: "test",
  sourceUrl: null,
  fileName: null,
  externalId: null,
  locator: null,
  fetchedAt: "2026-11-11T12:00:00.000Z",
  detail: null,
}

function skill(name: string, confidence = 70): IntakePatchDraft {
  return {
    kind: "SKILL",
    data: { name, category: null },
    confidence,
    provenance,
  }
}

function evidence(title: string, organization: string | null, startDate: string | null) {
  return {
    kind: "EVIDENCE" as const,
    data: {
      evidenceKind: "EXPERIENCE" as const,
      title,
      organization,
      details: null,
      outcome: null,
      startDate,
      endDate: null,
    },
    confidence: 70,
    provenance,
  }
}

describe("skillKey", () => {
  it("collapses Node.js, NodeJS and node js", () => {
    expect(skillKey("Node.js")).toBe(skillKey("NodeJS"))
    expect(skillKey("node js")).toBe(skillKey("Node.js"))
  })

  it("keeps C, C++ and C# distinct", () => {
    expect(new Set([skillKey("C"), skillKey("C++"), skillKey("C#")]).size).toBe(3)
  })
})

describe("evidence fingerprints", () => {
  it("identifies the same role with different dates as one claim", () => {
    const first = fingerprintFor("EVIDENCE", evidence("Backend Engineer", "Acme", "2021-01-01").data)
    const second = fingerprintFor("EVIDENCE", evidence("Backend Engineer", "Acme", "2020-06-01").data)
    expect(first).toBe(second)
  })

  it("separates the same title at a different organization", () => {
    const first = fingerprintFor("EVIDENCE", evidence("Backend Engineer", "Acme", null).data)
    const second = fingerprintFor("EVIDENCE", evidence("Backend Engineer", "Globex", null).data)
    expect(first).not.toBe(second)
  })
})

describe("dedupeDrafts", () => {
  it("keeps the highest-confidence version of a duplicate", () => {
    const result = dedupeDrafts([
      skill("Node.js", 60),
      skill("NodeJS", 90),
      skill("TypeScript", 70),
    ])
    expect(result.duplicates).toBe(1)
    expect(result.kept).toHaveLength(2)
    expect(result.kept.find((draft) => draft.kind === "SKILL")?.confidence).toBe(90)
  })

  it("keeps the first draft when confidence ties", () => {
    const result = dedupeDrafts([skill("React", 70), skill("React.js", 70)])
    expect(result.kept).toHaveLength(1)
  })

  it("keeps the same role with different dates so the disagreement is reviewable", () => {
    const result = dedupeDrafts([
      evidence("Backend Engineer", "Acme", "2021-01-01"),
      evidence("Backend Engineer", "Acme", "2020-06-01"),
    ])
    expect(result.duplicates).toBe(0)
    expect(result.kept).toHaveLength(2)
  })
})

describe("contact comparison", () => {
  it("compares email case-insensitively", () => {
    expect(
      contactValuesMatch("contactEmail", "ADA@Example.com", "ada@example.com")
    ).toBe(true)
  })

  it("ignores www, scheme and a trailing slash for profile URLs", () => {
    expect(normalizeUrl("https://www.Example.com/ada/")).toBe(
      normalizeUrl("http://example.com/ada")
    )
    expect(
      contactValuesMatch(
        "websiteUrl",
        "https://www.example.com/ada/",
        "http://example.com/ada"
      )
    ).toBe(true)
  })

  it("compares phone numbers by digits only", () => {
    expect(contactValuesMatch("contactPhone", "+1 (555) 010-2000", "15550102000")).toBe(
      true
    )
  })
})
