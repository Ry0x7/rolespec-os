import { describe, expect, it } from "vitest"

import { buildCareerPath } from "../engine"
import { CAREER_PATH_CATALOG } from "../data/occupations"
import type {
  CareerCapabilityDepth,
  CareerCapabilitySelfRating,
} from "@/generated/prisma/enums"
import type {
  CareerPathCapabilityInput,
  CareerPathEvidenceInput,
  CareerPathProfileInput,
  CareerPathResult,
} from "../types"

/**
 * Integration coverage for the REAL shipped catalogue.
 *
 * The fixture tests in `engine.test.ts` prove the scoring rules in isolation.
 * These tests answer the product question: with the catalogue we actually
 * ship, do the intended personas land in useful, honest groups?
 *
 * The catalogue is deliberately small and locally written, so a missing role
 * is a real product gap. Where the current data cannot support an aspiration
 * (for example a TypeScript skill satisfying a generic `programming`
 * requirement), the assertion records the engine's honest behaviour rather
 * than weakening the matcher in a test.
 */

const AS_OF = "2026-11-01T00:00:00.000Z"

function evidence(
  id: string,
  title: string,
  status: CareerPathEvidenceInput["status"] = "CONFIRMED",
  kind: CareerPathEvidenceInput["kind"] = "EXPERIENCE"
): CareerPathEvidenceInput {
  return {
    id,
    title,
    kind,
    status,
    outcome: status === "CONFIRMED" ? `${title} produced a measurable, verifiable result.` : null,
    sourceUrl: `https://example.test/evidence/${id}`,
  }
}

interface CapabilityOptions {
  rating?: CareerCapabilitySelfRating
  depth?: CareerCapabilityDepth
  measured?: boolean
  confirmed?: boolean
  lastUsedAt?: string | null
  id?: string
}

function capability(
  name: string,
  evidenceId: string | null,
  options: CapabilityOptions = {}
): CareerPathCapabilityInput {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  return {
    id: options.id ?? `cap-${slug}`,
    name,
    confirmed: options.confirmed ?? true,
    selfAssessment: options.rating ?? "STRONG",
    links: evidenceId
      ? [
          {
            id: `link-${slug}-${evidenceId}`,
            evidenceId,
            depth: options.depth ?? "DEEP",
            hasMeasuredOutcome: options.measured ?? true,
            lastUsedAt: options.lastUsedAt ?? "2025-06-01",
          },
        ]
      : [],
  }
}

function profile(
  capabilities: CareerPathCapabilityInput[],
  evidenceRows: CareerPathEvidenceInput[],
  overrides: Partial<CareerPathProfileInput> = {}
): CareerPathProfileInput {
  return {
    experienceLevel: "MID",
    locations: ["Remote"],
    workAuthorization: "US",
    requiresSponsorship: false,
    targetRoleTitles: [],
    capabilities,
    evidence: evidenceRows,
    ...overrides,
  }
}

function allRecommendations(result: CareerPathResult) {
  return [...result.groups.QUALIFIED_NOW, ...result.groups.ADJACENT, ...result.groups.GROWTH]
}

function titles(result: CareerPathResult, group: keyof CareerPathResult["groups"]) {
  return result.groups[group].map((role) => role.title)
}

function findRole(result: CareerPathResult, title: string) {
  return allRecommendations(result).find((role) => role.title === title)
}

const catalogueIds = new Set(CAREER_PATH_CATALOG.occupations.map((role) => role.id))
const catalogueTitles = new Set(CAREER_PATH_CATALOG.occupations.map((role) => role.title))

describe("real catalogue personas", () => {
  it("places an evidence-backed customer-support professional in Customer Success now", () => {
    const rows = [
      evidence("ev-cs-communication", "Led weekly customer escalations"),
      evidence("ev-cs-success", "Owned a portfolio of 40 accounts"),
      evidence("ev-cs-crm", "Rebuilt the CRM hygiene process"),
      evidence("ev-cs-onboarding", "Redesigned customer onboarding"),
    ]
    const result = buildCareerPath(
      profile(
        [
          capability("Communication", "ev-cs-communication"),
          capability("Customer success", "ev-cs-success"),
          capability("Salesforce", "ev-cs-crm"),
          capability("Customer onboarding", "ev-cs-onboarding"),
        ],
        rows,
        { experienceLevel: "MID" }
      ),
      { asOf: AS_OF }
    )

    expect(result.hasEnoughEvidence).toBe(true)
    expect(titles(result, "QUALIFIED_NOW")).toContain("Customer Success Manager")

    const csm = result.groups.QUALIFIED_NOW.find(
      (role) => role.occupationId === "customer-success-manager"
    )
    expect(csm).toBeDefined()
    expect(csm?.matched.map((match) => match.key)).toEqual(
      expect.arrayContaining(["communication", "customer-success", "crm", "onboarding"])
    )
    expect(csm?.matched.flatMap((match) => match.evidence.map((item) => item.id))).toEqual(
      expect.arrayContaining(rows.slice(0, 3).map((row) => row.id))
    )
    expect(csm?.salaryPotential).toBeNull()
    expect(csm?.branch).toEqual(["Customer Success Manager"])
    expect(csm?.entryFeasibility.status).toBe("FEASIBLE")
    expect(csm?.geography.status).toBe("ELIGIBLE")

    // The graph should offer at least one lateral or next step from this role.
    const relatedIds = csm?.related.map((role) => role.occupationId) ?? []
    expect(relatedIds.length).toBeGreaterThan(0)
    expect(relatedIds.every((id) => catalogueIds.has(id))).toBe(true)

    const secondGroup = [...titles(result, "ADJACENT"), ...titles(result, "GROWTH")]
    expect(secondGroup.length).toBeGreaterThan(0)
    expect(secondGroup).toEqual(
      expect.arrayContaining([expect.stringMatching(/Account Executive|People Operations Specialist/)])
    )
    expect(result.counts.QUALIFIED_NOW).toBe(result.groups.QUALIFIED_NOW.length)
  })

  it("qualifies a marketing career changer now and keeps content roles as adjacent/growth", () => {
    const rows = [
      evidence("ev-mkt-communication", "Ran campaign communications for a product launch"),
      evidence("ev-mkt-copywriting", "Wrote and shipped a six-part campaign"),
      evidence("ev-mkt-project", "Managed a cross-team launch timeline"),
      evidence("ev-mkt-analysis", "Reported campaign performance to leadership"),
    ]
    const result = buildCareerPath(
      profile(
        [
          capability("Communication", "ev-mkt-communication"),
          capability("Copywriting", "ev-mkt-copywriting"),
          capability("Project management", "ev-mkt-project"),
          capability("Data analysis", "ev-mkt-analysis"),
        ],
        rows,
        { experienceLevel: "SENIOR" }
      ),
      { asOf: AS_OF }
    )

    expect(result.hasEnoughEvidence).toBe(true)
    expect(titles(result, "QUALIFIED_NOW")).toContain("Marketing Coordinator")

    const coordinator = result.groups.QUALIFIED_NOW.find(
      (role) => role.occupationId === "marketing-coordinator"
    )
    expect(coordinator?.matched.map((match) => match.key)).toEqual(
      expect.arrayContaining(["communication", "copywriting", "project-management", "data-analysis"])
    )
    expect(coordinator?.branch).toEqual(["Marketing Coordinator"])
    expect(coordinator?.salaryPotential).toBeNull()

    const adjacentOrGrowth = [...titles(result, "ADJACENT"), ...titles(result, "GROWTH")]
    expect(adjacentOrGrowth).toEqual(
      expect.arrayContaining([expect.stringMatching(/Content Strategist|Product Marketing Manager/)])
    )

    const content = findRole(result, "Content Strategist")
    expect(content).toBeDefined()
    expect(content?.group).not.toBe("QUALIFIED_NOW")
    expect(content?.branch[0]).toBe("Marketing Coordinator")
    expect(content?.branch.at(-1)).toBe("Content Strategist")
    expect(content?.missing.length).toBeGreaterThan(0)
    expect(content?.steps.length).toBeGreaterThan(0)
    expect(content?.steps.every((step) => step.trim().length > 0)).toBe(true)
    expect(content?.salaryPotential).toBeNull()
  })

  it("qualifies a recent graduate for the junior engineering entry point", () => {
    const rows = [
      evidence("ev-grad-programming", "Built a JavaScript task tracker", "CONFIRMED", "PROJECT"),
      evidence("ev-grad-git", "Contributed reviewed changes on GitHub", "CONFIRMED", "PROJECT"),
      evidence("ev-grad-testing", "Added unit tests to the task tracker", "CONFIRMED", "PROJECT"),
      evidence("ev-grad-communication", "Presented the project at a student demo", "CONFIRMED", "PROJECT"),
    ]
    const result = buildCareerPath(
      profile(
        [
          // The catalogue keeps `programming` distinct from `typescript` on
          // purpose. A graduate who only lists TypeScript does not satisfy the
          // generic programming requirement; this persona has JavaScript.
          capability("JavaScript", "ev-grad-programming"),
          capability("GitHub", "ev-grad-git"),
          capability("Unit testing", "ev-grad-testing"),
          capability("Communication", "ev-grad-communication"),
        ],
        rows,
        { experienceLevel: "JUNIOR", locations: ["Manila, Philippines"] }
      ),
      { asOf: AS_OF }
    )

    expect(result.hasEnoughEvidence).toBe(true)
    expect(titles(result, "QUALIFIED_NOW")).toContain("Junior Software Engineer")

    const junior = result.groups.QUALIFIED_NOW.find(
      (role) => role.occupationId === "junior-software-engineer"
    )
    expect(junior?.entryFeasibility.status).toBe("FEASIBLE")
    expect(junior?.geography.status).toBe("ELIGIBLE")
    expect(junior?.matched.map((match) => match.key)).toEqual(
      expect.arrayContaining(["programming", "git", "testing", "communication"])
    )

    const adjacent = titles(result, "ADJACENT")
    expect(adjacent).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Software Engineer|QA Automation Engineer/),
      ])
    )

    const growthOrAdjacent = [...titles(result, "ADJACENT"), ...titles(result, "GROWTH")]
    // Data Analyst is not reachable in two graph steps from the junior
    // engineering anchors in the shipped catalogue, so it is correctly absent.
    expect(growthOrAdjacent).not.toContain("Data Analyst")
    expect(growthOrAdjacent).toEqual(
      expect.arrayContaining([expect.stringMatching(/Software Engineer|QA Automation Engineer|Frontend Engineer|Backend Engineer/)])
    )
    expect(junior?.salaryPotential).toBeNull()
  })

  it("returns empty, explained groups for a sparse history", () => {
    const result = buildCareerPath(
      profile(
        [capability("Communication", "ev-sparse-communication")],
        [evidence("ev-sparse-communication", "Wrote a team update")],
        { experienceLevel: null, locations: [], workAuthorization: null, targetRoleTitles: [] }
      ),
      { asOf: AS_OF }
    )

    expect(result.hasEnoughEvidence).toBe(false)
    expect(result.counts).toEqual({ QUALIFIED_NOW: 0, ADJACENT: 0, GROWTH: 0 })
    expect(result.groups.QUALIFIED_NOW).toEqual([])
    expect(result.groups.ADJACENT).toEqual([])
    expect(result.groups.GROWTH).toEqual([])
    expect(result.notices.join(" ")).toMatch(/two confirmed capabilities/i)
    expect(result.evaluatedCount).toBe(25)
    expect(result.taxonomyVersion).toBe("career-path-seed-2026.11.1")
  })

  it("counts a duplicated capability once, reports the conflict, and keeps the stronger evidence", () => {
    const rows = [
      evidence("ev-conf-react-strong", "Led React accessibility work on a production app"),
      evidence("ev-conf-ts", "Converted a JavaScript app to TypeScript"),
      evidence("ev-conf-testing", "Added regression tests to a design system"),
      evidence("ev-conf-a11y", "Audited and fixed keyboard navigation"),
    ]
    const shared: CareerPathCapabilityInput[] = [
      capability("TypeScript", "ev-conf-ts"),
      capability("Unit testing", "ev-conf-testing"),
      capability("WCAG", "ev-conf-a11y"),
    ]
    const strongReact = capability("React", "ev-conf-react-strong", { id: "cap-react-strong" })
    const weakReact = capability("React", null, {
      id: "cap-react-weak",
      rating: "LEARNING",
      confirmed: true,
    })

    const duplicated = buildCareerPath(
      profile([strongReact, ...shared, weakReact], rows, { experienceLevel: "MID" }),
      { asOf: AS_OF }
    )
    const single = buildCareerPath(profile([strongReact, ...shared], rows, { experienceLevel: "MID" }), {
      asOf: AS_OF,
    })

    const duplicatedFrontend = findRole(duplicated, "Frontend Engineer")
    const singleFrontend = findRole(single, "Frontend Engineer")
    expect(duplicatedFrontend?.group).toBe("QUALIFIED_NOW")
    expect(singleFrontend?.group).toBe("QUALIFIED_NOW")
    expect(duplicatedFrontend?.score).toBe(singleFrontend?.score)
    expect(duplicatedFrontend?.coverage).toBe(singleFrontend?.coverage)

    const react = duplicatedFrontend?.matched.find((match) => match.key === "react")
    expect(react?.strength).toBeGreaterThan(45)
    expect(react?.evidence.map((item) => item.id)).toContain("ev-conf-react-strong")

    expect(duplicated.conflicts).toHaveLength(1)
    expect(duplicated.conflicts[0]?.capabilityKey).toBe("react")
    expect(duplicated.conflicts[0]?.detail).toMatch(/strongest record is used once/i)
    expect(single.conflicts).toEqual([])
  })

  it("never qualifies a role from self-declared skills with no confirmed evidence", () => {
    const rows = [
      evidence("ev-candidate-communication", "Unreviewed communication claim", "CANDIDATE"),
      evidence("ev-candidate-crm", "Unreviewed CRM claim", "CANDIDATE"),
      evidence("ev-candidate-onboarding", "Unreviewed onboarding claim", "CANDIDATE"),
    ]
    const result = buildCareerPath(
      profile(
        [
          capability("Communication", "ev-candidate-communication"),
          capability("Salesforce", "ev-candidate-crm"),
          capability("Onboarding", "ev-candidate-onboarding"),
        ],
        rows
      ),
      { asOf: AS_OF }
    )

    expect(result.hasEnoughEvidence).toBe(false)
    expect(result.counts.QUALIFIED_NOW).toBe(0)
    expect(result.groups.QUALIFIED_NOW).toEqual([])
    expect(result.notices.join(" ")).toMatch(/confirmed evidence/i)
    expect(allRecommendations(result)).toEqual([])
  })

  it("is deterministic, sorted, exclusive and salary-free", () => {
    const rows = [
      evidence("ev-det-programming", "Shipped a production service"),
      evidence("ev-det-design", "Designed a multi-tenant API"),
      evidence("ev-det-cloud", "Migrated a service to cloud infrastructure"),
      evidence("ev-det-mentoring", "Mentored two engineers"),
      evidence("ev-det-leadership", "Led a platform team"),
    ]
    const input = profile(
      [
        capability("Programming", "ev-det-programming"),
        capability("System design", "ev-det-design"),
        capability("AWS", "ev-det-cloud"),
        capability("Mentoring", "ev-det-mentoring"),
        capability("Leadership", "ev-det-leadership"),
      ],
      rows,
      { experienceLevel: "SENIOR", targetRoleTitles: ["Staff Engineer"] }
    )

    const first = buildCareerPath(input, { asOf: AS_OF })
    const second = buildCareerPath(input, { asOf: AS_OF })
    expect(second).toEqual(first)

    const recommendations = allRecommendations(first)
    const ids = recommendations.map((role) => role.occupationId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(recommendations.every((role) => catalogueIds.has(role.occupationId))).toBe(true)
    expect(recommendations.every((role) => role.salaryPotential === null)).toBe(true)
    expect(recommendations.every((role) => role.geography.status === "ELIGIBLE")).toBe(true)
    expect(recommendations.every((role) => role.entryFeasibility.status !== "BLOCKED")).toBe(true)
    expect(recommendations.every((role) => role.related.every((related) => catalogueIds.has(related.occupationId)))).toBe(true)
    expect(recommendations.every((role) => role.related.every((related) => catalogueTitles.has(related.title)))).toBe(true)

    for (const group of ["QUALIFIED_NOW", "ADJACENT", "GROWTH"] as const) {
      const roles = first.groups[group]
      for (let index = 1; index < roles.length; index += 1) {
        const previous = roles[index - 1]
        const current = roles[index]
        expect(
          previous.score > current.score ||
            (previous.score === current.score && previous.title.localeCompare(current.title) <= 0)
        ).toBe(true)
      }
    }
  })

  it("uses target roles only to surface catalogue growth paths, and reports unmatched titles", () => {
    const allowed = buildCareerPath(
      profile(
        [
          capability("Communication", "ev-target-communication"),
          capability("Programming", "ev-target-programming"),
        ],
        [
          evidence("ev-target-communication", "Presented a technical project"),
          evidence("ev-target-programming", "Built a small internal tool"),
        ],
        { experienceLevel: "JUNIOR", targetRoleTitles: ["Security Analyst"] }
      ),
      { asOf: AS_OF }
    )
    expect(findRole(allowed, "Security Analyst")?.group).toBe("GROWTH")

    const unmatched = buildCareerPath(
      profile(
        [
          capability("Communication", "ev-unmatched-communication"),
          capability("Programming", "ev-unmatched-programming"),
        ],
        [
          evidence("ev-unmatched-communication", "Presented a technical project"),
          evidence("ev-unmatched-programming", "Built a small internal tool"),
        ],
        { experienceLevel: "MID", targetRoleTitles: ["Astronaut"] }
      ),
      { asOf: AS_OF }
    )
    expect(unmatched.notices.join(" ")).toMatch(/No catalogue role matches/i)
    expect(unmatched.notices.join(" ")).toContain("Astronaut")
  })
})
