import { describe, it, expect } from "vitest"

import { UNDISCLOSED_EMPLOYER } from "../../services/adapters/onlinejobs.adapter"
import {
  groupCandidatesByRole,
  isPlaceholderCompany,
  variantLocationLabels,
} from "../group-locations"

interface Posting {
  title: string
  companyName: string
  location?: string | null
  id: string
}

const posting = (
  id: string,
  title: string,
  companyName: string,
  location?: string | null
): Posting => ({ id, title, companyName, location })

describe("isPlaceholderCompany", () => {
  it("covers the placeholder the OnlineJobs.ph adapter writes", () => {
    expect(isPlaceholderCompany(UNDISCLOSED_EMPLOYER)).toBe(true)
  })

  it("ignores case and surrounding whitespace", () => {
    expect(isPlaceholderCompany("  UNDISCLOSED   employer ")).toBe(true)
  })

  it("is true for a name that is empty or only whitespace", () => {
    expect(isPlaceholderCompany("")).toBe(true)
    expect(isPlaceholderCompany("   ")).toBe(true)
    expect(isPlaceholderCompany(null)).toBe(true)
    expect(isPlaceholderCompany(undefined)).toBe(true)
  })

  it("is false for a real employer", () => {
    expect(isPlaceholderCompany("Globex")).toBe(false)
  })
})

describe("groupCandidatesByRole", () => {
  it("keeps input order and puts a group where its first member was", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "Data Analyst", "Initech", "Cebu"),
      posting("c", "Frontend Engineer", "Globex", "Singapore"),
    ])

    expect(groups.map((group) => group.primary.id)).toEqual(["a", "b"])
    expect(groups[0].variants.map((variant) => variant.id)).toEqual(["c"])
    expect(groups[1].variants).toEqual([])
  })

  it("keeps variants in input order", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "Frontend Engineer", "Globex", "Cebu"),
      posting("c", "Frontend Engineer", "Globex", "Davao"),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].variants.map((variant) => variant.id)).toEqual(["b", "c"])
  })

  it("matches on title and company regardless of case and whitespace", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "  frontend   ENGINEER ", " globex ", "Cebu"),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].variants.map((variant) => variant.id)).toEqual(["b"])
  })

  it("does not group a different title or a different company", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "Frontend Engineer II", "Globex", "Manila"),
      posting("c", "Frontend Engineer", "Initech", "Manila"),
    ])

    expect(groups.map((group) => group.primary.id)).toEqual(["a", "b", "c"])
  })

  it("leaves a single posting untouched", () => {
    const groups = groupCandidatesByRole([posting("a", "Frontend Engineer", "Globex", "Manila")])

    expect(groups).toEqual([
      { primary: posting("a", "Frontend Engineer", "Globex", "Manila"), variants: [] },
    ])
  })

  it("returns nothing for an empty list", () => {
    expect(groupCandidatesByRole([])).toEqual([])
  })

  it("never groups postings whose employer is the placeholder", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Backend Developer", UNDISCLOSED_EMPLOYER, "Philippines (remote)"),
      posting("b", "Backend Developer", UNDISCLOSED_EMPLOYER, "Philippines (remote)"),
      posting("c", "Backend Developer", UNDISCLOSED_EMPLOYER, "Manila"),
    ])

    expect(groups.map((group) => group.primary.id)).toEqual(["a", "b", "c"])
    expect(groups.every((group) => group.variants.length === 0)).toBe(true)
  })

  it("never groups postings with a blank employer", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Backend Developer", "", "Manila"),
      posting("b", "Backend Developer", "   ", "Cebu"),
    ])

    expect(groups.map((group) => group.primary.id)).toEqual(["a", "b"])
    expect(groups.every((group) => group.variants.length === 0)).toBe(true)
  })

  it("leaves a same-key posting that repeats a location as its own row", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "Frontend Engineer", "Globex", "manila"),
    ])

    expect(groups.map((group) => group.primary.id)).toEqual(["a", "b"])
    expect(groups[0].variants).toEqual([])
  })

  it("leaves a same-key posting that repeats a folded variant's location as its own row", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "Frontend Engineer", "Globex", "Cebu"),
      posting("c", "Frontend Engineer", "Globex", " CEBU "),
    ])

    expect(groups.map((group) => group.primary.id)).toEqual(["a", "c"])
    expect(groups[0].variants.map((variant) => variant.id)).toEqual(["b"])
  })

  it("leaves a same-key posting with no location as its own row", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "Frontend Engineer", "Globex", null),
      posting("c", "Frontend Engineer", "Globex", "   "),
    ])

    expect(groups.map((group) => group.primary.id)).toEqual(["a", "b", "c"])
    expect(groups[0].variants).toEqual([])
  })

  it("still folds a located posting under a primary that has no location", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", null),
      posting("b", "Frontend Engineer", "Globex", "Cebu"),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].variants.map((variant) => variant.id)).toEqual(["b"])
  })
})

describe("variantLocationLabels", () => {
  it("names the variants' locations in input order", () => {
    const [group] = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "Frontend Engineer", "Globex", "Cebu"),
      posting("c", "Frontend Engineer", "Globex", "Davao"),
    ])

    expect(variantLocationLabels(group)).toEqual(["Cebu", "Davao"])
  })

  it("names one label per variant, so the line is never empty for a group", () => {
    const groups = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "Frontend Engineer", "Globex", "Cebu"),
      posting("c", "Frontend Engineer", "Globex", "Manila"),
      posting("d", "Frontend Engineer", "Globex", "Davao"),
    ])

    expect(variantLocationLabels(groups[0])).toHaveLength(groups[0].variants.length)
    expect(variantLocationLabels(groups[0])).toEqual(["Cebu", "Davao"])
  })

  it("collapses whitespace in the label but keeps the source's casing", () => {
    const [group] = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", "Manila"),
      posting("b", "Frontend Engineer", "Globex", "  Metro   CEBU "),
    ])

    expect(variantLocationLabels(group)).toEqual(["Metro CEBU"])
  })

  it("names a variant's location when the primary has none", () => {
    const [group] = groupCandidatesByRole([
      posting("a", "Frontend Engineer", "Globex", null),
      posting("b", "Frontend Engineer", "Globex", "Cebu"),
    ])

    expect(variantLocationLabels(group)).toEqual(["Cebu"])
  })

  it("names nothing for a group with no variants", () => {
    const [group] = groupCandidatesByRole([posting("a", "Frontend Engineer", "Globex", "Manila")])

    expect(variantLocationLabels(group)).toEqual([])
  })
})
