import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  mockAuth,
  mockFindCareerProfileId,
  mockPrisma,
  mockRedirect,
  mockRevalidatePath,
  mockConsumeRateLimit,
  mockGenerateJobTailorSuggestions,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindCareerProfileId: vi.fn(),
  mockPrisma: {
    jobApplication: { findFirst: vi.fn(), update: vi.fn() },
    resume: { findFirst: vi.fn(), create: vi.fn() },
  },
  mockRedirect: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockGenerateJobTailorSuggestions: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/features/career-profile/services/career-profile.service", () => ({
  findCareerProfileId: mockFindCareerProfileId,
}))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_RESUME_TAILOR: "resume:tailor" },
  consumeRateLimit: mockConsumeRateLimit,
}))
vi.mock("@/shared/lib/errors", () => ({
  rateLimited: (message: string) => new Error(message),
}))
vi.mock("@/shared/lib/ai-provider", () => ({
  AiDailyLimitError: class AiDailyLimitError extends Error {},
  AiKeyRequiredError: class AiKeyRequiredError extends Error {},
}))
vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ warn: vi.fn(), error: vi.fn() }),
}))
// The AI call is the only mocked pipeline stage: term extraction, grounding
// classification and the deterministic post-check run for real.
vi.mock("../../services/tailor-resume", () => ({
  generateJobTailorSuggestions: mockGenerateJobTailorSuggestions,
  MAX_TAILOR_SUMMARY_LENGTH: 500,
  MAX_TAILOR_BULLET_LENGTH: 220,
  MAX_TAILOR_SKILLS_LENGTH: 600,
}))

import { createJobTailoredResume } from "../tailor"
import { AiDailyLimitError } from "@/shared/lib/ai-provider"

function validFormData() {
  const formData = new FormData()
  formData.set("title", "Globex Application")
  formData.set("sourceResumeId", "resume-family")
  formData.set("jobApplicationId", "job-1")
  return formData
}

/** Owned tracked application; the description asks for things the resume lacks. */
const jobApplication = {
  id: "job-1",
  // Posting fields live on the `job` relation, not the mirrored columns.
  job: {
    title: "Senior Platform Engineer",
    companyName: "Globex",
    description:
      "We need Kubernetes production experience. TypeScript services. Reliability focus.",
  },
}

function sourceResume() {
  return {
    id: "resume-family",
    targetRole: "Platform Engineer",
    template: "MODERN",
    roleFamilyId: "family-1",
    sections: [
      {
        type: "SUMMARY",
        title: "Summary",
        order: 1,
        visible: true,
        items: [
          {
            content: { text: "Platform engineer focused on reliability." },
            metadata: null,
            order: 0,
          },
        ],
      },
      {
        type: "EXPERIENCE",
        title: "Experience",
        order: 2,
        visible: true,
        items: [
          {
            content: {
              role: "Engineer",
              company: "Acme",
              bullets: ["Cut latency by 20%.", "Organized the office party."],
            },
            metadata: { evidenceKind: "EXPERIENCE", confirmed: true },
            order: 0,
          },
        ],
      },
      {
        type: "SKILLS",
        title: "Skills",
        order: 3,
        visible: true,
        items: [
          {
            content: { category: "Languages", skills: ["TypeScript", "SQL"] },
            metadata: null,
            order: 0,
          },
        ],
      },
    ],
  }
}

/**
 * Same candidate, but with no summary section at all and a second, clearly
 * unrelated role — the two shapes the tailoring pass could not handle before.
 */
function sourceResumeWithoutSummary() {
  return {
    targetRole: "Platform Engineer",
    template: "MODERN",
    roleFamilyId: "family-1",
    sections: [
      {
        type: "CONTACT",
        title: "Contact",
        order: 0,
        visible: true,
        items: [{ content: { fullName: "Ada Byron" }, metadata: null, order: 0 }],
      },
      {
        type: "EXPERIENCE",
        title: "Experience",
        order: 1,
        visible: true,
        items: [
          {
            content: {
              role: "Engineer",
              company: "Acme",
              bullets: ["Cut latency by 20%.", "Shipped TypeScript services."],
            },
            metadata: null,
            order: 0,
          },
          {
            content: {
              role: "Barista",
              company: "Cafe Nero",
              bullets: ["Served coffee."],
            },
            metadata: null,
            order: 1,
          },
        ],
      },
      {
        type: "SKILLS",
        title: "Skills",
        order: 2,
        visible: true,
        items: [
          {
            content: { category: "Languages", skills: ["TypeScript", "SQL"] },
            metadata: null,
            order: 0,
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockFindCareerProfileId.mockResolvedValue("profile-1")
  mockConsumeRateLimit.mockResolvedValue(true)
  mockGenerateJobTailorSuggestions.mockResolvedValue({ suggestions: [] })
  // In Next.js redirect() throws; mirror that so code after it never runs.
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
})

describe("createJobTailoredResume", () => {
  it("redirects unauthenticated callers before parsing ownership or reading data", async () => {
    mockAuth.mockResolvedValue(null)

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/sign-in"
    )
    expect(mockFindCareerProfileId).not.toHaveBeenCalled()
    expect(mockPrisma.jobApplication.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.resume.findFirst).not.toHaveBeenCalled()
  })

  it("rejects invalid input before resolving the profile or reading data", async () => {
    const result = await createJobTailoredResume(new FormData())

    expect(result).toMatchObject({ error: "Invalid input" })
    expect(mockFindCareerProfileId).not.toHaveBeenCalled()
    expect(mockPrisma.jobApplication.findFirst).not.toHaveBeenCalled()
  })

  it("returns the profile readiness error when the caller has no Career Profile", async () => {
    mockFindCareerProfileId.mockResolvedValue(null)

    const result = await createJobTailoredResume(validFormData())

    expect(result).toEqual({
      error: "Your career profile is not ready yet. Reload the page and try again.",
    })
    expect(mockPrisma.jobApplication.findFirst).not.toHaveBeenCalled()
  })

  it.each(["foreign-job", "missing-job"])(
    "does not disclose whether %s exists outside the caller's tracker",
    async (jobApplicationId) => {
      mockPrisma.jobApplication.findFirst.mockResolvedValue(null)
      const formData = validFormData()
      formData.set("jobApplicationId", jobApplicationId)

      const result = await createJobTailoredResume(formData)

      expect(result).toEqual({ error: "That job application does not exist." })
      expect(mockPrisma.jobApplication.findFirst).toHaveBeenCalledWith({
        where: { id: jobApplicationId, userId: "user-1" },
        select: {
          id: true,
          job: { select: { title: true, companyName: true, description: true } },
          resumeId: true,
          submittedResume: { select: { variant: true, jobApplicationId: true } },
        },
      })
      expect(mockPrisma.resume.findFirst).not.toHaveBeenCalled()
      expect(mockPrisma.resume.create).not.toHaveBeenCalled()
    }
  )

  it.each(["foreign", "archived", "missing", "job-tailored"])(
    "returns the same not-found result for a %s source",
    async () => {
      mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
      mockPrisma.resume.findFirst.mockResolvedValue(null)

      const result = await createJobTailoredResume(validFormData())

      expect(result).toEqual({ error: "Resume not found" })
      expect(mockPrisma.resume.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "resume-family",
            userId: "user-1",
            variant: { in: ["MASTER", "ROLE_FAMILY"] },
            status: { not: "ARCHIVED" },
          },
        })
      )
      expect(mockPrisma.resume.create).not.toHaveBeenCalled()
      expect(mockGenerateJobTailorSuggestions).not.toHaveBeenCalled()
    }
  )

  it("rate-limits before the AI call and before any write", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockConsumeRateLimit.mockResolvedValue(false)

    const result = await createJobTailoredResume(validFormData())

    expect(result).toEqual({
      error: "Too many tailoring runs. Please wait a few minutes and try again.",
    })
    expect(mockConsumeRateLimit).toHaveBeenCalledWith("resume:tailor", "user-1", {
      max: 10,
      windowMs: 10 * 60 * 1000,
    })
    expect(mockGenerateJobTailorSuggestions).not.toHaveBeenCalled()
    expect(mockPrisma.resume.create).not.toHaveBeenCalled()
  })

  it("creates no resume when the AI call fails, and hides provider detail", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockGenerateJobTailorSuggestions.mockRejectedValue(new Error("provider exploded"))

    const result = await createJobTailoredResume(validFormData())

    expect(result).toEqual({ error: "AI tailoring failed. Please try again." })
    expect(mockPrisma.resume.create).not.toHaveBeenCalled()
  })

  it("surfaces the daily-limit message untouched", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockGenerateJobTailorSuggestions.mockRejectedValue(
      new AiDailyLimitError("Daily AI request limit reached.")
    )

    const result = await createJobTailoredResume(validFormData())

    expect(result).toEqual({ error: "Daily AI request limit reached." })
    expect(mockPrisma.resume.create).not.toHaveBeenCalled()
  })

  it("passes the posting only as untrusted context with pre-grounded terms", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const input = mockGenerateJobTailorSuggestions.mock.calls[0][0]
    expect(input.jobTitle).toBe("Senior Platform Engineer")
    expect(input.companyName).toBe("Globex")
    expect(input.jobDescription).toBe(jobApplication.job.description)
    // The resume never mentions Kubernetes, so it must arrive pre-barred.
    expect(input.groundedKeywords.unsupported).toContain("kubernetes")
    // The resume does mention TypeScript, so it is safe to emphasise.
    expect(input.groundedKeywords.supported).toContain("typescript")
  })

  it("applies grounded rewrites, removals and skill reorders atomically to a new copy", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [
        {
          // Grounded rewrite: stays within the source's own facts.
          targetId: "s1::i0::b0",
          action: "rewrite",
          suggested: "Cut latency by 20% for platform reliability.",
          reason: "Leads with the reliability result the posting asks for.",
        },
        {
          // Irrelevant bullet: selected out of the tailored copy.
          targetId: "s1::i0::b1",
          action: "remove",
          reason: "Does not serve this application.",
        },
        {
          // Reorder-only skills change: allowed.
          targetId: "s2::i0",
          action: "rewrite",
          suggested: "SQL, TypeScript",
          reason: "Puts the posting's stack first.",
        },
      ],
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    expect(mockPrisma.resume.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        careerProfileId: "profile-1",
        roleFamilyId: "family-1",
        jobApplicationId: "job-1",
        sourceResumeId: "resume-family",
        variant: "JOB_TAILORED",
        title: "Globex Application",
        targetRole: "Platform Engineer",
        targetCompany: "Globex",
        template: "MODERN",
        sections: {
          create: [
            {
              type: "SUMMARY",
              title: "Summary",
              order: 1,
              visible: true,
              items: {
                create: [
                  {
                    content: { text: "Platform engineer focused on reliability." },
                    metadata: undefined,
                    order: 0,
                  },
                ],
              },
            },
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
                      bullets: ["Cut latency by 20% for platform reliability."],
                    },
                    metadata: { evidenceKind: "EXPERIENCE", confirmed: true },
                    order: 0,
                  },
                ],
              },
            },
            {
              type: "SKILLS",
              title: "Skills",
              order: 3,
              visible: true,
              items: {
                create: [
                  {
                    content: { category: "Languages", skills: ["SQL", "TypeScript"] },
                    metadata: undefined,
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

  it("discards a rewrite that claims a posting term the resume cannot back", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [
        {
          // "Kubernetes" appears only in the posting — a barred claim.
          targetId: "s0::i0",
          action: "rewrite",
          suggested: "Platform engineer running Kubernetes in production.",
          reason: "Matches the posting's stack.",
        },
      ],
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const created = mockPrisma.resume.create.mock.calls[0][0].data
    expect(created.sections.create[0].items.create[0].content).toEqual({
      text: "Platform engineer focused on reliability.",
    })
  })

  it("discards a skills suggestion that adds an entry instead of reordering", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: "s2::i0",
          action: "rewrite",
          suggested: "TypeScript, SQL, Kubernetes",
          reason: "Adds the posting's stack.",
        },
        {
          // Removal is bullets-only; a skills removal must be ignored.
          targetId: "s2::i0",
          action: "remove",
          reason: "Not relevant.",
        },
      ],
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const created = mockPrisma.resume.create.mock.calls[0][0].data
    expect(created.sections.create[2].items.create[0].content).toEqual({
      category: "Languages",
      skills: ["TypeScript", "SQL"],
    })
  })

  it("ignores invented target ids", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: "s9::i9::b9",
          action: "rewrite",
          suggested: "Fabricated text.",
          reason: "Invented target.",
        },
      ],
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const created = mockPrisma.resume.create.mock.calls[0][0].data
    expect(created.sections.create[1].items.create[0].content.bullets).toEqual([
      "Cut latency by 20%.",
      "Organized the office party.",
    ])
  })

  it("asks for a generated summary only when the source has none", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    expect(mockGenerateJobTailorSuggestions.mock.calls[0][0].needsSummary).toBe(false)
  })

  it("inserts a grounded generated summary under Contact when the source has none", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResumeWithoutSummary())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [],
      generatedSummary:
        "Engineer at Acme who cut latency by 20% and shipped TypeScript services.",
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    expect(mockGenerateJobTailorSuggestions.mock.calls[0][0].needsSummary).toBe(true)
    const created = mockPrisma.resume.create.mock.calls[0][0].data
    expect(created.sections.create.map((s: { type: string; order: number }) => [s.type, s.order]))
      .toEqual([
        ["CONTACT", 0],
        ["SUMMARY", 1],
        ["EXPERIENCE", 2],
        ["SKILLS", 3],
      ])
    expect(created.sections.create[1]).toMatchObject({
      title: "Summary",
      visible: true,
      items: {
        create: [
          {
            content: {
              text: "Engineer at Acme who cut latency by 20% and shipped TypeScript services.",
            },
            order: 0,
          },
        ],
      },
    })
  })

  it("fills an existing but empty summary section instead of adding a second one", async () => {
    const source = sourceResumeWithoutSummary()
    source.sections.splice(1, 0, {
      type: "SUMMARY",
      title: "Summary",
      order: 1,
      visible: true,
      items: [{ content: { text: "" }, metadata: null, order: 0 }],
    } as unknown as (typeof source.sections)[number])
    source.sections.forEach((section, index) => {
      section.order = index
    })
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(source)
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [],
      generatedSummary: "Engineer at Acme who cut latency by 20%.",
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const created = mockPrisma.resume.create.mock.calls[0][0].data
    const summaries = created.sections.create.filter(
      (s: { type: string }) => s.type === "SUMMARY"
    )
    expect(summaries).toHaveLength(1)
    expect(summaries[0].items.create[0].content).toEqual({
      text: "Engineer at Acme who cut latency by 20%.",
    })
    // No section was inserted, so the source's own ordering is carried through.
    expect(
      created.sections.create.map((s: { type: string; order: number }) => [s.type, s.order])
    ).toEqual([
      ["CONTACT", 0],
      ["SUMMARY", 1],
      ["EXPERIENCE", 2],
      ["SKILLS", 3],
    ])
  })

  it("drops a generated summary that claims a barred posting term", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResumeWithoutSummary())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [],
      // "Kubernetes" appears only in the posting.
      generatedSummary: "Engineer at Acme running Kubernetes in production.",
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const created = mockPrisma.resume.create.mock.calls[0][0].data
    expect(
      created.sections.create.map((s: { type: string }) => s.type)
    ).not.toContain("SUMMARY")
  })

  it("ignores a generated summary when the source already has one", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResume())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [],
      generatedSummary: "Engineer at Acme who cut latency by 20%.",
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const created = mockPrisma.resume.create.mock.calls[0][0].data
    expect(created.sections.create[0].items.create[0].content).toEqual({
      text: "Platform engineer focused on reliability.",
    })
  })

  it("drops a whole unrelated experience item and renumbers what is left", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResumeWithoutSummary())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: "s1::i1",
          action: "remove-item",
          suggested: null,
          reason: "Hospitality work does not serve a platform engineering role.",
        },
      ],
      generatedSummary: null,
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const created = mockPrisma.resume.create.mock.calls[0][0].data
    const experience = created.sections.create.find(
      (s: { type: string }) => s.type === "EXPERIENCE"
    )
    expect(experience.items.create).toEqual([
      {
        content: {
          role: "Engineer",
          company: "Acme",
          bullets: ["Cut latency by 20%.", "Shipped TypeScript services."],
        },
        metadata: undefined,
        order: 0,
      },
    ])
  })

  it("never lets item exclusions empty the experience section", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResumeWithoutSummary())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [
        { targetId: "s1::i0", action: "remove-item", suggested: null, reason: "No match." },
        { targetId: "s1::i1", action: "remove-item", suggested: null, reason: "No match." },
      ],
      generatedSummary: null,
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const created = mockPrisma.resume.create.mock.calls[0][0].data
    const experience = created.sections.create.find(
      (s: { type: string }) => s.type === "EXPERIENCE"
    )
    // The first (most recent) role survives regardless of what was asked for.
    expect(experience.items.create).toHaveLength(1)
    expect(experience.items.create[0].content.role).toBe("Engineer")
  })

  it("ignores a remove-item aimed at anything but an experience item", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(sourceResumeWithoutSummary())
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [
        // A skills item and a bullet — neither is an experience-item target.
        { targetId: "s2::i0", action: "remove-item", suggested: null, reason: "No." },
        { targetId: "s1::i0::b0", action: "remove-item", suggested: null, reason: "No." },
      ],
      generatedSummary: null,
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    const created = mockPrisma.resume.create.mock.calls[0][0].data
    const skills = created.sections.create.find((s: { type: string }) => s.type === "SKILLS")
    const experience = created.sections.create.find(
      (s: { type: string }) => s.type === "EXPERIENCE"
    )
    expect(skills.items.create).toHaveLength(1)
    expect(experience.items.create).toHaveLength(2)
    expect(experience.items.create[0].content.bullets).toEqual([
      "Cut latency by 20%.",
      "Shipped TypeScript services.",
    ])
  })

  it("leaves the source resume untouched while inserting and excluding", async () => {
    const source = sourceResumeWithoutSummary()
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue(source)
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
    mockGenerateJobTailorSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: "s1::i0::b0",
          action: "rewrite",
          suggested: "Cut latency by 20% across the platform.",
          reason: "Leads with the result.",
        },
        { targetId: "s1::i1", action: "remove-item", suggested: null, reason: "Unrelated." },
      ],
      generatedSummary: "Engineer at Acme who cut latency by 20%.",
    })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    expect(source).toEqual(sourceResumeWithoutSummary())
  })

  it("copies an empty source deterministically without spending an AI call", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(jobApplication)
    mockPrisma.resume.findFirst.mockResolvedValue({
      targetRole: null,
      template: "MINIMAL",
      roleFamilyId: null,
      sections: [],
    })
    mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })

    await expect(createJobTailoredResume(validFormData())).rejects.toThrow(
      "REDIRECT:/resumes/resume-tailored"
    )

    expect(mockGenerateJobTailorSuggestions).not.toHaveBeenCalled()
    expect(mockPrisma.resume.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        variant: "JOB_TAILORED",
        jobApplicationId: "job-1",
        targetCompany: "Globex",
        roleFamilyId: null,
        sections: { create: [] },
      }),
    })
  })

  // The point of tailoring is that this job goes out with this resume, so the
  // new resume becomes the chosen one unless the user already chose a resume
  // tailored to this same application.
  describe("chosen-resume carry-over", () => {
    function run() {
      mockPrisma.resume.findFirst.mockResolvedValue({
        targetRole: null,
        template: "MINIMAL",
        roleFamilyId: null,
        sections: [],
      })
      mockPrisma.resume.create.mockResolvedValue({ id: "resume-tailored" })
      return expect(createJobTailoredResume(validFormData())).rejects.toThrow(
        "REDIRECT:/resumes/resume-tailored"
      )
    }

    it("sets the tailored resume as the chosen resume when there is no choice yet", async () => {
      mockPrisma.jobApplication.findFirst.mockResolvedValue({
        ...jobApplication,
        resumeId: null,
        submittedResume: null,
      })

      await run()

      expect(mockPrisma.jobApplication.update).toHaveBeenCalledWith({
        where: { id: "job-1", userId: "user-1" },
        data: { resumeId: "resume-tailored" },
      })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/jobs")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/jobs/job-1")
    })

    it("opens the editor with the job application it was tailored for as ?jobId=", async () => {
      mockPrisma.jobApplication.findFirst.mockResolvedValue({
        ...jobApplication,
        resumeId: null,
        submittedResume: null,
      })

      await run()

      expect(mockRedirect).toHaveBeenCalledWith("/resumes/resume-tailored?jobId=job-1")
    })

    it("replaces a master or role family choice, which was only a default", async () => {
      for (const variant of ["MASTER", "ROLE_FAMILY"] as const) {
        vi.clearAllMocks()
        mockAuth.mockResolvedValue({ user: { id: "user-1" } })
        mockFindCareerProfileId.mockResolvedValue("profile-1")
        mockConsumeRateLimit.mockResolvedValue(true)
        mockRedirect.mockImplementation((url: string) => {
          throw new Error(`REDIRECT:${url}`)
        })
        mockPrisma.jobApplication.findFirst.mockResolvedValue({
          ...jobApplication,
          resumeId: "resume-master",
          submittedResume: { variant, jobApplicationId: null },
        })

        await run()

        expect(mockPrisma.jobApplication.update).toHaveBeenCalledWith({
          where: { id: "job-1", userId: "user-1" },
          data: { resumeId: "resume-tailored" },
        })
      }
    })

    it("keeps an explicit earlier choice of a resume tailored to this application", async () => {
      mockPrisma.jobApplication.findFirst.mockResolvedValue({
        ...jobApplication,
        resumeId: "resume-tailored-earlier",
        submittedResume: {
          variant: "JOB_TAILORED",
          jobApplicationId: "job-1",
        },
      })

      await run()

      expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
      expect(mockPrisma.resume.create).toHaveBeenCalled()
    })

    it("replaces a resume tailored to a different application", async () => {
      mockPrisma.jobApplication.findFirst.mockResolvedValue({
        ...jobApplication,
        resumeId: "resume-tailored-elsewhere",
        submittedResume: {
          variant: "JOB_TAILORED",
          jobApplicationId: "job-2",
        },
      })

      await run()

      expect(mockPrisma.jobApplication.update).toHaveBeenCalledWith({
        where: { id: "job-1", userId: "user-1" },
        data: { resumeId: "resume-tailored" },
      })
    })

    it("never writes to an application the caller does not own", async () => {
      // Foreign and missing are the same boundary: the scoped read returns null.
      mockPrisma.jobApplication.findFirst.mockResolvedValue(null)

      const result = await createJobTailoredResume(validFormData())

      expect(result).toEqual({ error: "That job application does not exist." })
      expect(mockPrisma.resume.create).not.toHaveBeenCalled()
      expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
    })
  })
})
