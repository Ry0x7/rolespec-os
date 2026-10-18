import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { SectionType } from "@/generated/prisma/enums"
import { useResumeStore } from "../use-resume-store"
import type { ATSResults, EnhanceSuggestion, ResumeData, Section } from "../use-resume-store"
import { MAX_ENHANCE_JOB_DESCRIPTION_LENGTH } from "../../constants/enhance"

vi.mock("../../actions/enhance", () => ({ enhanceResumeFromATS: vi.fn() }))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "authenticated", update: vi.fn() }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { enhanceResumeFromATS } from "../../actions/enhance"
import { useEnhanceTrigger } from "../use-enhance-trigger"

const mockedEnhance = vi.mocked(enhanceResumeFromATS)

const makeSection = (id: string, type: SectionType, items: Section["items"]): Section => ({
  id,
  resumeId: "resume-1",
  type,
  title: id,
  order: 0,
  visible: true,
  items,
})

const makeResume = (): ResumeData => ({
  id: "resume-1",
  title: "Test Resume",
  targetRole: null,
  targetCompany: null,
  template: "MINIMAL",
  sections: [
    makeSection("exp-section", "EXPERIENCE", [
      {
        id: "exp-item",
        sectionId: "exp-section",
        content: { role: "Engineer", bullets: ["Old bullet one", "Old bullet two"] },
        order: 0,
      },
    ]),
  ],
  atsScore: null,
  jobDescription: null,
  latestAnalysis: null,
})

const analysis: ATSResults = {
  overallScore: 60,
  scores: { formatting: 1, keywords: 1, impact: 1, completeness: 1, readability: 1 },
  issues: [
    { severity: "warning", category: "impact", message: "Bullets lack measurable outcomes" },
  ],
  suggestions: [],
  missingKeywords: ["Kubernetes"],
}

describe("useEnhanceTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ atsResults: analysis, missingKeywords: ["Kubernetes"] })
  })

  it("truncates an oversized job description instead of letting the server reject it", async () => {
    mockedEnhance.mockResolvedValue({ success: true, grounding: [], suggestions: [] })
    useResumeStore
      .getState()
      .setJobDescription("j".repeat(MAX_ENHANCE_JOB_DESCRIPTION_LENGTH + 500))

    const { result } = renderHook(() => useEnhanceTrigger())
    await act(async () => {
      await result.current.trigger()
    })

    const sent = mockedEnhance.mock.calls[0][0]
    expect(sent.jobDescription).toHaveLength(MAX_ENHANCE_JOB_DESCRIPTION_LENGTH)
  })

  it("carries the action through, including a removal with no suggested text", async () => {
    mockedEnhance.mockResolvedValue({
      success: true,
      grounding: [],
      suggestions: [
        {
          targetId: "exp-section::exp-item::b0",
          action: "rewrite",
          suggested: "Rebuilt checkout on Kubernetes",
          reason: "Missing keyword",
        },
        {
          targetId: "exp-section::exp-item::b1",
          action: "remove",
          reason: "Unrelated to the target role",
        },
      ],
    })

    const { result } = renderHook(() => useEnhanceTrigger())
    await act(async () => {
      await result.current.trigger()
    })

    const rows = useResumeStore.getState().enhanceSuggestions!
    expect(rows.map((row) => row.action)).toEqual(["rewrite", "remove"])
    expect(rows[1]).toMatchObject({
      id: "exp-section::exp-item::b1",
      field: "bullet",
      bulletIndex: 1,
      original: "Old bullet two",
      status: "pending",
    })
    expect(rows[1].suggested).toBeUndefined()
  })

  it("keeps applied rows from an earlier run that the new run does not supersede", async () => {
    const applied: EnhanceSuggestion = {
      id: "exp-section::exp-item::b0",
      sectionId: "exp-section",
      itemId: "exp-item",
      field: "bullet",
      action: "rewrite",
      bulletIndex: 0,
      original: "Old bullet one",
      suggested: "Shipped bullet one",
      reason: "Adds impact",
      status: "applied",
    }
    const stillPending: EnhanceSuggestion = { ...applied, id: "stale-pending", status: "pending" }
    useResumeStore.getState().setEnhanceSuggestions([applied, stillPending])

    mockedEnhance.mockResolvedValue({
      success: true,
      grounding: [],
      suggestions: [
        {
          targetId: "exp-section::exp-item::b1",
          action: "rewrite",
          suggested: "Rebuilt checkout on Kubernetes",
          reason: "Missing keyword",
        },
      ],
    })

    const { result } = renderHook(() => useEnhanceTrigger())
    await act(async () => {
      await result.current.trigger()
    })

    const ids = useResumeStore.getState().enhanceSuggestions!.map((s) => s.id)
    expect(ids).toEqual(["exp-section::exp-item::b0", "exp-section::exp-item::b1"])
    expect(useResumeStore.getState().enhanceSuggestions![0].status).toBe("applied")
  })

  it("lets a new suggestion supersede the applied row with the same id", async () => {
    useResumeStore.getState().setEnhanceSuggestions([
      {
        id: "exp-section::exp-item::b1",
        sectionId: "exp-section",
        itemId: "exp-item",
        field: "bullet",
        action: "rewrite",
        bulletIndex: 1,
        original: "Old bullet two",
        suggested: "First rewrite",
        reason: "Adds impact",
        status: "applied",
      },
    ])

    mockedEnhance.mockResolvedValue({
      success: true,
      grounding: [],
      suggestions: [
        {
          targetId: "exp-section::exp-item::b1",
          action: "rewrite",
          suggested: "Second rewrite",
          reason: "Missing keyword",
        },
      ],
    })

    const { result } = renderHook(() => useEnhanceTrigger())
    await act(async () => {
      await result.current.trigger()
    })

    const suggestions = useResumeStore.getState().enhanceSuggestions!
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].suggested).toBe("Second rewrite")
    expect(suggestions[0].status).toBe("pending")
  })

  describe("focus", () => {
    const withSummary = (): ResumeData => {
      const resume = makeResume()
      return {
        ...resume,
        sections: [
          makeSection("sum-section", "SUMMARY", [
            {
              id: "sum-item",
              sectionId: "sum-section",
              content: { text: "Old summary" },
              order: 0,
            },
          ]),
          ...resume.sections,
        ],
      }
    }

    beforeEach(() => {
      useResumeStore.getState().setResume(withSummary())
      useResumeStore.setState({ atsResults: analysis, missingKeywords: ["Kubernetes"] })
      mockedEnhance.mockResolvedValue({ success: true, grounding: [], suggestions: [] })
    })

    it("passes the focus through, sends only that section's targets, and stores it", async () => {
      const { result } = renderHook(() => useEnhanceTrigger())
      await act(async () => {
        await result.current.trigger({ sectionId: "sum-section" })
      })

      expect(mockedEnhance).toHaveBeenCalledTimes(1)
      const payload = mockedEnhance.mock.calls[0][0]
      expect(payload.focus).toEqual({ sectionId: "sum-section" })
      expect(payload.targets.map((t) => t.targetId)).toEqual([
        "sum-section::sum-item::summary",
      ])
      expect(useResumeStore.getState().enhanceFocus).toEqual({ sectionId: "sum-section" })
    })

    it("an unfocused run sends every target, no focus, and clears a stored focus", async () => {
      useResumeStore.getState().setEnhanceFocus({ sectionId: "sum-section" })

      const { result } = renderHook(() => useEnhanceTrigger())
      await act(async () => {
        await result.current.trigger()
      })

      const payload = mockedEnhance.mock.calls[0][0]
      expect(payload.focus).toBeUndefined()
      expect(payload.targets).toHaveLength(3)
      expect(useResumeStore.getState().enhanceFocus).toBeNull()
    })

    it("does not call the server when the focused section has no enhanceable text", async () => {
      const { result } = renderHook(() => useEnhanceTrigger())
      await act(async () => {
        await result.current.trigger({ sectionId: "missing-section" })
      })

      expect(mockedEnhance).not.toHaveBeenCalled()
    })
  })
})
