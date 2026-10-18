import { describe, it, expect } from "vitest"

import {
  MAX_DISCOVERY_KEYWORDS,
  MAX_DISCOVERY_QUERIES,
  deriveDiscoveryKeywords,
  deriveDiscoveryQueries,
  type CapabilityInput,
  type TargetRoleInput,
} from "../derive-queries.service"

function role(overrides: Partial<TargetRoleInput> = {}): TargetRoleInput {
  return { title: "Frontend Engineer", priority: 0, active: true, ...overrides }
}

function capability(name: string, confirmed = true): CapabilityInput {
  return { name, confirmed }
}

describe("deriveDiscoveryQueries", () => {
  it("returns nothing when there are no target roles", () => {
    expect(deriveDiscoveryQueries([])).toEqual([])
  })

  it("makes one query per active role title", () => {
    const queries = deriveDiscoveryQueries([
      role({ title: "Frontend Engineer" }),
      role({ title: "Product Designer", priority: 1 }),
    ])

    expect(queries).toEqual([{ role: "Frontend Engineer" }, { role: "Product Designer" }])
  })

  it("skips inactive roles", () => {
    const queries = deriveDiscoveryQueries([
      role({ title: "Paused Role", active: false }),
      role({ title: "Live Role" }),
    ])

    expect(queries).toEqual([{ role: "Live Role" }])
  })

  it("orders by priority ascending regardless of input order", () => {
    const queries = deriveDiscoveryQueries([
      role({ title: "Third", priority: 5 }),
      role({ title: "First", priority: 0 }),
      role({ title: "Second", priority: 2 }),
    ])

    expect(queries.map((query) => query.role)).toEqual(["First", "Second", "Third"])
  })

  it("keeps input order for equal priorities", () => {
    const queries = deriveDiscoveryQueries([
      role({ title: "Earlier", priority: 1 }),
      role({ title: "Later", priority: 1 }),
    ])

    expect(queries.map((query) => query.role)).toEqual(["Earlier", "Later"])
  })

  it(`caps at ${MAX_DISCOVERY_QUERIES} queries`, () => {
    const queries = deriveDiscoveryQueries(
      Array.from({ length: 9 }, (_unused, index) =>
        role({ title: `Role ${index}`, priority: index })
      )
    )

    expect(queries).toHaveLength(MAX_DISCOVERY_QUERIES)
    expect(queries.at(-1)).toEqual({ role: `Role ${MAX_DISCOVERY_QUERIES - 1}` })
  })

  it("drops blank titles and collapses inner whitespace", () => {
    const queries = deriveDiscoveryQueries([
      role({ title: "   " }),
      role({ title: "  Staff   Engineer  ", priority: 1 }),
    ])

    expect(queries).toEqual([{ role: "Staff Engineer" }])
  })

  it("collapses duplicate titles case-insensitively so they cannot eat query slots", () => {
    const queries = deriveDiscoveryQueries([
      role({ title: "Frontend Engineer" }),
      role({ title: "frontend engineer", priority: 1 }),
      role({ title: "Backend Engineer", priority: 2 }),
    ])

    expect(queries.map((query) => query.role)).toEqual([
      "Frontend Engineer",
      "Backend Engineer",
    ])
  })

  it("omits keywords entirely when the profile confirms nothing", () => {
    const queries = deriveDiscoveryQueries([role()], [capability("React", false)])

    expect(queries).toEqual([{ role: "Frontend Engineer" }])
  })

  it("carries the profile's confirmed capabilities on every query", () => {
    const queries = deriveDiscoveryQueries(
      [role({ title: "Frontend Engineer" }), role({ title: "Product Designer", priority: 1 })],
      [capability("React"), capability("TypeScript"), capability("Figma", false)]
    )

    expect(queries).toEqual([
      { role: "Frontend Engineer", keywords: ["React", "TypeScript"] },
      { role: "Product Designer", keywords: ["React", "TypeScript"] },
    ])
  })

  it("gives each query its own keyword array", () => {
    const queries = deriveDiscoveryQueries(
      [role({ title: "One" }), role({ title: "Two", priority: 1 })],
      [capability("React")]
    )

    expect(queries[0]?.keywords).not.toBe(queries[1]?.keywords)
  })
})

describe("deriveDiscoveryKeywords", () => {
  it("takes only confirmed capabilities, in the order given", () => {
    expect(
      deriveDiscoveryKeywords([
        capability("React"),
        capability("Kubernetes", false),
        capability("Node.js"),
      ])
    ).toEqual(["React", "Node.js"])
  })

  it("drops blanks and collapses inner whitespace", () => {
    expect(deriveDiscoveryKeywords([capability("   "), capability("  Design   Systems ")])).toEqual(
      ["Design Systems"]
    )
  })

  it("collapses duplicates case-insensitively", () => {
    expect(deriveDiscoveryKeywords([capability("React"), capability("react")])).toEqual(["React"])
  })

  it(`caps at ${MAX_DISCOVERY_KEYWORDS} keywords`, () => {
    const keywords = deriveDiscoveryKeywords(
      Array.from({ length: MAX_DISCOVERY_KEYWORDS + 4 }, (_unused, index) =>
        capability(`Skill ${index}`)
      )
    )

    expect(keywords).toHaveLength(MAX_DISCOVERY_KEYWORDS)
    expect(keywords.at(-1)).toBe(`Skill ${MAX_DISCOVERY_KEYWORDS - 1}`)
  })

  it("returns nothing for an empty profile", () => {
    expect(deriveDiscoveryKeywords([])).toEqual([])
  })
})
