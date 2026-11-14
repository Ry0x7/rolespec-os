import { describe, it, expect } from "vitest"
import { groupResumesByVariant, groupByRoleFamilyName } from "../resume-sections"

function makeResume(overrides: Partial<Parameters<typeof groupResumesByVariant>[0][number]>) {
  return {
    id: "r1",
    title: "Backend Engineer",
    targetRole: "Platform Engineer",
    variant: "MASTER" as const,
    roleFamily: null,
    jobApplication: null,
    template: "MODERN",
    atsScore: null,
    updatedAt: new Date("2026-01-15T00:00:00.000Z"),
    ...overrides,
  }
}

describe("groupResumesByVariant", () => {
  it("splits resumes into master, role family, and job-tailored buckets", () => {
    const resumes = [
      makeResume({ id: "m1", variant: "MASTER" }),
      makeResume({ id: "rf1", variant: "ROLE_FAMILY" }),
      makeResume({ id: "jt1", variant: "JOB_TAILORED" }),
    ]
    const groups = groupResumesByVariant(resumes)
    expect(groups.master.map((r) => r.id)).toEqual(["m1"])
    expect(groups.roleFamily.map((r) => r.id)).toEqual(["rf1"])
    expect(groups.jobTailored.map((r) => r.id)).toEqual(["jt1"])
  })

  it("preserves incoming order within each bucket", () => {
    const resumes = [
      makeResume({ id: "m2", variant: "MASTER" }),
      makeResume({ id: "m1", variant: "MASTER" }),
    ]
    expect(groupResumesByVariant(resumes).master.map((r) => r.id)).toEqual([
      "m2",
      "m1",
    ])
  })
})

describe("groupByRoleFamilyName", () => {
  it("groups by role family name and buckets unnamed resumes under Other", () => {
    const resumes = [
      makeResume({ id: "a", roleFamily: { name: "Engineering" } }),
      makeResume({ id: "b", roleFamily: { name: "Sales" } }),
      makeResume({ id: "c", roleFamily: { name: "Engineering" } }),
      makeResume({ id: "d", roleFamily: null }),
    ]
    const groups = groupByRoleFamilyName(resumes)
    expect(groups.map((g) => g.name)).toEqual(["Engineering", "Sales", "Other"])
    expect(groups[0].resumes.map((r) => r.id)).toEqual(["a", "c"])
    expect(groups[1].resumes.map((r) => r.id)).toEqual(["b"])
    expect(groups[2].resumes.map((r) => r.id)).toEqual(["d"])
  })
})
