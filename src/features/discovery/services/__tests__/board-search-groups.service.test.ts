import { describe, it, expect } from "vitest"

import { buildBoardSearchGroups, type BoardSearchProfile } from "../board-search-groups.service"
import { buildBoardSearchLinks } from "../board-search-links.service"

/** Only the fields the helper reads; the real type carries whole Prisma rows. */
function profile(overrides: Record<string, unknown> = {}): BoardSearchProfile {
  return {
    locations: ["Philippines"],
    workModes: ["HYBRID"],
    experienceLevel: "MID",
    targetRoles: [
      { title: "Data Analyst", priority: 0, active: true },
      { title: "  data   analyst ", priority: 1, active: true },
      { title: "Business Analyst", priority: 2, active: true },
      { title: "Project Manager", priority: 3, active: false },
      { title: "   ", priority: 4, active: true },
    ],
    capabilities: [
      { name: "SQL", confirmed: true },
      { name: "Python", confirmed: false },
    ],
    ...overrides,
  } as unknown as BoardSearchProfile
}

describe("buildBoardSearchGroups", () => {
  it("makes one group per derived query, with that query's board links", () => {
    const { groups } = buildBoardSearchGroups(profile())

    expect(groups.map((group) => group.role)).toEqual(["Data Analyst", "Business Analyst"])
    expect(groups[0].links).toEqual(
      buildBoardSearchLinks({
        role: "Data Analyst",
        keywords: ["SQL"],
        locations: ["Philippines"],
        workModes: ["HYBRID"],
        experienceLevel: "MID",
      })
    )
  })

  it("counts distinct non-blank active target roles, case- and space-insensitively", () => {
    expect(buildBoardSearchGroups(profile()).activeTargetRoleCount).toBe(2)
  })

  it("returns no groups and a zero count for an empty profile", () => {
    const result = buildBoardSearchGroups(
      profile({ targetRoles: [], capabilities: [], locations: [], workModes: [], experienceLevel: null })
    )

    expect(result).toEqual({ groups: [], activeTargetRoleCount: 0 })
  })
})
