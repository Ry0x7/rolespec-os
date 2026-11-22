import { describe, expect, it } from "vitest"

import { CAREER_PATH_CATALOG } from "../occupations"
import type { CareerOccupation, CareerRegion } from "../../types"

const { capabilityDefinitions, families, occupations } = CAREER_PATH_CATALOG

const capabilityKeys = new Set(capabilityDefinitions.map((item) => item.key))
const familyIds = new Set(families.map((family) => family.id))
const occupationById = new Map(occupations.map((occupation) => [occupation.id, occupation]))

/** Punctuation and case should not create two different meanings for one alias. */
function normaliseAlias(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
}

function reachableWithin(fromId: string, toId: string, maxDepth: number): boolean {
  const seen = new Set<string>([fromId])
  let frontier = [fromId]

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: string[] = []
    for (const id of frontier) {
      const occupation = occupationById.get(id)
      if (!occupation) continue
      for (const edge of [...occupation.adjacentIds, ...occupation.growthIds]) {
        if (edge === toId) return true
        if (seen.has(edge)) continue
        seen.add(edge)
        next.push(edge)
      }
    }
    frontier = next
  }

  return false
}

function requireOccupation(id: string): CareerOccupation {
  const occupation = occupationById.get(id)
  if (!occupation) throw new Error(`Missing occupation fixture: ${id}`)
  return occupation
}

describe("career path capability catalogue", () => {
  it("has unique keys and unique aliases", () => {
    expect(capabilityKeys.size).toBe(capabilityDefinitions.length)
    expect(capabilityDefinitions.length).toBeGreaterThanOrEqual(55)

    const aliasOwner = new Map<string, string>()
    for (const definition of capabilityDefinitions) {
      expect(definition.key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(definition.label.trim().length).toBeGreaterThan(0)
      expect(definition.learningStep.trim().length).toBeGreaterThan(20)
      expect(definition.aliases.length).toBeGreaterThan(0)

      for (const alias of definition.aliases) {
        const key = normaliseAlias(alias)
        expect(key.length).toBeGreaterThan(0)
        const owner = aliasOwner.get(key)
        expect(
          owner,
          `alias "${alias}" resolves to both ${owner ?? "?"} and ${definition.key}`
        ).toBeUndefined()
        aliasOwner.set(key, definition.key)
      }
    }
  })
})

describe("career path occupation catalogue", () => {
  it("has a version, families and unique occupation ids", () => {
    expect(CAREER_PATH_CATALOG.version).toBe("career-path-seed-2026.11.1")
    expect(families.length).toBeGreaterThanOrEqual(8)
    expect(familyIds.size).toBe(families.length)
    expect(occupations.length).toBeGreaterThanOrEqual(24)
    expect(new Set(occupations.map((item) => item.id)).size).toBe(occupations.length)
    expect(new Set(occupations.map((item) => item.title)).size).toBe(occupations.length)
  })

  it("resolves every requirement and keeps weights and counts sane", () => {
    const validEntryLevels = new Set(["ENTRY", "MID", "SENIOR"])
    const validRegions = new Set<CareerRegion>([
      "GLOBAL",
      "US",
      "EU",
      "UK",
      "CA",
      "AU",
      "PH",
      "IN",
      "SG",
      "AE",
    ])

    for (const occupation of occupations) {
      expect(occupation.title.trim().length).toBeGreaterThan(0)
      expect(occupation.summary.trim().length).toBeGreaterThan(20)
      expect(familyIds.has(occupation.familyId)).toBe(true)
      expect(validEntryLevels.has(occupation.entryLevel)).toBe(true)

      expect(occupation.requirements.length).toBeGreaterThanOrEqual(3)
      expect(occupation.requirements.length).toBeLessThanOrEqual(5)
      expect(occupation.preferred.length).toBeGreaterThanOrEqual(1)
      expect(occupation.preferred.length).toBeLessThanOrEqual(3)

      const requirementKeys = new Set<string>()
      for (const requirement of [...occupation.requirements, ...occupation.preferred]) {
        expect(capabilityKeys.has(requirement.capabilityKey)).toBe(true)
        expect([1, 2, 3]).toContain(requirement.weight)
      }
      for (const requirement of occupation.requirements) {
        expect(requirementKeys.has(requirement.capabilityKey)).toBe(false)
        requirementKeys.add(requirement.capabilityKey)
      }
      for (const requirement of occupation.preferred) {
        expect(requirementKeys.has(requirement.capabilityKey)).toBe(false)
        requirementKeys.add(requirement.capabilityKey)
      }

      const critical = occupation.requirements.filter((item) => item.critical)
      expect(critical.length).toBeLessThanOrEqual(1)

      expect(occupation.regions.length).toBeGreaterThan(0)
      for (const region of occupation.regions) expect(validRegions.has(region)).toBe(true)
    }
  })

  it("keeps every graph edge real, non-self and duplicate-free", () => {
    for (const occupation of occupations) {
      const edges = [...occupation.adjacentIds, ...occupation.growthIds]
      expect(edges.length).toBeGreaterThan(0)
      expect(new Set(edges).size).toBe(edges.length)
      for (const edge of edges) {
        expect(occupationById.has(edge), `${occupation.id} -> ${edge}`).toBe(true)
        expect(edge).not.toBe(occupation.id)
      }
    }
  })

  it("contains no salary payload or invented dataset references", () => {
    for (const occupation of occupations) {
      expect(occupation).not.toHaveProperty("salaryPotential")
      expect(occupation).not.toHaveProperty("salary")
      expect(occupation).not.toHaveProperty("references")
      expect(JSON.stringify(occupation)).not.toMatch(/\b(USD|PHP|EUR|GBP|salary|compensation)\b/i)
    }
  })

  it("attributes the seed and documents where the upstream evaluation lives", () => {
    const attribution = CAREER_PATH_CATALOG.attribution.join(" ")
    expect(attribution).toContain("docs/career-path-datasets.md")
    expect(attribution).toContain("not bundled")
    expect(attribution).toMatch(/no salary data/i)
  })
})

describe("persona coverage", () => {
  it("supports a marketing/communications profile for Marketing Coordinator", () => {
    const coordinator = requireOccupation("marketing-coordinator")
    const required = coordinator.requirements.map((item) => item.capabilityKey)
    expect(required).toEqual(
      expect.arrayContaining(["communication", "copywriting", "project-management", "data-analysis"])
    )
  })

  it("supports a graduate profile for Junior Software Engineer", () => {
    const junior = requireOccupation("junior-software-engineer")
    const required = junior.requirements.map((item) => item.capabilityKey)
    expect(required).toEqual(
      expect.arrayContaining(["programming", "git", "testing", "communication"])
    )
    expect(reachableWithin("junior-software-engineer", "qa-automation-engineer", 1)).toBe(true)
  })

  it("supports a customer-support profile for Customer Success Manager", () => {
    const csm = requireOccupation("customer-success-manager")
    const required = csm.requirements.map((item) => item.capabilityKey)
    expect(required).toEqual(
      expect.arrayContaining(["customer-success", "communication", "crm", "onboarding"])
    )
    expect(reachableWithin("customer-success-manager", "account-executive", 1)).toBe(true)
    expect(reachableWithin("customer-success-manager", "people-operations-specialist", 1)).toBe(
      true
    )
  })

  it("supports a senior technical profile with a credible next branch", () => {
    const softwareEngineer = requireOccupation("software-engineer")
    expect(softwareEngineer.requirements.map((item) => item.capabilityKey)).toEqual(
      expect.arrayContaining(["programming", "system-design"])
    )
    expect(reachableWithin("junior-software-engineer", "software-engineer", 1)).toBe(true)
    expect(reachableWithin("junior-software-engineer", "engineering-manager", 2)).toBe(true)
  })
})

describe("career branches", () => {
  it("lets Marketing Coordinator reach content and product marketing inside two steps", () => {
    expect(reachableWithin("marketing-coordinator", "content-strategist", 2)).toBe(true)
    expect(reachableWithin("marketing-coordinator", "product-marketing-manager", 2)).toBe(true)
  })

  it("lets Data Analyst reach data science and product management inside two steps", () => {
    expect(reachableWithin("data-analyst", "data-scientist", 2)).toBe(true)
    expect(reachableWithin("data-analyst", "product-manager", 2)).toBe(true)
  })
})
