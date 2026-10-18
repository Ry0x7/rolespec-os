import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  mockAuth,
  mockFindCareerProfileId,
  mockLoadCareerProfile,
  mockPrisma,
  mockRedirect,
  mockRevalidatePath,
  mockConsumeRateLimit,
  mockPolishMasterResume,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindCareerProfileId: vi.fn(),
  mockLoadCareerProfile: vi.fn(),
  mockPrisma: {
    careerRoleFamily: { findFirst: vi.fn() },
    resume: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
  mockRedirect: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockPolishMasterResume: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/features/career-profile/services/career-profile.service", () => ({
  findCareerProfileId: mockFindCareerProfileId,
  loadCareerProfile: mockLoadCareerProfile,
}))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_MASTER_POLISH: "ai:master-polish" },
  consumeRateLimit: mockConsumeRateLimit,
}))
vi.mock("../../services/polish-master-resume", () => ({
  polishMasterResume: mockPolishMasterResume,
}))

import {
  createResume,
  createRoleFamilyResume,
  deleteResume,
  duplicateResume,
  restoreResume,
  updateResume,
} from "../index"

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockFindCareerProfileId.mockResolvedValue("profile-1")
  mockLoadCareerProfile.mockResolvedValue({
    id: "profile-1",
    evidence: [],
    capabilities: [],
    targetRoles: [],
  })
  mockConsumeRateLimit.mockResolvedValue(true)
  // Default: the polish is a no-op, so every pre-existing assertion below sees
  // exactly the sections `assembleMasterResume` produced.
  mockPolishMasterResume.mockImplementation(async ({ sections }: { sections: unknown }) => ({
    sections,
    summary: null,
    polished: false,
  }))
  // In Next.js redirect() throws; mirror that so code after it never runs.
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
})

function validCreateResumeFormData() {
  const formData = new FormData()
  formData.set("title", "Master Resume")
  formData.set("targetRole", "Platform Engineer")
  formData.set("targetCompany", "Acme")
  formData.set("template", "MODERN")
  return formData
}

function validRoleFamilyResumeFormData() {
  const formData = new FormData()
  formData.set("title", "Platform Resume")
  formData.set("sourceResumeId", "resume-master")
  formData.set("roleFamilyId", "family-1")
  return formData
}

describe("createResume", () => {
  it("redirects unauthenticated callers before reading a profile or writing", async () => {
    mockAuth.mockResolvedValue(null)

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow("REDIRECT:/sign-in")
    expect(mockLoadCareerProfile).not.toHaveBeenCalled()
    expect(mockPrisma.resume.create).not.toHaveBeenCalled()
  })

  it("rejects invalid input before reading a profile or writing", async () => {
    const result = await createResume(new FormData())

    expect(result).toMatchObject({ error: "Invalid input" })
    expect(mockLoadCareerProfile).not.toHaveBeenCalled()
    expect(mockPrisma.resume.create).not.toHaveBeenCalled()
  })

  it("atomically persists sections assembled only from confirmed profile facts", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      id: "profile-1",
      careerGoals: "Become a VP",
      targetRoles: [{ title: "VP Engineering" }],
      evidence: [
        {
          kind: "EXPERIENCE",
          status: "CONFIRMED",
          title: "Engineer",
          organization: "Acme",
          details: "Built APIs.",
          outcome: "Cut latency by 20%.",
          startDate: new Date("2022-01-01T00:00:00.000Z"),
          endDate: null,
        },
        {
          kind: "ACHIEVEMENT",
          status: "CONFIRMED",
          title: "Engineering award",
          organization: null,
          details: null,
          outcome: "Recognized for reliability work.",
          startDate: null,
          endDate: null,
        },
        {
          kind: "PROJECT",
          status: "CONFIRMED",
          title: "Current project",
          startDate: new Date("2026-02-01T00:00:00.000Z"),
          endDate: null,
        },
        {
          kind: "EDUCATION",
          status: "CONFIRMED",
          title: "Part-time MSc",
          startDate: new Date("2025-09-01T00:00:00.000Z"),
          endDate: null,
        },
        {
          kind: "CERTIFICATION",
          status: "CONFIRMED",
          title: "Cloud Architect",
          organization: "Cloud Guild",
          startDate: new Date("2024-04-01T00:00:00.000Z"),
          endDate: new Date("2027-04-01T00:00:00.000Z"),
        },
        {
          kind: "CERTIFICATION",
          status: "CONFIRMED",
          title: "End-only credential",
          startDate: null,
          endDate: new Date("2028-08-01T00:00:00.000Z"),
        },
        {
          kind: "PROJECT",
          status: "CANDIDATE",
          title: "Unconfirmed project",
        },
        {
          kind: "EDUCATION",
          status: "ARCHIVED",
          title: "Archived education",
        },
      ],
      capabilities: [
        { name: "TypeScript", category: "Languages", confirmed: true },
        { name: "Rust", category: "Languages", confirmed: false },
      ],
    })
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-new" })

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-new"
    )

    expect(mockLoadCareerProfile).toHaveBeenCalledWith("user-1")
    expect(mockPrisma.resume.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        careerProfileId: "profile-1",
        title: "Master Resume",
        targetRole: "Platform Engineer",
        targetCompany: "Acme",
        template: "MODERN",
        sections: {
          create: [
            { type: "CONTACT", title: "Contact", order: 0, visible: true, items: { create: [] } },
            { type: "SUMMARY", title: "Summary", order: 1, visible: true, items: { create: [] } },
            {
              type: "EXPERIENCE",
              title: "Experience",
              order: 2,
              visible: true,
              items: {
                create: [
                  {
                    content: {
                      role: "Engineer",
                      company: "Acme",
                      startDate: "Jan 2022",
                      current: true,
                      bullets: ["Built APIs.", "Cut latency by 20%."],
                    },
                    order: 0,
                  },
                ],
              },
            },
            {
              type: "EDUCATION",
              title: "Education",
              order: 3,
              visible: true,
              items: {
                create: [
                  {
                    content: {
                      degree: "Part-time MSc",
                      startDate: "Sep 2025",
                      endDate: "Present",
                    },
                    order: 0,
                  },
                ],
              },
            },
            {
              type: "SKILLS",
              title: "Skills",
              order: 4,
              visible: true,
              items: {
                create: [
                  {
                    content: { category: "Languages", skills: ["TypeScript"] },
                    order: 0,
                  },
                ],
              },
            },
            {
              type: "PROJECTS",
              title: "Projects",
              order: 5,
              visible: true,
              items: {
                create: [
                  {
                    content: {
                      name: "Current project",
                      startDate: "Feb 2026",
                      endDate: "Present",
                      bullets: [],
                    },
                    order: 0,
                  },
                ],
              },
            },
            {
              type: "CERTIFICATIONS",
              title: "Certifications",
              order: 6,
              visible: true,
              items: {
                create: [
                  {
                    content: {
                      name: "End-only credential",
                      expirationDate: "Aug 2028",
                    },
                    order: 0,
                  },
                  {
                    content: {
                      name: "Cloud Architect",
                      organization: "Cloud Guild",
                      dateObtained: "Apr 2024",
                      expirationDate: "Apr 2027",
                    },
                    order: 1,
                  },
                ],
              },
            },
            {
              type: "CUSTOM",
              title: "Achievements",
              order: 7,
              visible: true,
              items: {
                create: [
                  {
                    content: {
                      title: "Engineering award",
                      content: "Recognized for reliability work.",
                    },
                    order: 0,
                  },
                ],
              },
            },
          ],
        },
      },
    })
    expect(mockPrisma.resume.create.mock.calls[0][0].data).not.toHaveProperty("variant")
    expect(mockPrisma.resume.create.mock.calls[0][0].data).not.toHaveProperty("roleFamilyId")
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resumes")
  })

  it("records the Career Profile it assembled the master from", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      id: "profile-9",
      evidence: [],
      capabilities: [],
      targetRoles: [],
    })
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-new" })

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-new"
    )

    const data = mockPrisma.resume.create.mock.calls[0][0].data
    expect(data.careerProfileId).toBe("profile-9")
    // A master has no source resume.
    expect(data).not.toHaveProperty("sourceResumeId")
  })

  it("creates standard empty sections when the loaded profile has no facts", async () => {
    mockLoadCareerProfile.mockResolvedValue({ evidence: [], capabilities: [], targetRoles: [] })
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-empty" })

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-empty"
    )

    const createCall = mockPrisma.resume.create.mock.calls[0][0]
    expect(createCall.data.sections.create).toEqual([
      { type: "CONTACT", title: "Contact", order: 0, visible: true, items: { create: [] } },
      { type: "SUMMARY", title: "Summary", order: 1, visible: true, items: { create: [] } },
      {
        type: "EXPERIENCE",
        title: "Experience",
        order: 2,
        visible: true,
        items: { create: [] },
      },
      {
        type: "EDUCATION",
        title: "Education",
        order: 3,
        visible: true,
        items: { create: [] },
      },
      { type: "SKILLS", title: "Skills", order: 4, visible: true, items: { create: [] } },
    ])
  })

  it("pre-fills CONTACT from the career profile contacts and the active target role", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", name: "Account Name", email: "sign-in@example.com" },
    })
    mockLoadCareerProfile.mockResolvedValue({
      evidence: [],
      capabilities: [],
      locations: ["Lagos, Nigeria", "Remote"],
      contactFullName: "Ada Lovelace",
      contactEmail: "ada@example.com",
      contactPhone: "+234 800 000 0000",
      contactLocation: "Lagos, Nigeria",
      linkedinUrl: "https://linkedin.com/in/ada",
      githubUrl: null,
      websiteUrl: null,
      targetRoles: [
        { title: "Paused direction", active: false },
        { title: "Operations Manager", active: true },
      ],
    })
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-contact" })

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-contact"
    )

    const createCall = mockPrisma.resume.create.mock.calls[0][0]
    expect(createCall.data.sections.create[0]).toEqual({
      type: "CONTACT",
      title: "Contact",
      order: 0,
      visible: true,
      items: {
        create: [
          {
            content: {
              fullName: "Ada Lovelace",
              jobTitle: "Operations Manager",
              email: "ada@example.com",
              phone: "+234 800 000 0000",
              location: "Lagos, Nigeria",
              linkedin: "https://linkedin.com/in/ada",
              github: "",
              website: "",
            },
            order: 0,
          },
        ],
      },
    })
  })

  it("falls back to the session account when the career profile has no contacts", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    })
    mockLoadCareerProfile.mockResolvedValue({
      evidence: [],
      capabilities: [],
      locations: ["Lagos, Nigeria"],
      contactFullName: null,
      contactEmail: null,
      contactPhone: null,
      contactLocation: null,
      linkedinUrl: null,
      githubUrl: null,
      websiteUrl: null,
      targetRoles: [{ title: "Operations Manager", active: true }],
    })
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-fallback" })

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-fallback"
    )

    const createCall = mockPrisma.resume.create.mock.calls[0][0]
    expect(createCall.data.sections.create[0].items.create[0].content).toEqual({
      fullName: "Ada Lovelace",
      jobTitle: "Operations Manager",
      email: "ada@example.com",
      phone: "",
      // The preferred-locations list is not a stand-in for where the user lives.
      location: "",
      linkedin: "",
      github: "",
      website: "",
    })
  })

  it("leaves CONTACT empty when the session knows neither a name nor an email", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", name: null, email: null } })
    mockLoadCareerProfile.mockResolvedValue({
      evidence: [],
      capabilities: [],
      locations: ["Lagos, Nigeria"],
      targetRoles: [{ title: "Operations Manager", active: true }],
    })
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-no-contact" })

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-no-contact"
    )

    const createCall = mockPrisma.resume.create.mock.calls[0][0]
    expect(createCall.data.sections.create[0]).toEqual({
      type: "CONTACT",
      title: "Contact",
      order: 0,
      visible: true,
      items: { create: [] },
    })
  })
})

describe("createResume — master polish", () => {
  /** One confirmed experience with weak notes: the case the polish exists for. */
  function profileWithWeakBullets() {
    return {
      careerGoals: "Move into operations management.",
      experienceLevel: "MID",
      targetRoles: [
        { title: "Operations Manager", active: true },
        { title: "Paused direction", active: false },
      ],
      evidence: [
        {
          kind: "EXPERIENCE",
          status: "CONFIRMED",
          title: "Social Media",
          organization: "The Nine Exports",
          details: "Manage social media for The Nine Exports",
          outcome: null,
          startDate: new Date("2023-01-01T00:00:00.000Z"),
          endDate: null,
        },
      ],
      capabilities: [],
    }
  }

  function sectionsFromLastCreate() {
    return mockPrisma.resume.create.mock.calls[0][0].data.sections.create
  }

  beforeEach(() => {
    mockLoadCareerProfile.mockResolvedValue(profileWithWeakBullets())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-polished" })
  })

  it("persists the polished sections and the generated summary in the SUMMARY item shape", async () => {
    mockPolishMasterResume.mockImplementation(
      async ({ sections }: { sections: Record<string, unknown>[] }) => ({
        sections: sections.map((section) =>
          section.type === "EXPERIENCE"
            ? {
                ...section,
                items: {
                  create: [
                    {
                      content: {
                        role: "Social Media",
                        company: "The Nine Exports",
                        startDate: "Jan 2023",
                        current: true,
                        bullets: ["Ran the social media program for The Nine Exports."],
                      },
                      order: 0,
                    },
                  ],
                },
              }
            : section
        ),
        summary: "Operations professional with export-sector social media experience.",
        polished: true,
      })
    )

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-polished"
    )

    const sections = sectionsFromLastCreate()
    const summary = sections.find(
      (section: { type: string }) => section.type === "SUMMARY"
    )
    expect(summary.items.create).toEqual([
      {
        content: { text: "Operations professional with export-sector social media experience." },
        order: 0,
      },
    ])
    const experience = sections.find(
      (section: { type: string }) => section.type === "EXPERIENCE"
    )
    expect(experience.items.create[0].content.bullets).toEqual([
      "Ran the social media program for The Nine Exports.",
    ])
  })

  it("passes only the already-loaded profile context, active target roles only", async () => {
    await expect(createResume(validCreateResumeFormData())).rejects.toThrow("REDIRECT:")

    expect(mockPolishMasterResume).toHaveBeenCalledTimes(1)
    const call = mockPolishMasterResume.mock.calls[0][0]
    expect(call.userId).toBe("user-1")
    expect(call.profileContext).toEqual({
      careerGoals: "Move into operations management.",
      experienceLevel: "MID",
      targetRoles: ["Operations Manager"],
    })
  })

  it("leaves the SUMMARY section empty when the polish returns no summary", async () => {
    mockPolishMasterResume.mockImplementation(
      async ({ sections }: { sections: unknown }) => ({
        sections,
        summary: null,
        polished: true,
      })
    )

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow("REDIRECT:")

    const summary = sectionsFromLastCreate().find(
      (section: { type: string }) => section.type === "SUMMARY"
    )
    expect(summary.items.create).toEqual([])
  })

  it("still creates the unpolished resume when the polish throws", async () => {
    mockPolishMasterResume.mockRejectedValue(new Error("provider exploded"))

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-polished"
    )

    const sections = sectionsFromLastCreate()
    const experience = sections.find(
      (section: { type: string }) => section.type === "EXPERIENCE"
    )
    expect(experience.items.create[0].content.bullets).toEqual([
      "Manage social media for The Nine Exports",
    ])
    const summary = sections.find(
      (section: { type: string }) => section.type === "SUMMARY"
    )
    expect(summary.items.create).toEqual([])
  })

  it("skips the polish entirely and still creates the resume when the limit is used up", async () => {
    mockConsumeRateLimit.mockResolvedValue(false)

    await expect(createResume(validCreateResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-polished"
    )

    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      "ai:master-polish",
      "user-1",
      expect.objectContaining({ max: expect.any(Number), windowMs: expect.any(Number) })
    )
    expect(mockPolishMasterResume).not.toHaveBeenCalled()
    const experience = sectionsFromLastCreate().find(
      (section: { type: string }) => section.type === "EXPERIENCE"
    )
    expect(experience.items.create[0].content.bullets).toEqual([
      "Manage social media for The Nine Exports",
    ])
  })
})

describe("createRoleFamilyResume", () => {
  it("redirects unauthenticated callers before parsing ownership or reading data", async () => {
    mockAuth.mockResolvedValue(null)

    await expect(createRoleFamilyResume(validRoleFamilyResumeFormData())).rejects.toThrow(
      "REDIRECT:/sign-in"
    )
    expect(mockFindCareerProfileId).not.toHaveBeenCalled()
    expect(mockPrisma.careerRoleFamily.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.resume.findFirst).not.toHaveBeenCalled()
  })

  it("rejects invalid input before resolving the profile or reading data", async () => {
    const result = await createRoleFamilyResume(new FormData())

    expect(result).toMatchObject({ error: "Invalid input" })
    expect(mockFindCareerProfileId).not.toHaveBeenCalled()
    expect(mockPrisma.careerRoleFamily.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.resume.findFirst).not.toHaveBeenCalled()
  })

  it("returns the profile readiness error when the caller has no Career Profile", async () => {
    mockFindCareerProfileId.mockResolvedValue(null)

    const result = await createRoleFamilyResume(validRoleFamilyResumeFormData())

    expect(result).toEqual({
      error: "Your career profile is not ready yet. Reload the page and try again.",
    })
    expect(mockPrisma.careerRoleFamily.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.resume.findFirst).not.toHaveBeenCalled()
  })

  it.each(["foreign-family", "missing-family"])(
    "does not disclose whether %s exists outside the caller's profile",
    async (roleFamilyId) => {
      mockPrisma.careerRoleFamily.findFirst.mockResolvedValue(null)
      const formData = validRoleFamilyResumeFormData()
      formData.set("roleFamilyId", roleFamilyId)

      const result = await createRoleFamilyResume(formData)

      expect(result).toEqual({ error: "That role family does not exist." })
      expect(mockPrisma.careerRoleFamily.findFirst).toHaveBeenCalledWith({
        where: { id: roleFamilyId, careerProfileId: "profile-1" },
        select: { id: true },
      })
      expect(mockPrisma.resume.findFirst).not.toHaveBeenCalled()
      expect(mockPrisma.resume.create).not.toHaveBeenCalled()
    }
  )

  it.each(["foreign", "archived", "missing", "non-master"])(
    "returns the same not-found result for a %s source",
    async () => {
      mockPrisma.careerRoleFamily.findFirst.mockResolvedValue({ id: "family-1" })
      mockPrisma.resume.findFirst.mockResolvedValue(null)

      const result = await createRoleFamilyResume(validRoleFamilyResumeFormData())

      expect(result).toEqual({ error: "Resume not found" })
      expect(mockPrisma.resume.findFirst).toHaveBeenCalledWith({
        where: {
          id: "resume-master",
          userId: "user-1",
          variant: "MASTER",
          status: { not: "ARCHIVED" },
        },
        select: {
          id: true,
          targetRole: true,
          template: true,
          sections: {
            select: {
              type: true,
              title: true,
              order: true,
              visible: true,
              items: {
                select: { content: true, metadata: true, order: true },
                orderBy: { order: "asc" },
              },
            },
            orderBy: { order: "asc" },
          },
        },
      })
      expect(mockPrisma.resume.create).not.toHaveBeenCalled()
    }
  )

  it("atomically clones factual sections and metadata while clearing the company target", async () => {
    mockPrisma.careerRoleFamily.findFirst.mockResolvedValue({ id: "family-1" })
    mockPrisma.resume.findFirst.mockResolvedValue({
      id: "resume-master",
      title: "Master Resume",
      targetRole: "Platform Engineer",
      targetCompany: "Job-specific Corp",
      template: "MODERN",
      variant: "MASTER",
      sections: [
        {
          type: "EXPERIENCE",
          title: "Experience",
          order: 2,
          visible: true,
          items: [
            {
              content: { role: "Engineer", bullets: ["Cut latency by 20%."] },
              metadata: { evidenceKind: "EXPERIENCE", confirmed: true },
              order: 0,
            },
          ],
        },
      ],
    })
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-role-family" })

    await expect(createRoleFamilyResume(validRoleFamilyResumeFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-role-family"
    )

    expect(mockFindCareerProfileId).toHaveBeenCalledWith("user-1")
    expect(mockPrisma.resume.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        careerProfileId: "profile-1",
        roleFamilyId: "family-1",
        sourceResumeId: "resume-master",
        variant: "ROLE_FAMILY",
        title: "Platform Resume",
        targetRole: "Platform Engineer",
        targetCompany: null,
        template: "MODERN",
        sections: {
          create: [
            {
              type: "EXPERIENCE",
              title: "Experience",
              order: 2,
              visible: true,
              items: {
                create: [
                  {
                    content: { role: "Engineer", bullets: ["Cut latency by 20%."] },
                    metadata: { evidenceKind: "EXPERIENCE", confirmed: true },
                    order: 0,
                  },
                ],
              },
            },
          ],
        },
      },
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resumes")
  })
})

describe("deleteResume", () => {
  it("redirects unauthenticated callers to sign-in", async () => {
    mockAuth.mockResolvedValue(null)

    await expect(deleteResume("resume-1")).rejects.toThrow("REDIRECT:/sign-in")
    expect(mockPrisma.resume.update).not.toHaveBeenCalled()
  })

  it("archives the resume scoped to the owner and revalidates the list", async () => {
    mockPrisma.resume.update.mockResolvedValue({ id: "resume-1" })

    const result = await deleteResume("resume-1")

    expect(result).toBeUndefined()
    expect(mockPrisma.resume.update).toHaveBeenCalledWith({
      where: { id: "resume-1", userId: "user-1" },
      data: { status: "ARCHIVED" },
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resumes")
  })

  it("returns an error when the update fails", async () => {
    mockPrisma.resume.update.mockRejectedValue(new Error("not found"))

    const result = await deleteResume("resume-1")

    expect(result?.error).toBe("Failed to delete resume. Please try again.")
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})

describe("updateResume", () => {
  it("redirects unauthenticated callers to sign-in", async () => {
    mockAuth.mockResolvedValue(null)

    await expect(updateResume("resume-1", { title: "New" })).rejects.toThrow(
      "REDIRECT:/sign-in"
    )
    expect(mockPrisma.resume.updateMany).not.toHaveBeenCalled()
  })

  it("rejects invalid input before touching the database", async () => {
    const result = await updateResume("resume-1", { title: "" })

    expect(result).toEqual({ error: "Invalid input" })
    expect(mockPrisma.resume.updateMany).not.toHaveBeenCalled()
  })

  it("updates a live resume owned by the caller and revalidates", async () => {
    mockPrisma.resume.updateMany.mockResolvedValue({ count: 1 })

    const result = await updateResume("resume-1", { template: "MODERN" })

    expect(result).toBeUndefined()
    // Ownership AND the ARCHIVED guard must be part of the write itself.
    expect(mockPrisma.resume.updateMany).toHaveBeenCalledWith({
      where: { id: "resume-1", userId: "user-1", status: { not: "ARCHIVED" } },
      data: { template: "MODERN" },
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resumes")
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resumes/resume-1")
  })

  it("rejects an archived resume the same way as a missing one", async () => {
    // Archived (soft-deleted) rows are excluded by the where clause, so the
    // write matches nothing.
    mockPrisma.resume.updateMany.mockResolvedValue({ count: 0 })

    const result = await updateResume("resume-1", { template: "MODERN" })

    expect(result?.error).toBe("Resume not found.")
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("returns an error when the update throws", async () => {
    mockPrisma.resume.updateMany.mockRejectedValue(new Error("db down"))

    const result = await updateResume("resume-1", { template: "MODERN" })

    expect(result?.error).toBe("Failed to update resume. Please try again.")
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})

describe("restoreResume", () => {
  it("redirects unauthenticated callers to sign-in", async () => {
    mockAuth.mockResolvedValue(null)

    await expect(restoreResume("resume-1")).rejects.toThrow("REDIRECT:/sign-in")
    expect(mockPrisma.resume.updateMany).not.toHaveBeenCalled()
  })

  it("restores only archived rows owned by the caller and revalidates", async () => {
    mockPrisma.resume.updateMany.mockResolvedValue({ count: 1 })

    const result = await restoreResume("resume-1")

    expect(result).toBeUndefined()
    // Ownership AND the ARCHIVED guard must be part of the write itself.
    expect(mockPrisma.resume.updateMany).toHaveBeenCalledWith({
      where: { id: "resume-1", userId: "user-1", status: "ARCHIVED" },
      data: { status: "DRAFT" },
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resumes")
  })

  it("returns an error when no archived row matched (wrong owner or not archived)", async () => {
    mockPrisma.resume.updateMany.mockResolvedValue({ count: 0 })

    const result = await restoreResume("resume-1")

    expect(result?.error).toBe("Resume not found.")
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("returns an error when the update throws", async () => {
    mockPrisma.resume.updateMany.mockRejectedValue(new Error("db down"))

    const result = await restoreResume("resume-1")

    expect(result?.error).toBe("Failed to restore resume. Please try again.")
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})

describe("duplicateResume", () => {
  it("rejects an archived resume the same way as a missing one", async () => {
    // Archived (soft-deleted) rows are excluded by the where clause.
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await duplicateResume("resume-1")

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resume-1", userId: "user-1", status: { not: "ARCHIVED" } },
      })
    )
    expect(mockPrisma.resume.create).not.toHaveBeenCalled()
  })

  it("copies a live resume while preserving its variant association", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      title: "Engineer",
      targetRole: null,
      targetCompany: null,
      template: "MODERN",
      variant: "ROLE_FAMILY",
      careerProfileId: "profile-1",
      roleFamilyId: "family-1",
      sections: [],
    })
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-2" })

    await expect(duplicateResume("resume-1")).rejects.toThrow("REDIRECT:/resumes/resume-2")
    expect(mockPrisma.resume.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        careerProfileId: "profile-1",
        roleFamilyId: "family-1",
        variant: "ROLE_FAMILY",
        title: "Engineer (Copy)",
      }),
    })
  })
})
