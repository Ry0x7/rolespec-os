import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    resume: { findMany: vi.fn() },
    jobApplication: { findMany: vi.fn() },
  },
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import {
  getCoverLetterFormOptions,
  resolveCoverLetterResumeDefault,
} from "../cover-letter-form-options"

const tailoredForThisJob = {
  id: "r-tailored",
  title: "Rose Eden",
  atsScore: null,
  variant: "JOB_TAILORED" as const,
  targetRole: null,
  jobApplicationId: "app-1",
  updatedAt: new Date("2026-09-11T00:00:00Z"),
}

const master = {
  id: "r-master",
  title: "Full-Stack Developer Resume",
  atsScore: 72,
  variant: "MASTER" as const,
  targetRole: "Junior Web Developer",
  jobApplicationId: null,
  updatedAt: new Date("2026-09-07T00:00:00Z"),
}

const application = {
  id: "app-1",
  resumeId: null as string | null,
  job: {
    companyName: "Rose Eden LLC",
    title: "Web Developer",
    description: "A long enough description to count as present.",
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.resume.findMany.mockResolvedValue([tailoredForThisJob, master])
  mockPrisma.jobApplication.findMany.mockResolvedValue([application])
})

describe("resolveCoverLetterResumeDefault", () => {
  it("recommends and explains when the job has no chosen resume", () => {
    expect(
      resolveCoverLetterResumeDefault({
        resumes: [tailoredForThisJob, master],
        chosenResumeId: null,
        jobApplicationId: "app-1",
        jobTitle: "Web Developer",
      }),
    ).toEqual({
      defaultResumeId: "r-tailored",
      resumeHint: "Recommended: Rose Eden · Tailored for this job",
    })
  })

  it("prefers the user's own choice and stays quiet about tiers", () => {
    expect(
      resolveCoverLetterResumeDefault({
        resumes: [tailoredForThisJob, master],
        chosenResumeId: "r-master",
        jobApplicationId: "app-1",
        jobTitle: "Web Developer",
      }),
    ).toEqual({ defaultResumeId: "r-master", resumeHint: null })
  })

  it("falls back to the recommendation when the chosen resume is gone", () => {
    // An archived resume is not in the list, same as a deleted one.
    expect(
      resolveCoverLetterResumeDefault({
        resumes: [tailoredForThisJob, master],
        chosenResumeId: "r-archived",
        jobApplicationId: "app-1",
        jobTitle: "Web Developer",
      }).defaultResumeId,
    ).toBe("r-tailored")
  })

  it("recommends nothing without a job", () => {
    expect(
      resolveCoverLetterResumeDefault({
        resumes: [tailoredForThisJob, master],
        chosenResumeId: null,
        jobApplicationId: null,
        jobTitle: null,
      }),
    ).toEqual({ defaultResumeId: undefined, resumeHint: null })
  })
})

describe("getCoverLetterFormOptions", () => {
  it("scopes both queries to the user and excludes archived resumes", async () => {
    await getCoverLetterFormOptions("user-1", "app-1")

    expect(mockPrisma.resume.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", status: { not: "ARCHIVED" } },
      }),
    )
    expect(mockPrisma.jobApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    )
  })

  it("locks the named job and preselects the recommended resume", async () => {
    const options = await getCoverLetterFormOptions("user-1", "app-1")

    expect(options.lockedApplication).toEqual({
      id: "app-1",
      companyName: "Rose Eden LLC",
      jobTitle: "Web Developer",
      hasJobDescription: true,
    })
    expect(options.defaultResumeId).toBe("r-tailored")
    expect(options.resumeHint).toBe("Recommended: Rose Eden · Tailored for this job")
    // Only id/title/atsScore reach the client.
    expect(options.resumes).toEqual([
      { id: "r-tailored", title: "Rose Eden", atsScore: null },
      { id: "r-master", title: "Full-Stack Developer Resume", atsScore: 72 },
    ])
  })

  it("falls through to the plain form for a foreign or stale job id", async () => {
    const options = await getCoverLetterFormOptions("user-1", "someone-elses-app")

    expect(options.lockedApplication).toBeNull()
    expect(options.defaultResumeId).toBeUndefined()
    expect(options.resumeHint).toBeNull()
  })

  it("reports a too-short stored description as absent", async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      { ...application, job: { ...application.job, description: "Too short" } },
    ])

    const options = await getCoverLetterFormOptions("user-1", "app-1")

    expect(options.lockedApplication?.hasJobDescription).toBe(false)
  })
})
