// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockGenerateObject } = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
}))

vi.mock("@/shared/lib/ai-generate", () => ({
  AI_USAGE_FEATURES: { ESSAY_DRAFT: "jobs.essay_draft" },
  generateObjectTracked: mockGenerateObject,
}))

import { generateEssayDraft } from "../essay-draft.service"

beforeEach(() => {
  vi.clearAllMocks()
  mockGenerateObject.mockResolvedValue({
    object: { draft: "I build accessible interfaces and care about the details." },
  })
})

describe("generateEssayDraft", () => {
  it("returns a review-only draft with no fill path", async () => {
    const result = await generateEssayDraft({
      userId: "user-1",
      question: "Why do you want this role?",
      evidenceText: "Built React dashboards at Acme.",
      jobTitle: "Frontend Engineer",
      companyName: "Acme",
      maxWords: 180,
    })

    expect(result.draft).toContain("accessible interfaces")
    expect(result.reviewRequired).toBe(true)
    expect(result.autoFill).toBe(false)
    expect(result.wordCount).toBeGreaterThan(0)
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        tracking: expect.objectContaining({
          feature: "jobs.essay_draft",
          surface: "extension",
          userId: "user-1",
        }),
      })
    )
  })

  it("reports employer terms the draft mentions without candidate evidence", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        draft:
          "I led Kubernetes migrations and cut infrastructure spend by 40% at Acme.",
      },
    })

    const result = await generateEssayDraft({
      userId: "user-1",
      question: "Describe a technical project you led.",
      evidenceText: "Built React dashboards at Acme.",
      jobDescription: "Requirements:\n- Kubernetes\n- Terraform",
    })

    expect(result.grounding?.claimed.map((detail) => detail.keyword)).toContain(
      "Kubernetes"
    )
    expect(result.unsupportedNumbers).toContain("40")
    expect(result.autoFill).toBe(false)
  })

  it("passes a supported draft through without warnings", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { draft: "I built React dashboards at Acme for two years." },
    })

    const result = await generateEssayDraft({
      userId: "user-1",
      question: "Tell us about your React work.",
      evidenceText:
        "Built React dashboards at Acme for two years and improved page load time.",
      jobDescription: "Requirements:\n- React",
    })

    expect(result.grounding).toBeNull()
    expect(result.unsupportedNumbers).toEqual([])
  })

  it("forwards the abort signal to the provider call", async () => {
    const controller = new AbortController()

    await generateEssayDraft({
      userId: "user-1",
      question: "Why this company?",
      evidenceText: "Built React dashboards.",
      signal: controller.signal,
    })

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal })
    )
  })
})
