import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  mockAuth,
  mockPrisma,
  mockGenerateATSEnhanceSuggestions,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    resume: { findUnique: vi.fn() },
  },
  mockGenerateATSEnhanceSuggestions: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("../../services/enhance-ats", () => ({
  generateATSEnhanceSuggestions: mockGenerateATSEnhanceSuggestions,
}))

const { mockConsumeRateLimit, mockRecordAttempt } = vi.hoisted(() => ({
  mockConsumeRateLimit: vi.fn(),
  mockRecordAttempt: vi.fn(),
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_RESUME_ENHANCE: "ai:resume-enhance" },
  consumeRateLimit: mockConsumeRateLimit,
  recordAttempt: mockRecordAttempt,
}))

import { enhanceResumeFromATS, type EnhanceResumeInput } from "../enhance"
import {
  MAX_ENHANCE_JOB_DESCRIPTION_LENGTH,
  MAX_ENHANCE_LABEL_LENGTH,
  MAX_ENHANCE_TARGET_TEXT_LENGTH,
} from "../../constants/enhance"


const bulletTarget = {
  targetId: "sec-1::item-1::b0",
  field: "bullet" as const,
  text: "Worked on checkout",
  label: "Experience — Engineer @ Acme",
}

const summaryTarget = {
  targetId: "sec-0::item-0::summary",
  field: "summary" as const,
  text: "Engineer who has done things.",
  label: "Professional summary",
}

const skillsTarget = {
  targetId: "sec-2::item-2::skills",
  field: "skills" as const,
  text: "TypeScript, Go",
  label: "Skills — Languages",
}

const validInput: EnhanceResumeInput = {
  resumeId: "resume-1",
  targets: [bulletTarget, summaryTarget],
  ats: {
    issues: [
      {
        severity: "warning",
        category: "impact",
        message: "Bullets lack measurable outcomes",
        section: "Experience",
        suggestion: "Add outcomes",
      },
    ],
    suggestions: [
      {
        category: "keywords",
        title: "Mention Kubernetes",
        description: "The job description requires Kubernetes",
        priority: "high",
      },
    ],
    missingKeywords: ["Kubernetes", "Terraform"],
  },
  jobDescription: "Own the payments platform. Kubernetes required.",
}

/**
 * Stored resume rows as `serializeSections` sees them. The default fixture
 * mentions both of the ATS "missing" keywords so they classify as supported.
 */
const groundedSections = [
  {
    id: "sec-1",
    type: "EXPERIENCE",
    title: "Experience",
    order: 0,
    visible: true,
    items: [
      {
        id: "item-1",
        order: 0,
        content: {
          role: "Engineer",
          company: "Acme",
          startDate: "2021",
          current: true,
          bullets: [
            "Ran the checkout service on Kubernetes, provisioned with Terraform.",
          ],
        },
      },
    ],
  },
]

describe("enhanceResumeFromATS", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsumeRateLimit.mockResolvedValue(true)
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      userId: "user-1",
      targetRole: "Backend Engineer",
      targetCompany: "Stripe",
      // Evidence for the fixture's missing keywords, so the default case
      // exercises post-processing rather than the grounding guard. The
      // grounding guard has its own describe block below.
      sections: groundedSections,
    })
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: bulletTarget.targetId,
          action: "rewrite",
          suggested: "Rebuilt the checkout service on Kubernetes",
          reason: "Addresses the missing Kubernetes keyword",
        },
      ],
    })
  })

  it("returns UNAUTHORIZED without a session", async () => {
    mockAuth.mockResolvedValue(null)

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({ success: false, error: "Unauthorized", code: "UNAUTHORIZED" })
    expect(mockPrisma.resume.findUnique).not.toHaveBeenCalled()
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("returns VALIDATION for an empty resumeId", async () => {
    const result = await enhanceResumeFromATS({ ...validInput, resumeId: "" })

    expect(result).toEqual({ success: false, error: "Invalid input", code: "VALIDATION" })
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("returns VALIDATION when there are no targets at all", async () => {
    const result = await enhanceResumeFromATS({ ...validInput, targets: [] })

    expect(result).toEqual({ success: false, error: "Invalid input", code: "VALIDATION" })
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("returns VALIDATION when every target is blank", async () => {
    const result = await enhanceResumeFromATS({
      ...validInput,
      targets: [{ ...bulletTarget, text: "   " }],
    })

    expect(result).toEqual({
      success: false,
      error: "Nothing to enhance yet — write a summary or some bullets first.",
      code: "VALIDATION",
    })
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("returns VALIDATION when missingKeywords is not an array of strings", async () => {
    const result = await enhanceResumeFromATS({
      ...validInput,
      ats: { ...validInput.ats, missingKeywords: "Kubernetes" as never },
    })

    expect(result).toEqual({ success: false, error: "Invalid input", code: "VALIDATION" })
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("returns VALIDATION for an absurd jobDescription or keyword count", async () => {
    const longJd = await enhanceResumeFromATS({
      ...validInput,
      jobDescription: "z".repeat(5001),
    })
    const tooManyKeywords = await enhanceResumeFromATS({
      ...validInput,
      ats: {
        ...validInput.ats,
        missingKeywords: Array.from({ length: 41 }, (_, i) => `kw${i}`),
      },
    })

    const invalid = { success: false, error: "Invalid input", code: "VALIDATION" }
    expect(longJd).toEqual(invalid)
    expect(tooManyKeywords).toEqual(invalid)
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("accepts input sitting exactly on the caps the client truncates to", async () => {
    const result = await enhanceResumeFromATS({
      ...validInput,
      targets: [
        {
          ...bulletTarget,
          text: "b".repeat(MAX_ENHANCE_TARGET_TEXT_LENGTH),
          label: "L".repeat(MAX_ENHANCE_LABEL_LENGTH),
        },
      ],
      jobDescription: "j".repeat(MAX_ENHANCE_JOB_DESCRIPTION_LENGTH),
    })

    expect(result.success).toBe(true)
    expect(mockGenerateATSEnhanceSuggestions).toHaveBeenCalledTimes(1)
  })

  it("accepts a quality-run payload: no keywords, but real issues", async () => {
    // A Resume Quality analysis never produces missingKeywords, so Enhance has
    // to unlock on issues alone.
    const result = await enhanceResumeFromATS({
      ...validInput,
      ats: { ...validInput.ats, suggestions: [], missingKeywords: [] },
      jobDescription: undefined,
    })

    expect(result.success).toBe(true)
    expect(mockGenerateATSEnhanceSuggestions).toHaveBeenCalledTimes(1)
  })

  it("returns NO_ANALYSIS when the ATS payload carries no findings", async () => {
    const result = await enhanceResumeFromATS({
      ...validInput,
      ats: { issues: [], suggestions: [], missingKeywords: [] },
    })

    expect(result).toEqual({
      success: false,
      error: "Run Analyze first so there are ATS findings to work from.",
      code: "NO_ANALYSIS",
    })
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("returns NOT_FOUND when the resume is not owned by the user", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({ success: false, error: "Resume not found", code: "NOT_FOUND" })
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("returns NOT_FOUND when the resume is archived", async () => {
    // Archived (soft-deleted) rows are excluded by the where clause.
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({ success: false, error: "Resume not found", code: "NOT_FOUND" })
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "ARCHIVED" } }),
      })
    )
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("calls the AI exactly once", async () => {
    await enhanceResumeFromATS(validInput)

    expect(mockGenerateATSEnhanceSuggestions).toHaveBeenCalledTimes(1)
  })

  it("reports AI_FAILED when the AI call fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mockGenerateATSEnhanceSuggestions.mockRejectedValue(new Error("model down"))

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({
      success: false,
      error: "AI enhance failed. Please try again.",
      code: "AI_FAILED",
    })
    consoleError.mockRestore()
  })

  it("forwards the trimmed targets and ATS findings to the service", async () => {
    await enhanceResumeFromATS(validInput)

    const call = mockGenerateATSEnhanceSuggestions.mock.calls[0][0]
    expect(call.targets).toEqual([bulletTarget, summaryTarget])
    expect(call.issues).toEqual(validInput.ats.issues)
    expect(call.suggestions).toEqual(validInput.ats.suggestions)
    // The service never receives a raw missing-keyword list any more.
    expect(call.missingKeywords).toBeUndefined()
    expect(call.groundedKeywords.supported).toEqual(["Kubernetes", "Terraform"])
    expect(call.groundedKeywords.unsupported).toEqual([])
    expect(call.jobDescription).toBe(validInput.jobDescription)
    expect(call.targetRole).toBe("Backend Engineer")
    expect(call.targetCompany).toBe("Stripe")
  })

  it("forwards the ATS scores to the service when supplied", async () => {
    const scores = {
      formatting: 80,
      keywords: 42,
      impact: 55,
      completeness: 90,
      readability: 70,
    }

    await enhanceResumeFromATS({
      ...validInput,
      ats: { ...validInput.ats, overallScore: 63, scores },
    })

    const call = mockGenerateATSEnhanceSuggestions.mock.calls[0][0]
    expect(call.overallScore).toBe(63)
    expect(call.scores).toEqual(scores)
  })

  it("leaves the scores undefined when the caller omits them", async () => {
    await enhanceResumeFromATS(validInput)

    const call = mockGenerateATSEnhanceSuggestions.mock.calls[0][0]
    expect(call.overallScore).toBeUndefined()
    expect(call.scores).toBeUndefined()
  })

  it("returns VALIDATION for out-of-range or incomplete scores", async () => {
    const scores = {
      formatting: 80,
      keywords: 42,
      impact: 55,
      completeness: 90,
      readability: 70,
    }

    const badOverall = await enhanceResumeFromATS({
      ...validInput,
      ats: { ...validInput.ats, overallScore: 101, scores },
    })
    const negativeCategory = await enhanceResumeFromATS({
      ...validInput,
      ats: { ...validInput.ats, scores: { ...scores, impact: -1 } },
    })
    const missingCategory = await enhanceResumeFromATS({
      ...validInput,
      ats: {
        ...validInput.ats,
        scores: { formatting: 80, keywords: 42, impact: 55, completeness: 90 } as never,
      },
    })

    const invalid = { success: false, error: "Invalid input", code: "VALIDATION" }
    expect(badOverall).toEqual(invalid)
    expect(negativeCategory).toEqual(invalid)
    expect(missingCategory).toEqual(invalid)
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("returns the resolved suggestions on success", async () => {
    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({
      success: true,
      grounding: [],
      suggestions: [
        {
          targetId: bulletTarget.targetId,
          action: "rewrite",
          suggested: "Rebuilt the checkout service on Kubernetes",
          reason: "Addresses the missing Kubernetes keyword",
        },
      ],
    })
  })

  it("drops suggestions for unknown target ids", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        { targetId: "nope::nope::b0", suggested: "Invented target", reason: "because" },
        {
          targetId: bulletTarget.targetId,
          suggested: "Rebuilt checkout on Kubernetes",
          reason: "Missing keyword",
        },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({
      success: true,
      grounding: [],
      suggestions: [
        {
          targetId: bulletTarget.targetId,
          action: "rewrite",
          suggested: "Rebuilt checkout on Kubernetes",
          reason: "Missing keyword",
        },
      ],
    })
  })

  it("drops suggestions identical to the original text and keeps only the first per target", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        { targetId: bulletTarget.targetId, suggested: "  Worked on checkout  ", reason: "no-op" },
        { targetId: summaryTarget.targetId, suggested: "First rewrite", reason: "first" },
        { targetId: summaryTarget.targetId, suggested: "Second rewrite", reason: "duplicate" },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({
      success: true,
      grounding: [],
      suggestions: [
        {
          targetId: summaryTarget.targetId,
          action: "rewrite",
          suggested: "First rewrite",
          reason: "first",
        },
      ],
    })
  })

  it("strips bullet glyphs and caps the length per field", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        { targetId: bulletTarget.targetId, suggested: `• ${"b".repeat(300)}`, reason: "long" },
        { targetId: summaryTarget.targetId, suggested: "s".repeat(600), reason: "long" },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.suggestions[0].suggested).toBe("b".repeat(220))
    expect(result.suggestions[1].suggested).toBe("s".repeat(500))
  })

  it("accepts skills targets and forwards them to the service", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: skillsTarget.targetId,
          action: "rewrite",
          suggested: "TypeScript, Go, Kubernetes",
          reason: "Adds the missing Kubernetes keyword",
        },
      ],
    })

    const result = await enhanceResumeFromATS({
      ...validInput,
      targets: [...validInput.targets, skillsTarget],
    })

    expect(mockGenerateATSEnhanceSuggestions.mock.calls[0][0].targets).toContainEqual(
      skillsTarget
    )
    expect(result).toEqual({
      success: true,
      grounding: [],
      suggestions: [
        {
          targetId: skillsTarget.targetId,
          action: "rewrite",
          suggested: "TypeScript, Go, Kubernetes",
          reason: "Adds the missing Kubernetes keyword",
        },
      ],
    })
  })

  it("caps a skills rewrite at 600 characters without stripping list punctuation", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        { targetId: skillsTarget.targetId, suggested: "s".repeat(700), reason: "long" },
      ],
    })

    const result = await enhanceResumeFromATS({
      ...validInput,
      targets: [skillsTarget],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.suggestions[0].suggested).toBe("s".repeat(600))
  })

  it("returns VALIDATION for a field outside the allowed set", async () => {
    const result = await enhanceResumeFromATS({
      ...validInput,
      targets: [{ ...skillsTarget, field: "certifications" as never }],
    })

    expect(result).toEqual({ success: false, error: "Invalid input", code: "VALIDATION" })
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("succeeds with an empty list when nothing usable comes back", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({ suggestions: [] })

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({ success: true, grounding: [], suggestions: [] })
  })

  it("succeeds with an empty list when every candidate is dropped in post-processing", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [{ targetId: "nope::nope::b0", suggested: "Invented target", reason: "why" }],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({ success: true, grounding: [], suggestions: [] })
  })

  it("surfaces the add-your-key message instead of the generic AI failure", async () => {
    const { AiKeyRequiredError } = await import("@/shared/lib/ai-provider")
    mockGenerateATSEnhanceSuggestions.mockRejectedValue(new AiKeyRequiredError())

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({
      success: false,
      error: "Add your API key in Settings → AI to use AI features.",
      code: "AI_FAILED",
    })
  })

  it("keeps any other AI failure generic", async () => {
    mockGenerateATSEnhanceSuggestions.mockRejectedValue(
      new Error("openai 500: upstream connect error at 10.0.0.7"),
    )

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({
      success: false,
      error: "AI enhance failed. Please try again.",
      code: "AI_FAILED",
    })
  })

  it("refuses without an AI call when the enhance limit is used up", async () => {
    mockConsumeRateLimit.mockResolvedValue(false)

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({
      success: false,
      error: "Too many enhance runs. Please wait a few minutes and try again.",
      code: "RATE_LIMITED",
    })
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
    expect(mockRecordAttempt).not.toHaveBeenCalled()
  })

  it("consumes one attempt per allowed run", async () => {
    await enhanceResumeFromATS(validInput)

    expect(mockConsumeRateLimit).toHaveBeenCalledWith("ai:resume-enhance", "user-1", {
      max: 10,
      windowMs: 10 * 60 * 1000,
    })
    // The consume writes its own row; the separate record call is gone.
    expect(mockRecordAttempt).not.toHaveBeenCalled()
  })
})

describe("enhanceResumeFromATS removals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsumeRateLimit.mockResolvedValue(true)
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      userId: "user-1",
      targetRole: "Backend Engineer",
      targetCompany: "Stripe",
      sections: groundedSections,
    })
  })

  it("keeps a removal for a bullet target and carries no suggested text", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: bulletTarget.targetId,
          action: "remove",
          reason: "Unrelated to the payments role",
        },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({
      success: true,
      grounding: [],
      suggestions: [
        {
          targetId: bulletTarget.targetId,
          action: "remove",
          reason: "Unrelated to the payments role",
        },
      ],
    })
  })

  it("ignores any suggested text the model sends with a removal", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: bulletTarget.targetId,
          action: "remove",
          suggested: "• a rewrite nobody asked for",
          reason: "Filler",
        },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.suggestions[0].suggested).toBeUndefined()
  })

  it("rejects a removal aimed at a summary or a skills target", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        { targetId: summaryTarget.targetId, action: "remove", reason: "Too long" },
        { targetId: skillsTarget.targetId, action: "remove", reason: "Irrelevant skills" },
      ],
    })

    const result = await enhanceResumeFromATS({
      ...validInput,
      targets: [...validInput.targets, skillsTarget],
    })

    expect(result).toEqual({ success: true, grounding: [], suggestions: [] })
  })

  it("rejects a removal whose target id is not bullet-shaped", async () => {
    // Defence in depth: the id carries the bullet index the store splices by.
    const oddTarget = { ...bulletTarget, targetId: "sec-1::item-1::bullet" }
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [{ targetId: oddTarget.targetId, action: "remove", reason: "Filler" }],
    })

    const result = await enhanceResumeFromATS({ ...validInput, targets: [oddTarget] })

    expect(result).toEqual({ success: true, grounding: [], suggestions: [] })
  })

  it("drops a rewrite that arrives with no suggested text", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        { targetId: bulletTarget.targetId, action: "rewrite", reason: "forgot the text" },
        { targetId: summaryTarget.targetId, action: "rewrite", suggested: "   ", reason: "blank" },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({ success: true, grounding: [], suggestions: [] })
  })

  it("strips internal target refs the model leaked into a reason", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: bulletTarget.targetId,
          action: "remove",
          reason: `Bullet b0 (${bulletTarget.targetId}) does not align with the payments role`,
        },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({
      success: true,
      grounding: [],
      suggestions: [
        {
          targetId: bulletTarget.targetId,
          action: "remove",
          reason: "Bullet does not align with the payments role",
        },
      ],
    })
  })

  it("drops a suggestion whose reason was nothing but internal refs", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        { targetId: bulletTarget.targetId, action: "remove", reason: `${bulletTarget.targetId} [b0]` },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({ success: true, grounding: [], suggestions: [] })
  })

  it("drops a removal with a blank reason", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [{ targetId: bulletTarget.targetId, action: "remove", reason: "   " }],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result).toEqual({ success: true, grounding: [], suggestions: [] })
  })

  it("keeps only the first suggestion per target when a rewrite and a removal collide", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        { targetId: bulletTarget.targetId, action: "remove", reason: "Does not align" },
        {
          targetId: bulletTarget.targetId,
          action: "rewrite",
          suggested: "Rebuilt checkout on Kubernetes",
          reason: "Missing keyword",
        },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.suggestions).toEqual([
      { targetId: bulletTarget.targetId, action: "remove", reason: "Does not align" },
    ])
  })

  it("mixes rewrites and removals in one response", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: summaryTarget.targetId,
          action: "rewrite",
          suggested: "Backend engineer focused on payments platforms.",
          reason: "Names the target role",
        },
        { targetId: bulletTarget.targetId, action: "remove", reason: "Unrelated duty" },
      ],
    })

    const result = await enhanceResumeFromATS(validInput)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.suggestions.map((s) => [s.targetId, s.action])).toEqual([
      [summaryTarget.targetId, "rewrite"],
      [bulletTarget.targetId, "remove"],
    ])
  })
})

describe("enhanceResumeFromATS evidence grounding", () => {
  /** A resume with no JPA/JPQL and no message-broker experience anywhere. */
  const javaSections = [
    {
      id: "sec-1",
      type: "EXPERIENCE",
      title: "Experience",
      order: 0,
      visible: true,
      items: [
        {
          id: "item-1",
          order: 0,
          content: {
            role: "Backend Engineer",
            company: "Acme",
            startDate: "2021",
            current: true,
            bullets: ["Built REST services in Java and Spring Boot."],
          },
        },
      ],
    },
  ]

  const javaBullet = {
    targetId: "sec-1::item-1::b0",
    field: "bullet" as const,
    text: "Built REST services in Java and Spring Boot.",
    label: "Experience — Backend Engineer @ Acme",
  }

  const javaSkills = {
    targetId: "sec-1::item-1::skills",
    field: "skills" as const,
    text: "Java, Spring Boot",
    label: "Skills",
  }

  /** The posting asks for two technologies this candidate has never used. */
  const jpqlInput: EnhanceResumeInput = {
    resumeId: "resume-1",
    targets: [javaBullet, javaSkills],
    ats: {
      issues: [],
      suggestions: [],
      missingKeywords: ["JPQL", "JMS"],
    },
    jobDescription: "Java backend role. JPQL and JMS experience required.",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockConsumeRateLimit.mockResolvedValue(true)
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      userId: "user-1",
      targetRole: "Backend Engineer",
      targetCompany: null,
      sections: javaSections,
    })
  })

  it("sends unsupported requirements to the service as do-not-claim, not as targets", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({ suggestions: [] })

    await enhanceResumeFromATS(jpqlInput)

    const call = mockGenerateATSEnhanceSuggestions.mock.calls[0][0]
    expect(call.groundedKeywords.unsupported).toEqual(["JPQL", "JMS"])
    expect(call.groundedKeywords.supported).toEqual([])
  })

  it("REGRESSION: discards a bullet rewrite that claims JPQL the resume cannot back", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: javaBullet.targetId,
          action: "rewrite",
          suggested:
            "Built REST services in Java and Spring Boot, tuning JPQL queries for reporting.",
          reason: "Addresses the missing JPQL keyword",
        },
      ],
    })

    const result = await enhanceResumeFromATS(jpqlInput)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.suggestions).toEqual([])
  })

  it("REGRESSION: strips JMS from a skills rewrite instead of dropping the whole list", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: javaSkills.targetId,
          action: "rewrite",
          suggested: "Java, Spring Boot, JPQL, JMS, PostgreSQL",
          reason: "Appends the missing keywords",
        },
      ],
    })

    const result = await enhanceResumeFromATS(jpqlInput)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].suggested).toBe("Java, Spring Boot, PostgreSQL")
  })

  it("reports the withheld requirements with a reason", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({ suggestions: [] })

    const result = await enhanceResumeFromATS(jpqlInput)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.grounding.map((note) => note.keyword)).toEqual(["JPQL", "JMS"])
    expect(result.grounding.every((note) => note.verdict === "unsupported")).toBe(true)
    expect(result.grounding[0].reason).toBeTruthy()
  })

  it("keeps a rewrite that only uses evidence the resume already contains", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: javaBullet.targetId,
          action: "rewrite",
          suggested:
            "Built REST services in Java and Spring Boot, cutting response times for the reporting API.",
          reason: "Adds the outcome the bullet was missing",
        },
      ],
    })

    const result = await enhanceResumeFromATS(jpqlInput)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.suggestions).toHaveLength(1)
  })

  it("does not bar a keyword the target text itself already contains", async () => {
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({
      suggestions: [
        {
          targetId: javaBullet.targetId,
          action: "rewrite",
          suggested: "Tuned JPQL queries, cutting report latency in half.",
          reason: "Sharpens the bullet",
        },
      ],
    })

    const result = await enhanceResumeFromATS({
      ...jpqlInput,
      targets: [
        { ...javaBullet, text: "Tuned JPQL queries against the reporting schema." },
      ],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.suggestions).toHaveLength(1)
  })
})

describe("enhanceResumeFromATS focus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsumeRateLimit.mockResolvedValue(true)
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      userId: "user-1",
      targetRole: null,
      targetCompany: null,
      sections: groundedSections,
    })
    mockGenerateATSEnhanceSuggestions.mockResolvedValue({ suggestions: [] })
  })

  it("forwards a focus on one of the resume's sections, with the stored sections", async () => {
    const result = await enhanceResumeFromATS({ ...validInput, focus: { sectionId: "sec-1" } })

    expect(result.success).toBe(true)
    const call = mockGenerateATSEnhanceSuggestions.mock.calls[0][0]
    expect(call.focus).toEqual({ sectionId: "sec-1" })
    expect(call.sections).toBe(groundedSections)
  })

  it("rejects a blank focus or one naming a section outside this resume, before any attempt", async () => {
    for (const sectionId of ["", "   ", "Experience", "sec-other"]) {
      const result = await enhanceResumeFromATS({ ...validInput, focus: { sectionId } })
      expect(result).toMatchObject({ success: false, code: "VALIDATION" })
    }
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
    expect(mockGenerateATSEnhanceSuggestions).not.toHaveBeenCalled()
  })

  it("leaves focus and sections off the service call for a whole-resume run", async () => {
    await enhanceResumeFromATS(validInput)

    const call = mockGenerateATSEnhanceSuggestions.mock.calls[0][0]
    expect(call.focus).toBeUndefined()
    expect(call.sections).toBeUndefined()
  })
})
