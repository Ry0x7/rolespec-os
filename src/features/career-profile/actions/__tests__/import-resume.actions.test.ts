// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  getOrCreateCareerProfileId: vi.fn(),
  resume: { findFirst: vi.fn() },
  careerEvidence: { findMany: vi.fn(), createMany: vi.fn() },
  careerCapability: { findMany: vi.fn(), createMany: vi.fn() },
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    resume: mocks.resume,
    careerEvidence: mocks.careerEvidence,
    careerCapability: mocks.careerCapability,
  },
}))
vi.mock("../../services/career-profile.service", () => ({
  getOrCreateCareerProfileId: mocks.getOrCreateCareerProfileId,
}))

import { importResumeToCareerProfile } from "../import-resume.actions"

const OWN_PROFILE = "cp_owner"

function form(resumeId: string): FormData {
  const data = new FormData()
  data.set("resumeId", resumeId)
  return data
}

const RESUME = {
  id: "resume_1",
  title: "Master Resume",
  sections: [
    {
      type: "EXPERIENCE",
      title: "Experience",
      order: 1,
      items: [
        {
          order: 0,
          content: {
            role: "Frontend Engineer",
            company: "Acme",
            startDate: "2022-01",
            bullets: ["Built the design system"],
          },
        },
      ],
    },
    {
      type: "SKILLS",
      title: "Skills",
      order: 2,
      items: [{ order: 0, content: { category: "Languages", skills: ["TypeScript"] } }],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
  mocks.getOrCreateCareerProfileId.mockResolvedValue(OWN_PROFILE)
  mocks.resume.findFirst.mockResolvedValue(RESUME)
  mocks.careerEvidence.findMany.mockResolvedValue([])
  mocks.careerEvidence.createMany.mockResolvedValue({ count: 1 })
  mocks.careerCapability.findMany.mockResolvedValue([])
  mocks.careerCapability.createMany.mockResolvedValue({ count: 1 })
})

describe("importResumeToCareerProfile", () => {
  it("refuses an anonymous caller", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(importResumeToCareerProfile(form("resume_1"))).resolves.toEqual({
      error: "Unauthorized",
    })
    expect(mocks.resume.findFirst).not.toHaveBeenCalled()
  })

  it("scopes the resume lookup to the session user and refuses a foreign id", async () => {
    mocks.resume.findFirst.mockResolvedValue(null)

    await expect(importResumeToCareerProfile(form("resume_other"))).resolves.toEqual({
      error: "That resume does not exist.",
    })
    expect(mocks.resume.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resume_other", userId: "user_1" },
      })
    )
    expect(mocks.careerEvidence.createMany).not.toHaveBeenCalled()
    expect(mocks.careerCapability.createMany).not.toHaveBeenCalled()
  })

  it("writes candidates with resume provenance and returns the counts", async () => {
    const result = await importResumeToCareerProfile(form("resume_1"))

    expect(result).toEqual({
      success: true,
      resumeTitle: "Master Resume",
      evidenceCreated: 1,
      evidenceSkipped: 0,
      capabilitiesCreated: 1,
      capabilitiesSkipped: 0,
    })

    const evidence = mocks.careerEvidence.createMany.mock.calls[0][0].data[0]
    expect(evidence).toMatchObject({
      careerProfileId: OWN_PROFILE,
      kind: "EXPERIENCE",
      title: "Frontend Engineer",
      organization: "Acme",
      source: "RESUME_IMPORT_CANDIDATE",
      status: "CANDIDATE",
      metadata: {
        sourceResumeId: "resume_1",
        sourceResumeTitle: "Master Resume",
      },
    })
    expect(evidence).not.toHaveProperty("confirmedAt")

    const capability = mocks.careerCapability.createMany.mock.calls[0][0].data[0]
    expect(capability).toMatchObject({
      careerProfileId: OWN_PROFILE,
      name: "TypeScript",
      category: "Languages",
      confirmed: false,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/career-profile")
  })

  it("skips rows already present in the same profile", async () => {
    mocks.careerEvidence.findMany.mockResolvedValue([
      { kind: "EXPERIENCE", title: "Frontend Engineer", organization: "Acme" },
    ])
    mocks.careerCapability.findMany.mockResolvedValue([{ name: "typescript" }])

    const result = await importResumeToCareerProfile(form("resume_1"))

    expect(mocks.careerEvidence.createMany).not.toHaveBeenCalled()
    expect(mocks.careerCapability.createMany).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      resumeTitle: "Master Resume",
      evidenceCreated: 0,
      evidenceSkipped: 1,
      capabilitiesCreated: 0,
      capabilitiesSkipped: 1,
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects an empty resume id before touching the database", async () => {
    await expect(importResumeToCareerProfile(form(""))).resolves.toEqual({
      error: "Choose a resume to import.",
    })
    expect(mocks.resume.findFirst).not.toHaveBeenCalled()
  })
})
