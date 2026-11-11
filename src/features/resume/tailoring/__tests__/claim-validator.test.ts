// @vitest-environment node
import { describe, expect, it } from "vitest"

import { validateTailoredResume } from "../claim-validator"
import type { RequirementEvidence, ResumeSectionSnapshot } from "../types"

const HASH = "sha256:source-snapshot"

function source(sections: ResumeSectionSnapshot[]): ResumeSectionSnapshot[] {
  return sections
}

function summary(text: string, id = "sec-summary"): ResumeSectionSnapshot {
  return {
    id,
    type: "SUMMARY",
    title: "Summary",
    order: 0,
    visible: true,
    items: [{ id: `${id}-item`, content: { text }, order: 0 }],
  }
}

function experience(bullets: string[], id = "sec-exp"): ResumeSectionSnapshot {
  return {
    id,
    type: "EXPERIENCE",
    title: "Experience",
    order: 1,
    visible: true,
    items: [
      {
        id: `${id}-item`,
        content: { role: "Engineer", company: "Acme", bullets },
        order: 0,
      },
    ],
  }
}

function skills(entries: string[]): ResumeSectionSnapshot {
  return {
    id: "sec-skills",
    type: "SKILLS",
    title: "Skills",
    order: 2,
    visible: true,
    items: [{ id: "sec-skills-item", content: { category: "Languages", skills: entries }, order: 0 }],
  }
}

const requirement = (overrides: Partial<RequirementEvidence> = {}): RequirementEvidence => ({
  id: "req-1",
  text: "TypeScript APIs",
  kind: "REQUIREMENT",
  verdict: "SUPPORTED",
  matchedTerms: ["typescript"],
  evidenceRefs: [
    {
      ref: "section:SKILLS:sec-skills/item:sec-skills-item:skills.0",
      label: "Skills — TypeScript",
      quote: "TypeScript",
      origin: "resume",
      matchedTerms: ["typescript"],
    },
  ],
  ...overrides,
})

describe("validateTailoredResume", () => {
  it("fails a fabricated metric the source bullet never had", () => {
    const report = validateTailoredResume({
      source: source([experience(["Built APIs."])]),
      tailored: source([experience(["Built APIs used by 40% of customers."])]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "FABRICATED_METRIC", severity: "error" })])
    )
  })

  it("fails an invented company or technology proper noun", () => {
    const report = validateTailoredResume({
      source: source([experience(["Built APIs."])]),
      tailored: source([experience(["Built APIs with PostgreSQL."])]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_ENTITY", message: expect.stringContaining("PostgreSQL") }),
      ])
    )
  })

  it("fails a rewrite that escalates an ordinary duty into leadership", () => {
    const report = validateTailoredResume({
      source: source([experience(["Organized the office party."])]),
      tailored: source([experience(["Led office operations."])]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "IMPLIED_SENIORITY", message: expect.stringContaining("led") }),
      ])
    )
  })

  it("fails an invented certification", () => {
    const report = validateTailoredResume({
      source: source([experience(["Built APIs."])]),
      tailored: source([experience(["Certified AWS engineer who built APIs."])]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "IMPLIED_CREDENTIAL", message: expect.stringContaining("certified") }),
      ])
    )
  })

  it("fails a skills list that adds an entry instead of reordering", () => {
    const report = validateTailoredResume({
      source: source([skills(["TypeScript", "SQL"])]),
      tailored: source([skills(["TypeScript", "SQL", "Kubernetes"])]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SKILL_SET_CHANGED" })])
    )
  })

  it("fails a new experience item with no source counterpart", () => {
    const tailored: ResumeSectionSnapshot = {
      id: "sec-exp",
      type: "EXPERIENCE",
      title: "Experience",
      order: 1,
      visible: true,
      items: [
        {
          id: "sec-exp-item",
          content: { role: "Engineer", company: "Acme", bullets: ["Built APIs."] },
          order: 0,
        },
        {
          id: "sec-exp-item-2",
          content: { role: "Staff Engineer", company: "Globex", bullets: ["Shipped a platform."] },
          order: 1,
        },
      ],
    }

    const report = validateTailoredResume({
      source: source([experience(["Built APIs."])]),
      tailored: source([tailored]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "UNSUPPORTED_ADDED_ITEM" })])
    )
  })

  it("fails an achievement bullet added inside an existing role", () => {
    const report = validateTailoredResume({
      source: source([experience(["Built APIs."])]),
      tailored: source([experience(["Built APIs.", "Built APIs for customers."])]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "UNSUPPORTED_ADDED_ITEM" })])
    )
  })

  it("passes a faithful rewrite that keeps the source metric", () => {
    const report = validateTailoredResume({
      source: source([experience(["Cut latency by 20%."])]),
      tailored: source([experience(["Cut latency by 20% for platform reliability."])]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.issues).toEqual([])
    expect(report.status).toBe("PASS")
  })

  it("passes a reorder-only skills change", () => {
    const report = validateTailoredResume({
      source: source([skills(["TypeScript", "SQL"])]),
      tailored: source([skills(["SQL", "TypeScript"])]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.status).toBe("PASS")
    expect(report.claims).toEqual([])
  })

  it("attaches requirement evidence refs to a rewritten claim", () => {
    const report = validateTailoredResume({
      source: source([skills(["TypeScript"]), experience(["Built APIs."])]),
      tailored: source([skills(["TypeScript"]), experience(["Built TypeScript APIs for payments."])]),
      requirements: [requirement()],
      sourceHash: HASH,
    })

    expect(report.status).toBe("PASS")
    const claim = report.claims.find((entry) => entry.change === "rewritten")
    expect(claim).toBeTruthy()
    expect(claim?.requirementIds).toContain("req-1")
    expect(claim?.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: "section:SKILLS:sec-skills/item:sec-skills-item:skills.0" }),
      ])
    )
  })

  it("allows a summary number that exists elsewhere in the source resume", () => {
    const report = validateTailoredResume({
      source: source([summary("Backend engineer."), experience(["Cut latency by 20%."])]),
      tailored: source([
        summary("Backend engineer who cut latency by 20%."),
        experience(["Cut latency by 20%."]),
      ]),
      requirements: [],
      sourceHash: HASH,
    })

    expect(report.status).toBe("PASS")
    expect(report.requirementCoverage).toEqual({
      supported: 0,
      partial: 0,
      unsupported: 0,
      total: 0,
    })
    expect(report.sourceHash).toBe(HASH)
  })

  it("counts requirement coverage without treating a gap as a fabricated claim", () => {
    const report = validateTailoredResume({
      source: source([experience(["Built APIs."])]),
      tailored: source([experience(["Built APIs for payments."])]),
      requirements: [
        requirement({ id: "req-1", verdict: "SUPPORTED" }),
        requirement({ id: "req-2", verdict: "PARTIAL", matchedTerms: ["kubernetes"] }),
        requirement({ id: "req-3", verdict: "UNSUPPORTED", matchedTerms: ["terraform"] }),
      ],
      sourceHash: HASH,
    })

    expect(report.requirementCoverage).toEqual({
      supported: 1,
      partial: 1,
      unsupported: 1,
      total: 3,
    })
  })
})
