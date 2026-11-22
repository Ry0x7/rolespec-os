import { describe, expect, it } from "vitest"

import { MAX_DISCOVERY_QUERIES } from "../../services/derive-queries.service"
import { buildPresetQueries, isAlertDue, nextAlertAt } from "../service"

const NOW = new Date("2026-11-11T00:00:00.000Z")

function role(
  title: string,
  overrides: Partial<{ active: boolean; discoveryEnabled: boolean; source: string; priority: number }> = {}
) {
  return {
    title,
    priority: 0,
    active: true,
    source: "CAREER_PATH",
    discoveryEnabled: false,
    ...overrides,
  }
}

describe("buildPresetQueries", () => {
  it("dedupes roles and caps the run at the shared query limit", () => {
    const queries = buildPresetQueries(
      {
        roles: ["One", " one ", "Two", "Three", "Four", "Five", "Six"],
        keywords: [],
        includeCareerPathRoles: false,
      },
      []
    )
    expect(queries).toHaveLength(MAX_DISCOVERY_QUERIES)
    expect(queries.map((query) => query.role)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
    ])
  })

  it("never adds a career-path role that has not been enabled for discovery", () => {
    const queries = buildPresetQueries(
      {
        roles: ["Frontend Engineer"],
        keywords: [],
        includeCareerPathRoles: true,
      },
      [
        role("Data Analyst", { discoveryEnabled: false }),
        role("Product Manager", { discoveryEnabled: true }),
      ]
    )
    expect(queries.map((query) => query.role)).toEqual([
      "Frontend Engineer",
      "Product Manager",
    ])
  })

  it("does not let an old saved search bypass a disabled recommendation", () => {
    const queries = buildPresetQueries(
      {
        roles: ["Frontend Engineer", "Data Analyst"],
        keywords: [],
        includeCareerPathRoles: false,
      },
      [role("Data Analyst", { discoveryEnabled: false })]
    )
    expect(queries.map((query) => query.role)).toEqual(["Frontend Engineer"])
  })

  it("does not add career-path roles when the preset has not opted in", () => {
    const queries = buildPresetQueries(
      { roles: ["Frontend Engineer"], keywords: [], includeCareerPathRoles: false },
      [role("Product Manager", { discoveryEnabled: true })]
    )
    expect(queries.map((query) => query.role)).toEqual(["Frontend Engineer"])
  })

  it("keeps an explicitly chosen role and applies capped keywords", () => {
    const queries = buildPresetQueries(
      {
        roles: ["Data Analyst"],
        keywords: ["SQL", "sql", "Python", "Excel", "Tableau", "dbt", "Looker", "R"],
        includeCareerPathRoles: false,
      },
      []
    )
    expect(queries[0]!.role).toBe("Data Analyst")
    expect(queries[0]!.keywords).toEqual(["SQL", "Python", "Excel", "Tableau", "dbt", "Looker"])
  })

  it("returns nothing when the preset has no roles and no enabled recommendations", () => {
    expect(
      buildPresetQueries(
        { roles: [], keywords: [], includeCareerPathRoles: true },
        [role("Data Analyst", { discoveryEnabled: false })]
      )
    ).toEqual([])
  })
})

describe("saved-search alerts", () => {
  it("is due once the rolling interval has elapsed", () => {
    expect(
      isAlertDue(
        { alertFrequency: "DAILY", lastAlertedAt: new Date("2026-11-09T00:00:00.000Z") },
        NOW
      )
    ).toBe(true)
    expect(
      isAlertDue(
        { alertFrequency: "DAILY", lastAlertedAt: new Date("2026-11-10T12:00:00.000Z") },
        NOW
      )
    ).toBe(false)
  })

  it("uses a weekly interval and falls back to creation time", () => {
    const next = nextAlertAt(
      {
        alertFrequency: "WEEKLY",
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
        lastAlertedAt: null,
      },
      NOW
    )
    expect(next?.toISOString()).toBe("2026-11-08T00:00:00.000Z")
    expect(
      isAlertDue(
        {
          alertFrequency: "WEEKLY",
          createdAt: new Date("2026-11-05T00:00:00.000Z"),
          lastAlertedAt: null,
        },
        NOW
      )
    ).toBe(false)
  })

  it("has no due time when alerts are off", () => {
    expect(
      nextAlertAt(
        { alertFrequency: "OFF", createdAt: new Date("2026-01-01T00:00:00.000Z") },
        NOW
      )
    ).toBeNull()
    expect(
      isAlertDue(
        { alertFrequency: "OFF", createdAt: new Date("2026-01-01T00:00:00.000Z") },
        NOW
      )
    ).toBe(false)
  })
})
