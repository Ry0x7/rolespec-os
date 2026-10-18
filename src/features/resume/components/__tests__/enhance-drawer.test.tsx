import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

const { mockEnhance, mockAnalyzeATS } = vi.hoisted(() => ({
  mockEnhance: vi.fn(),
  mockAnalyzeATS: vi.fn(),
}))
vi.mock("../../actions/enhance", () => ({ enhanceResumeFromATS: mockEnhance }))
vi.mock("../../actions/analyze-ats", () => ({ analyzeATS: mockAnalyzeATS }))

import { toast } from "sonner"
import { EnhanceDrawer } from "../enhance-drawer"
import {
  useResumeStore,
  type ATSResults,
  type EnhanceSuggestion,
  type ResumeData,
  type Section,
} from "../../hooks/use-resume-store"

afterEach(cleanup)

const analysis: ATSResults = {
  overallScore: 60,
  scores: { formatting: 1, keywords: 1, impact: 1, completeness: 1, readability: 1 },
  issues: [],
  suggestions: [],
}

const makeResume = (overrides: Partial<ResumeData> = {}): ResumeData => ({
  id: "r1",
  title: "Test",
  targetRole: null,
  targetCompany: null,
  template: "MINIMAL",
  sections: [
    {
      id: "s1",
      resumeId: "r1",
      type: "SUMMARY",
      title: "Summary",
      order: 0,
      visible: true,
      items: [{ id: "i1", sectionId: "s1", content: { text: "Old summary" }, order: 0 }],
    } as Section,
    {
      id: "s2",
      resumeId: "r1",
      type: "EXPERIENCE",
      title: "Experience",
      order: 1,
      visible: true,
      items: [
        { id: "i2", sectionId: "s2", content: { bullets: ["Kept bullet", "Bloat bullet"] }, order: 0 },
      ],
    } as Section,
  ],
  atsScore: null,
  jobDescription: null,
  latestAnalysis: null,
  ...overrides,
})

const summarySuggestion: EnhanceSuggestion = {
  id: "s1::i1::summary",
  sectionId: "s1",
  itemId: "i1",
  field: "summary",
  action: "rewrite",
  original: "Old summary",
  suggested: "New summary",
  reason: "Adds the missing keyword",
  status: "pending",
}

const bulletRemoval: EnhanceSuggestion = {
  id: "s2::i2::b1",
  sectionId: "s2",
  itemId: "i2",
  field: "bullet",
  action: "remove",
  bulletIndex: 1,
  original: "Bloat bullet",
  reason: "Unrelated to the target role",
  status: "pending",
}

describe("EnhanceDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Enhance state persists per resume; a previous test's list must not reload.
    window.localStorage.clear()
    useResumeStore.setState({
      resume: null,
      openInspector: null,
      jobDescription: "",
      isAnalyzing: false,
    })
    useResumeStore.getState().setResume(makeResume())
  })

  it("does not render when the inspector is closed", () => {
    render(<EnhanceDrawer />)
    expect(screen.queryByLabelText("AI enhancements")).toBeNull()
  })

  it("disables the run button without an ATS analysis and offers the route to the ATS inspector", () => {
    useResumeStore.setState({ openInspector: "enhance" })
    render(<EnhanceDrawer />)

    expect(screen.getByLabelText("Enhance").hasAttribute("disabled")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Open ATS analysis" }))

    expect(useResumeStore.getState().openInspector).toBe("ats")
  })

  it("enables the run button once an ATS analysis exists and runs the trigger", async () => {
    mockEnhance.mockResolvedValue({
      success: true,
      suggestions: [{ targetId: "s1::i1::summary", action: "rewrite", suggested: "New summary", reason: "Adds the missing keyword" }],
      grounding: [],
    })
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    render(<EnhanceDrawer />)

    const button = screen.getByLabelText("Enhance")
    expect(button.hasAttribute("disabled")).toBe(false)
    fireEvent.click(button)

    await screen.findByText("Adds the missing keyword")
    expect(mockEnhance).toHaveBeenCalled()
  })

  it("explains what Enhance does before the first run", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })

    render(<EnhanceDrawer />)

    expect(screen.getByText("No suggestions yet")).toBeTruthy()
    expect(screen.getByText(/Every rewrite is grounded in the evidence/)).toBeTruthy()
    expect(screen.getByText(/apply or\s+revert each one on its own/)).toBeTruthy()
    // The run button itself is untouched by the empty state.
    expect(screen.getByLabelText("Enhance")).toBeTruthy()
  })

  it("drops the pre-run explanation once suggestions exist", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

    render(<EnhanceDrawer />)

    expect(screen.queryByText("No suggestions yet")).toBeNull()
    expect(screen.getByText("Suggestions (1)")).toBeTruthy()
  })

  // A finished run that produced nothing already has its own copy in the
  // suggestions card ("No rewrites needed"), so the pre-run explanation must
  // not double up on it.
  it("does not show the pre-run explanation after a run returned zero suggestions", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([])

    render(<EnhanceDrawer />)

    expect(screen.queryByText("No suggestions yet")).toBeNull()
    expect(screen.getByText(/No rewrites needed/)).toBeTruthy()
  })

  it("hides the pre-run explanation while a run is in flight", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis, isEnhancing: true })

    render(<EnhanceDrawer />)

    expect(screen.queryByText("No suggestions yet")).toBeNull()
  })

  it("shows the busy state while a run is in flight", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis, isEnhancing: true })
    render(<EnhanceDrawer />)

    const status = screen.getByRole("status")
    expect(status.getAttribute("aria-live")).toBe("polite")
    expect(status.textContent).toContain("Enhancing with AI...")
  })

  it("shows the error as a dismissible alert above the suggestions instead of replacing them", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])
    useResumeStore.getState().setEnhanceError("Enhance failed. Please try again.")

    render(<EnhanceDrawer />)

    expect(screen.getByRole("alert").textContent).toContain("Enhance failed. Please try again.")
    expect(screen.getByRole("button", { name: "Apply suggestion 1" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }))
    expect(useResumeStore.getState().enhanceError).toBeNull()
  })

  it("renders the 'Not added' grounding block even with zero suggestions", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([])
    useResumeStore.getState().setEnhanceGrounding([
      { keyword: "Kafka", verdict: "unsupported", reason: "Not mentioned anywhere on the resume." },
    ])

    render(<EnhanceDrawer />)

    expect(screen.getByText("Not added (1)")).toBeTruthy()
    expect(screen.getByText("Kafka")).toBeTruthy()
  })

  it("renders the 'Not added' grounding block when enhanceSuggestions is still null", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis, enhanceSuggestions: null })
    useResumeStore.getState().setEnhanceGrounding([
      { keyword: "Kafka", verdict: "unsupported", reason: "Not mentioned anywhere on the resume." },
    ])

    render(<EnhanceDrawer />)

    expect(screen.getByText("Not added (1)")).toBeTruthy()
  })

  it("groups suggestions by resume section with per-group and per-drawer counts", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }, { ...bulletRemoval }])

    render(<EnhanceDrawer />)

    expect(screen.getByText("Suggestions (2)")).toBeTruthy()
    expect(screen.getByText("Summary (1)")).toBeTruthy()
    expect(screen.getByText("Experience (1)")).toBeTruthy()
  })

  it("collapsed groups can be expanded to reveal their rows", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }, { ...bulletRemoval }])

    render(<EnhanceDrawer />)

    // Small set (<= 6): groups start open.
    expect(screen.getByText("Adds the missing keyword")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /^Summary \(1\)/ }))
    expect(screen.queryByText("Adds the missing keyword")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /^Summary \(1\)/ }))
    expect(screen.getByText("Adds the missing keyword")).toBeTruthy()
  })

  it("Apply mutates the resume text, toggles to Revert, and Revert restores it", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

    render(<EnhanceDrawer />)
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))

    expect(
      (useResumeStore.getState().resume!.sections[0].items[0].content as { text: string }).text
    ).toBe("New summary")
    expect(toast.success).toHaveBeenCalledWith("Suggestion applied.")
    expect(screen.getByRole("button", { name: "Revert suggestion 1" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Revert suggestion 1" }))
    expect(
      (useResumeStore.getState().resume!.sections[0].items[0].content as { text: string }).text
    ).toBe("Old summary")
  })

  it("renders a removal row with no replacement text and a Remove/Restore toggle", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([{ ...bulletRemoval }])

    render(<EnhanceDrawer />)

    // The drawer portals to document.body, so the query has to look there —
    // not at the render() container, which stays empty.
    expect(screen.getByText("Suggest removing")).toBeTruthy()
    expect(document.body.querySelector("del")?.textContent).toBe("Bloat bullet")
    expect(document.body.querySelector("ins")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Remove bullet 1" }))
    expect(
      (useResumeStore.getState().resume!.sections[1].items[0].content as { bullets: string[] }).bullets
    ).toEqual(["Kept bullet"])
    expect(toast.success).toHaveBeenCalledWith("Bullet removed.")
  })

  it("toasts an error when the suggestion no longer applies", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])
    useResumeStore.getState().removeSectionItem("s1", "i1")

    render(<EnhanceDrawer />)
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))

    expect(toast.error).toHaveBeenCalledWith("That section is no longer in your resume.")
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("closing and reopening the drawer keeps an applied suggestion applied and the resume text changed", () => {
    useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
    useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

    const { rerender } = render(<EnhanceDrawer />)
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))
    expect(
      (useResumeStore.getState().resume!.sections[0].items[0].content as { text: string }).text
    ).toBe("New summary")

    // Close. The panel is deliberately NOT asserted gone here: `Drawer` wraps
    // it in `AnimatePresence`, whose exit animation never completes under jsdom
    // (no compositing), so the faded-out node lingers in the DOM forever in
    // tests while a real browser drops it after ~200ms. Removal-on-close is
    // covered on a fresh mount in `shared/ui/__tests__/drawer.test.tsx`; what
    // matters HERE is that closing does not undo the edit.
    useResumeStore.getState().setOpenInspector(null)
    rerender(<EnhanceDrawer />)
    expect(useResumeStore.getState().openInspector).toBeNull()
    expect(
      (useResumeStore.getState().resume!.sections[0].items[0].content as { text: string }).text
    ).toBe("New summary")

    // Reopen: the resume text is still the applied rewrite, not reverted by
    // the close, and the row still reads as applied (Revert, not Apply).
    useResumeStore.getState().setOpenInspector("enhance")
    rerender(<EnhanceDrawer />)

    expect(
      (useResumeStore.getState().resume!.sections[0].items[0].content as { text: string }).text
    ).toBe("New summary")
    expect(screen.getByRole("button", { name: "Revert suggestion 1" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply suggestion 1" })).toBeNull()
  })
  // The analyze -> propose -> apply -> re-analyze loop. Re-analyze is the only
  // way to see whether the rewrites the user accepted actually moved the score.
  describe("Re-analyze", () => {
    const qualityBefore: ATSResults = { ...analysis, overallScore: 65, mode: "quality" }
    const qualityAfter: ATSResults = { ...analysis, overallScore: 71, mode: "quality" }

    it("is absent while nothing has been applied", () => {
      useResumeStore.setState({ openInspector: "enhance", atsResults: qualityBefore })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)

      expect(screen.getAllByText("0 of 1 applied").length).toBeGreaterThan(0)
      expect(screen.queryByLabelText("Re-analyze")).toBeNull()
    })

    it("appears once at least one suggestion is applied", () => {
      useResumeStore.setState({ openInspector: "enhance", atsResults: qualityBefore })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))

      expect(screen.getAllByText("1 of 1 applied").length).toBeGreaterThan(0)
      expect(screen.getByLabelText("Re-analyze")).toBeTruthy()
    })

    it("appears when the analysis is stale even with nothing applied (e.g. after a Revert)", () => {
      useResumeStore.setState({ openInspector: "enhance", atsResults: qualityBefore })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))
      fireEvent.click(screen.getByRole("button", { name: "Revert suggestion 1" }))

      expect(screen.getAllByText("0 of 1 applied").length).toBeGreaterThan(0)
      expect(useResumeStore.getState().atsStale).toBe(true)
      expect(screen.getByLabelText("Re-analyze")).toBeTruthy()
    })

    it("re-runs the analysis in the current mode and reports how the score moved", async () => {
      mockAnalyzeATS.mockResolvedValue({ data: qualityAfter })
      useResumeStore.setState({ openInspector: "enhance", atsResults: qualityBefore })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))
      fireEvent.click(screen.getByLabelText("Re-analyze"))

      await waitFor(() => expect(mockAnalyzeATS).toHaveBeenCalledTimes(1))
      // No job target in the store, so the run is the job-independent quality
      // check -- the same derivation the ATS drawer's trigger makes.
      expect(mockAnalyzeATS.mock.calls[0][0]).toBe("r1")
      expect(mockAnalyzeATS.mock.calls[0][2]).toBeUndefined()
      expect(mockAnalyzeATS.mock.calls[0][3]).toBe("quality")

      await screen.findByText("Quality 71 (was 65, +6)")

      // Re-analysis must not wipe out what the user already accepted.
      expect(useResumeStore.getState().enhanceSuggestions![0].status).toBe("applied")
      expect(screen.getAllByText("1 of 1 applied").length).toBeGreaterThan(0)
      expect(screen.getByRole("button", { name: "Revert suggestion 1" })).toBeTruthy()
    })

    // A dip is information about the resume, not an error: same line, muted
    // rather than green, and the sign is a real minus (U+2212), not a hyphen.
    it("reports a drop in muted text", async () => {
      mockAnalyzeATS.mockResolvedValue({ data: { ...analysis, overallScore: 60, mode: "quality" } })
      useResumeStore.setState({ openInspector: "enhance", atsResults: qualityBefore })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))
      fireEvent.click(screen.getByLabelText("Re-analyze"))

      const line = await screen.findByText("Quality 60 (was 65, −5)")
      expect(line.className).toContain("text-muted-foreground")
      expect(line.className).not.toContain("text-green-600")
    })

    it("spells out an unchanged score instead of showing +0", async () => {
      mockAnalyzeATS.mockResolvedValue({ data: { ...analysis, overallScore: 65, mode: "quality" } })
      useResumeStore.setState({ openInspector: "enhance", atsResults: qualityBefore })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))
      fireEvent.click(screen.getByLabelText("Re-analyze"))

      const line = await screen.findByText("Quality 65 (was 65, ±0)")
      expect(line.className).toContain("text-muted-foreground")
    })

    // A failed re-score (e.g. no AI key) must say why next to the score line
    // instead of leaving the drawer unchanged.
    it("shows the analysis error when a re-analyze fails", async () => {
      const keyError = "Add your API key in Settings → AI to use AI features."
      mockAnalyzeATS.mockResolvedValue({ error: keyError })
      useResumeStore.setState({ openInspector: "enhance", atsResults: qualityBefore })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))
      fireEvent.click(screen.getByLabelText("Re-analyze"))

      const line = await screen.findByText(keyError)
      expect(line.className).toContain("text-destructive")
      expect(screen.getAllByText("1 of 1 applied").length).toBeGreaterThan(0)
    })

    it("shows a stored analysis error once a suggestion is applied", () => {
      useResumeStore.setState({
        openInspector: "enhance",
        atsResults: qualityBefore,
        atsError: "Analysis failed. Please try again.",
      })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))

      expect(screen.getByText("Analysis failed. Please try again.")).toBeTruthy()
    })

    it("does not show a stale analysis error when no re-score is offered", () => {
      useResumeStore.setState({
        openInspector: "enhance",
        atsResults: qualityBefore,
        atsError: "Analysis failed. Please try again.",
      })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)

      expect(useResumeStore.getState().atsStale).toBe(false)
      expect(screen.queryByLabelText("Re-analyze")).toBeNull()
      expect(screen.queryByText("Analysis failed. Please try again.")).toBeNull()
    })
  })

  describe("Dismiss", () => {
    it("hides a dismissed row, counts it in the group header, and Show reveals it with Restore", () => {
      useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])
      const before = structuredClone(useResumeStore.getState().resume!.sections)

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestion 1" }))

      expect(screen.queryByText("Adds the missing keyword")).toBeNull()
      expect(screen.getByText(/1 dismissed/)).toBeTruthy()
      expect(screen.getByRole("button", { name: "Apply all (0)" }).hasAttribute("disabled")).toBe(true)
      // Dismiss never touches the resume.
      expect(useResumeStore.getState().resume!.sections).toEqual(before)
      expect(useResumeStore.getState().isDirty).toBe(false)

      fireEvent.click(screen.getByRole("button", { name: "Show dismissed" }))
      expect(screen.getByText("Adds the missing keyword")).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Apply suggestion 1" })).toBeNull()

      fireEvent.click(screen.getByRole("button", { name: "Restore suggestion 1" }))
      expect(useResumeStore.getState().enhanceSuggestions![0].dismissed).toBe(false)
      expect(screen.queryByText(/dismissed/)).toBeNull()
      expect(screen.getByRole("button", { name: "Apply suggestion 1" })).toBeTruthy()
    })

    it("offers no Dismiss on an applied row", () => {
      useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestion 1" }))

      expect(screen.queryByRole("button", { name: "Dismiss suggestion 1" })).toBeNull()
      expect(screen.getByRole("button", { name: "Revert suggestion 1" })).toBeTruthy()
    })
  })

  describe("Apply all", () => {
    const keptRewrite: EnhanceSuggestion = {
      id: "s2::i2::b0",
      sectionId: "s2",
      itemId: "i2",
      field: "bullet",
      action: "rewrite",
      bulletIndex: 0,
      original: "Kept bullet",
      suggested: "Kept bullet, quantified",
      reason: "Quantifies the impact",
      status: "pending",
    }
    // Targets text that is no longer in the resume, so the store reports stale.
    const staleRewrite: EnhanceSuggestion = {
      ...keptRewrite,
      id: "s2::i2::stale",
      bulletIndex: 5,
      original: "Text the user already edited away",
      suggested: "Irrelevant",
      reason: "Stale on arrival",
    }
    const dismissedRewrite: EnhanceSuggestion = {
      ...keptRewrite,
      id: "s2::i2::dismissed",
      original: "Bloat bullet",
      suggested: "Should never land",
      reason: "The user dismissed this one",
    }

    it("applies each pending, non-dismissed row in the section and toasts one summary with the skipped count", () => {
      useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
      useResumeStore
        .getState()
        .setEnhanceSuggestions([
          { ...summarySuggestion },
          { ...keptRewrite },
          { ...dismissedRewrite },
          { ...bulletRemoval },
          { ...staleRewrite },
        ])
      useResumeStore.getState().dismissEnhanceSuggestion(dismissedRewrite.id)

      const realApply = useResumeStore.getState().applyEnhanceSuggestion
      const applySpy = vi.fn((id: string) => realApply(id))
      useResumeStore.setState({ applyEnhanceSuggestion: applySpy })
      try {
        render(<EnhanceDrawer />)
        fireEvent.click(screen.getByRole("button", { name: "Apply all (3)" }))
      } finally {
        useResumeStore.setState({ applyEnhanceSuggestion: realApply })
      }

      expect(applySpy.mock.calls.map(([id]) => id)).toEqual([
        keptRewrite.id,
        bulletRemoval.id,
        staleRewrite.id,
      ])
      expect(toast.info).toHaveBeenCalledWith("Applied 2 of 3 · 1 skipped (content changed)")
      expect(toast.success).not.toHaveBeenCalled()
      expect(
        (useResumeStore.getState().resume!.sections[1].items[0].content as { bullets: string[] }).bullets
      ).toEqual(["Kept bullet, quantified"])
      // The other section is untouched.
      expect(
        (useResumeStore.getState().resume!.sections[0].items[0].content as { text: string }).text
      ).toBe("Old summary")
      const byId = new Map(useResumeStore.getState().enhanceSuggestions!.map((s) => [s.id, s]))
      expect(byId.get(dismissedRewrite.id)!.status).toBe("pending")
      expect(byId.get(staleRewrite.id)!.status).toBe("pending")
      // Only the stale row remains applicable in Experience; Summary still has its one.
      expect(screen.getAllByRole("button", { name: "Apply all (1)" })).toHaveLength(2)
      expect(screen.queryByRole("button", { name: "Apply all (3)" })).toBeNull()
    })

    it("toasts a plain success when nothing was skipped", () => {
      useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
      useResumeStore.getState().setEnhanceSuggestions([{ ...summarySuggestion }])

      render(<EnhanceDrawer />)
      fireEvent.click(screen.getByRole("button", { name: "Apply all (1)" }))

      expect(toast.success).toHaveBeenCalledWith("Applied 1 of 1")
      expect(screen.getByRole("button", { name: "Apply all (0)" }).hasAttribute("disabled")).toBe(true)
    })
  })

  describe("focus", () => {
    it("shows no focus line for a whole-resume run", () => {
      useResumeStore.setState({ openInspector: "enhance", atsResults: analysis })
      render(<EnhanceDrawer />)

      expect(screen.queryByText(/Focused on/)).toBeNull()
      expect(screen.queryByRole("button", { name: "Enhance whole resume" })).toBeNull()
    })

    it("names the focused section", () => {
      useResumeStore.setState({
        openInspector: "enhance",
        atsResults: analysis,
        enhanceFocus: { sectionId: "s2" },
        enhanceSuggestions: [],
      })
      render(<EnhanceDrawer />)

      const line = screen.getByText(/Focused on/)
      expect(line.textContent).toContain("Focused on Experience")
    })

    it("Re-run keeps the current focus and sends only that section's targets", async () => {
      mockEnhance.mockResolvedValue({ success: true, suggestions: [], grounding: [] })
      useResumeStore.setState({
        openInspector: "enhance",
        atsResults: analysis,
        enhanceFocus: { sectionId: "s2" },
        enhanceSuggestions: [],
      })
      render(<EnhanceDrawer />)

      fireEvent.click(screen.getByLabelText("Re-run"))

      await waitFor(() => expect(mockEnhance).toHaveBeenCalledTimes(1))
      const payload = mockEnhance.mock.calls[0][0]
      expect(payload.focus).toEqual({ sectionId: "s2" })
      expect(payload.targets.map((t: { targetId: string }) => t.targetId)).toEqual([
        "s2::i2::b0",
        "s2::i2::b1",
      ])
      await waitFor(() => expect(useResumeStore.getState().isEnhancing).toBe(false))
      expect(useResumeStore.getState().enhanceFocus).toEqual({ sectionId: "s2" })
      expect(screen.getByText(/Focused on/).textContent).toContain("Focused on Experience")
    })

    it("'Enhance whole resume' clears the focus and re-runs over every section", async () => {
      mockEnhance.mockResolvedValue({ success: true, suggestions: [], grounding: [] })
      useResumeStore.setState({
        openInspector: "enhance",
        atsResults: analysis,
        enhanceFocus: { sectionId: "s1" },
        enhanceSuggestions: [],
      })
      render(<EnhanceDrawer />)

      fireEvent.click(screen.getByRole("button", { name: "Enhance whole resume" }))

      expect(useResumeStore.getState().enhanceFocus).toBeNull()
      await waitFor(() => expect(mockEnhance).toHaveBeenCalledTimes(1))
      const payload = mockEnhance.mock.calls[0][0]
      expect(payload.focus).toBeUndefined()
      expect(payload.targets.map((t: { targetId: string }) => t.targetId)).toEqual([
        "s1::i1::summary",
        "s2::i2::b0",
        "s2::i2::b1",
      ])
      await waitFor(() => expect(useResumeStore.getState().isEnhancing).toBe(false))
      expect(screen.queryByText(/Focused on/)).toBeNull()
      // The run stays in Enhance.
      expect(useResumeStore.getState().openInspector).toBe("enhance")
    })
  })
})
