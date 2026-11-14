import { describe, it, expect } from "vitest"
import { ResumeVariant } from "@/generated/prisma/enums"
import {
  pickTailorSourceResumeId,
  recommendResumeForJob,
  sharesRoleToken,
  type ResumeChoiceOption,
} from "../resume-choice.service"

const JOB_ID = "app-1"

function makeResume(
  overrides: Partial<ResumeChoiceOption> & { id: string }
): ResumeChoiceOption {
  return {
    title: "Resume",
    variant: ResumeVariant.MASTER,
    targetRole: null,
    jobApplicationId: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }
}

function recommend(resumes: ResumeChoiceOption[], jobTitle = "Backend Engineer") {
  return recommendResumeForJob({ resumes, jobApplicationId: JOB_ID, jobTitle })
}

describe("recommendResumeForJob", () => {
  it("returns null when the user has no resumes", () => {
    expect(recommend([])).toBeNull()
  })

  it("tier 1: prefers a resume tailored to this application", () => {
    const result = recommend([
      makeResume({ id: "master", variant: ResumeVariant.MASTER }),
      makeResume({
        id: "family",
        variant: ResumeVariant.ROLE_FAMILY,
        title: "Backend Engineer",
      }),
      makeResume({
        id: "tailored",
        variant: ResumeVariant.JOB_TAILORED,
        jobApplicationId: JOB_ID,
      }),
    ])

    expect(result).toEqual({
      resumeId: "tailored",
      reason: "Tailored for this job",
    })
  })

  it("ignores a resume tailored to a different application", () => {
    const result = recommend([
      makeResume({ id: "master", variant: ResumeVariant.MASTER }),
      makeResume({
        id: "other",
        variant: ResumeVariant.JOB_TAILORED,
        jobApplicationId: "app-2",
      }),
    ])

    expect(result).toEqual({ resumeId: "master", reason: "Master resume" })
  })

  it("tier 2: falls back to a role-family resume sharing a word with the title", () => {
    const result = recommend([
      makeResume({ id: "master", variant: ResumeVariant.MASTER }),
      makeResume({
        id: "family",
        variant: ResumeVariant.ROLE_FAMILY,
        title: "Engineer track",
      }),
    ])

    expect(result).toEqual({
      resumeId: "family",
      reason: "Matches role family",
    })
  })

  it("matches a role family on its targetRole as well as its title", () => {
    const result = recommend([
      makeResume({ id: "master", variant: ResumeVariant.MASTER }),
      makeResume({
        id: "family",
        variant: ResumeVariant.ROLE_FAMILY,
        title: "Track A",
        targetRole: "Backend Engineer",
      }),
    ])

    expect(result?.resumeId).toBe("family")
  })

  it("does not let seniority alone carry a role-family match", () => {
    const result = recommend(
      [
        makeResume({ id: "master", variant: ResumeVariant.MASTER }),
        makeResume({
          id: "family",
          variant: ResumeVariant.ROLE_FAMILY,
          title: "Senior Designer",
        }),
      ],
      "Senior Accountant"
    )

    expect(result).toEqual({ resumeId: "master", reason: "Master resume" })
  })

  it("tier 3: uses the newest master when nothing more specific fits", () => {
    const result = recommend([
      makeResume({
        id: "old-master",
        variant: ResumeVariant.MASTER,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      makeResume({
        id: "new-master",
        variant: ResumeVariant.MASTER,
        updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      }),
    ])

    expect(result).toEqual({ resumeId: "new-master", reason: "Master resume" })
  })

  it("tier 4: falls back to the newest resume of any kind", () => {
    const result = recommend([
      makeResume({
        id: "old-family",
        variant: ResumeVariant.ROLE_FAMILY,
        title: "Nursing",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      makeResume({
        id: "new-tailored",
        variant: ResumeVariant.JOB_TAILORED,
        jobApplicationId: "app-2",
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      }),
    ])

    expect(result).toEqual({
      resumeId: "new-tailored",
      reason: "Most recently updated resume",
    })
  })
})

describe("sharesRoleToken", () => {
  it("matches on a whole token, case-insensitively", () => {
    expect(sharesRoleToken("Backend ENGINEER", "engineer, platform")).toBe(true)
  })

  it("does not match on a partial word", () => {
    expect(sharesRoleToken("Engineering Manager", "Engineer")).toBe(false)
  })

  it("drops seniority stopwords", () => {
    expect(sharesRoleToken("Lead Chef", "Lead Pharmacist")).toBe(false)
  })

  it("keeps punctuated technology names whole", () => {
    expect(sharesRoleToken("Node.js Developer", "node.js engineer")).toBe(true)
  })
})

describe("pickTailorSourceResumeId", () => {
  const masterResumes = [
    { id: "master-new", title: "Alex Morgan", detail: "" },
    { id: "master-old", title: "Full-Stack Developer Resume", detail: "Junior Web Developer" },
  ]

  it("prefers a role family resume whose role tokens match the job title", () => {
    expect(
      pickTailorSourceResumeId({
        roleFamilyResumes: [
          { id: "rf-nurse", title: "Nursing", detail: "Registered Nurse" },
          { id: "rf-dev", title: "Developer", detail: "Full Stack Developer" },
        ],
        masterResumes,
        jobTitle: "Web Developer",
      }),
    ).toBe("rf-dev")
  })

  it("matches on the detail when the title alone does not", () => {
    expect(
      pickTailorSourceResumeId({
        roleFamilyResumes: [{ id: "rf-1", title: "Primary", detail: "Full Stack Developer" }],
        masterResumes,
        jobTitle: "Senior Developer",
      }),
    ).toBe("rf-1")
  })

  it("ignores seniority words, the way the recommendation's tier 2 does", () => {
    expect(
      pickTailorSourceResumeId({
        roleFamilyResumes: [{ id: "rf-senior", title: "Senior", detail: null }],
        masterResumes,
        jobTitle: "Senior Nurse",
      }),
    ).toBe("master-new")
  })

  it("falls back to the most recently updated master", () => {
    expect(
      pickTailorSourceResumeId({
        roleFamilyResumes: [],
        masterResumes,
        jobTitle: "Web Developer",
      }),
    ).toBe("master-new")
  })

  it("returns undefined when there is nothing to tailor from", () => {
    expect(
      pickTailorSourceResumeId({
        roleFamilyResumes: [],
        masterResumes: [],
        jobTitle: "Web Developer",
      }),
    ).toBeUndefined()
  })
})
