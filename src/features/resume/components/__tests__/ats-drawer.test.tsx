import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useResumeStore, type ATSResults, type ResumeData, type Section } from "../../hooks/use-resume-store"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

const { mockAnalyzeATS } = vi.hoisted(() => ({ mockAnalyzeATS: vi.fn() }))
vi.mock("../../actions/analyze-ats", () => ({ analyzeATS: mockAnalyzeATS }))
const { mockEnhance } = vi.hoisted(() => ({ mockEnhance: vi.fn() }))
vi.mock("../../actions/enhance", () => ({ enhanceResumeFromATS: mockEnhance }))

import { ATSDrawer } from "../ats-drawer"

afterEach(cleanup)

const makeResume = (overrides: Partial<ResumeData> = {}): ResumeData => ({
  id: "resume-1",
  title: "Test Resume",
  targetRole: null,
  targetCompany: null,
  template: "MINIMAL",
  sections: [],
  atsScore: null,
  jobDescription: null,
  latestAnalysis: null,
  ...overrides,
})

const summarySection: Section = {
  id: "summary-1",
  resumeId: "resume-1",
  type: "SUMMARY",
  title: "Summary",
  order: 0,
  visible: true,
  items: [],
}

const experienceSection: Section = {
  id: "exp-1",
  resumeId: "resume-1",
  type: "EXPERIENCE",
  title: "Work Experience",
  order: 1,
  visible: true,
  items: [],
}

const analysis: ATSResults = {
  overallScore: 72,
  scores: { formatting: 80, keywords: 60, impact: 70, completeness: 75, readability: 90 },
  issues: [
    {
      severity: "warning",
      category: "impact",
      message: "Summary lacks measurable outcomes",
      section: "Summary",
      suggestion: "Add a number",
    },
    {
      severity: "info",
      category: "formatting",
      message: "Consider a different heading",
      section: "Nonexistent Section",
    },
  ],
  suggestions: [],
  missingKeywords: ["Kubernetes"],
  mode: "job-match",
}

/** The same findings from a run with no job target. */
const qualityAnalysis: ATSResults = {
  ...analysis,
  mode: "quality",
  missingKeywords: [],
}

describe("ATSDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useResumeStore.setState({ resume: null, jobDescription: "", openInspector: null })
  })

  it("does not render when the inspector is closed", () => {
    useResumeStore.getState().setResume(makeResume())
    render(<ATSDrawer />)

    expect(screen.queryByLabelText("ATS analysis")).toBeNull()
  })

  it("keeps Analyze enabled without a job description and explains the quality run", () => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ openInspector: "ats" })
    render(<ATSDrawer />)

    expect(screen.getByLabelText("Analyze").hasAttribute("disabled")).toBe(false)
    expect(
      screen.getByText(/No job target — this checks overall resume quality/)
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Add a job target" }))

    expect(useResumeStore.getState().openInspector).toBe("job")
  })

  it("titles the drawer 'Resume Quality' before the first run when there is no job target", () => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ openInspector: "ats" })
    render(<ATSDrawer />)

    expect(useResumeStore.getState().atsResults).toBeNull()
    expect(screen.getByRole("heading", { name: "Resume Quality" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "ATS Analysis" })).toBeNull()
  })

  it("titles the drawer 'ATS Analysis' before the first run when a job description exists", () => {
    useResumeStore.getState().setResume(makeResume({ jobDescription: "Kubernetes required." }))
    useResumeStore.setState({ openInspector: "ats" })
    render(<ATSDrawer />)

    expect(useResumeStore.getState().atsResults).toBeNull()
    expect(screen.getByRole("heading", { name: "ATS Analysis" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Resume Quality" })).toBeNull()
  })

  it("runs the analysis with no job description set", async () => {
    mockAnalyzeATS.mockResolvedValue({ data: qualityAnalysis })
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ openInspector: "ats" })
    render(<ATSDrawer />)

    fireEvent.click(screen.getByLabelText("Analyze"))

    await waitFor(() => expect(mockAnalyzeATS).toHaveBeenCalled())
    expect(mockAnalyzeATS.mock.calls[0][3]).toBe("quality")
    await waitFor(() =>
      expect(useResumeStore.getState().atsResults).toEqual(qualityAnalysis)
    )
  })

  it("titles a quality result 'Resume Quality' and hides the keyword report", () => {
    useResumeStore.getState().setResume(makeResume({ sections: [summarySection] }))
    useResumeStore.setState({ openInspector: "ats", atsResults: qualityAnalysis })
    render(<ATSDrawer />)

    expect(screen.getByRole("heading", { name: "Resume Quality" })).toBeTruthy()
    expect(screen.queryByText("Missing keywords")).toBeNull()
    expect(screen.queryByText("Keywords")).toBeNull()
    // The rest of the report is unchanged.
    expect(screen.getByText("Quality Score: 72")).toBeTruthy()
    expect(screen.getByText("Impact")).toBeTruthy()
    expect(screen.getByText("Summary lacks measurable outcomes")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Go to Summary section" })).toBeTruthy()
  })

  it("keeps the keyword report and the ATS title for a job-match result", () => {
    useResumeStore.getState().setResume(makeResume({ sections: [summarySection] }))
    useResumeStore.setState({
      openInspector: "ats",
      atsResults: analysis,
      jobDescription: "Kubernetes required.",
    })
    render(<ATSDrawer />)

    expect(screen.getByRole("heading", { name: "ATS Analysis" })).toBeTruthy()
    expect(screen.getByText("Missing keywords")).toBeTruthy()
    expect(screen.getByText("Kubernetes")).toBeTruthy()
    expect(screen.getByText("Keywords")).toBeTruthy()
    expect(screen.getByText("ATS Score: 72")).toBeTruthy()
  })

  it("enables Analyze once a job description is present and runs the trigger", async () => {
    mockAnalyzeATS.mockResolvedValue({ data: analysis })
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ openInspector: "ats", jobDescription: "Kubernetes required." })
    render(<ATSDrawer />)

    const button = screen.getByLabelText("Analyze")
    expect(button.hasAttribute("disabled")).toBe(false)
    fireEvent.click(button)

    await waitFor(() => expect(mockAnalyzeATS).toHaveBeenCalled())
    await waitFor(() => expect(useResumeStore.getState().atsResults).toEqual(analysis))
  })

  it("shows an 'Outdated' note only when results exist and the resume changed since", () => {
    useResumeStore.getState().setResume(makeResume({ sections: [summarySection] }))
    useResumeStore.setState({ openInspector: "ats" })
    const { rerender } = render(<ATSDrawer />)

    expect(screen.queryByText(/Outdated/)).toBeNull()

    act(() => useResumeStore.getState().setAtsResults(analysis))
    rerender(<ATSDrawer />)
    expect(screen.queryByText(/Outdated/)).toBeNull()

    act(() => useResumeStore.getState().updateTemplate("MODERN"))
    rerender(<ATSDrawer />)
    expect(screen.getByText(/Outdated/)).toBeTruthy()
  })

  it("shows the same 'was M, +Δ' line as the Enhance drawer after a re-analysis", async () => {
    mockAnalyzeATS.mockResolvedValue({ data: { ...analysis, overallScore: 79 } })
    useResumeStore.getState().setResume(makeResume({ sections: [summarySection] }))
    useResumeStore.setState({ openInspector: "ats", jobDescription: "Senior engineer", atsResults: analysis })
    render(<ATSDrawer />)

    // No comparison before a re-run.
    expect(screen.queryByText(/\(was /)).toBeNull()

    fireEvent.click(screen.getByLabelText("Re-analyze"))

    await screen.findByText("ATS 79 (was 72, +7)")
    expect(useResumeStore.getState().atsPreviousScore).toBe(72)
  })

  it("renders a jump control for an issue naming a real section, and none for an unknown one", () => {
    useResumeStore.getState().setResume(
      makeResume({ sections: [summarySection, experienceSection] })
    )
    useResumeStore.setState({ openInspector: "ats", atsResults: analysis })
    render(<ATSDrawer />)

    expect(screen.getByRole("button", { name: "Go to Summary section" })).toBeTruthy()
    // The second issue names a section that does not exist on this resume.
    expect(screen.getByText("Consider a different heading")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Nonexistent Section/ })).toBeNull()
  })

  it("jumping to a section sets activeSection and closes the inspector", () => {
    useResumeStore.getState().setResume(
      makeResume({ sections: [summarySection, experienceSection] })
    )
    useResumeStore.setState({ openInspector: "ats", atsResults: analysis })
    render(<ATSDrawer />)

    fireEvent.click(screen.getByRole("button", { name: "Go to Summary section" }))

    expect(useResumeStore.getState().activeSection).toBe("summary-1")
    expect(useResumeStore.getState().openInspector).toBeNull()
  })

  describe("Fix with Enhance", () => {
    const filledSummary: Section = {
      ...summarySection,
      items: [
        { id: "sum-item", sectionId: "summary-1", content: { text: "Old summary" }, order: 0 },
      ],
    }
    const filledExperience: Section = {
      ...experienceSection,
      items: [
        {
          id: "exp-item",
          sectionId: "exp-1",
          content: { role: "Engineer", bullets: ["Built the checkout"] },
          order: 0,
        },
      ],
    }
    const skillsSection: Section = {
      id: "skills-1",
      resumeId: "resume-1",
      type: "SKILLS",
      title: "Skills",
      order: 2,
      visible: true,
      items: [
        {
          id: "skills-item",
          sectionId: "skills-1",
          content: { category: "Languages", skills: ["TypeScript"] },
          order: 0,
        },
      ],
    }
    const educationSection: Section = {
      id: "edu-1",
      resumeId: "resume-1",
      type: "EDUCATION",
      title: "Education",
      order: 3,
      visible: true,
      items: [
        {
          id: "edu-item",
          sectionId: "edu-1",
          content: { school: "State University", degree: "BSc" },
          order: 0,
        },
      ],
    }
    const sectionAnalysis: ATSResults = {
      ...analysis,
      issues: [
        { severity: "warning", category: "impact", message: "Summary is vague", section: "Summary" },
        { severity: "warning", category: "impact", message: "Bullets lack outcomes", section: "Work Experience" },
        { severity: "info", category: "keywords", message: "Skills list is thin", section: "Skills" },
        { severity: "info", category: "formatting", message: "Add graduation year", section: "Education" },
      ],
    }

    beforeEach(() => {
      useResumeStore.getState().setResume(
        makeResume({
          sections: [filledSummary, filledExperience, skillsSection, educationSection],
        })
      )
      useResumeStore.setState({ openInspector: "ats", atsResults: sectionAnalysis })
    })

    it("offers the button for summary, experience and skills issues but not for education", () => {
      render(<ATSDrawer />)

      expect(screen.getByRole("button", { name: "Fix Summary with Enhance" })).toBeTruthy()
      expect(screen.getByRole("button", { name: "Fix Work Experience with Enhance" })).toBeTruthy()
      expect(screen.getByRole("button", { name: "Fix Skills with Enhance" })).toBeTruthy()
      // The education issue still gets its jump link, but no Enhance button at all.
      expect(screen.getByRole("button", { name: "Go to Education section" })).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Fix Education with Enhance" })).toBeNull()
      expect(screen.getAllByRole("button", { name: /with Enhance/ })).toHaveLength(3)
    })

    it("gives no button to an enhanceable-type section that has no text to rewrite", () => {
      // Same issues, but the summary section is empty: Enhance has nothing to
      // send for it, so the button would only lead to a "nothing to enhance" toast.
      useResumeStore.getState().setResume(
        makeResume({
          sections: [summarySection, filledExperience, skillsSection, educationSection],
        })
      )
      useResumeStore.setState({ openInspector: "ats", atsResults: sectionAnalysis })
      render(<ATSDrawer />)

      expect(screen.getByRole("button", { name: "Go to Summary section" })).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Fix Summary with Enhance" })).toBeNull()
      expect(screen.getByRole("button", { name: "Fix Work Experience with Enhance" })).toBeTruthy()
    })

    it("clicking opens Enhance and runs a focused Enhance; only the run itself records the focus", async () => {
      mockEnhance.mockResolvedValue({ success: true, suggestions: [], grounding: [] })
      // Record every focus write with whether a run was already in flight, so a
      // pre-set from the drawer (before the trigger starts) would show up here.
      const originalSetFocus = useResumeStore.getState().setEnhanceFocus
      const focusWrites: { focus: { sectionId: string } | null; isEnhancing: boolean }[] = []
      useResumeStore.setState({
        setEnhanceFocus: (focus) => {
          focusWrites.push({ focus, isEnhancing: useResumeStore.getState().isEnhancing })
          originalSetFocus(focus)
        },
      })

      try {
        render(<ATSDrawer />)
        fireEvent.click(screen.getByRole("button", { name: "Fix Summary with Enhance" }))
      } finally {
        useResumeStore.setState({ setEnhanceFocus: originalSetFocus })
      }

      expect(focusWrites).toEqual([{ focus: { sectionId: "summary-1" }, isEnhancing: true }])
      expect(useResumeStore.getState().openInspector).toBe("enhance")
      await waitFor(() => expect(mockEnhance).toHaveBeenCalledTimes(1))
      const payload = mockEnhance.mock.calls[0][0]
      expect(payload.focus).toEqual({ sectionId: "summary-1" })
      expect(payload.targets.map((t: { targetId: string }) => t.targetId)).toEqual([
        "summary-1::sum-item::summary",
      ])
      await waitFor(() => expect(useResumeStore.getState().isEnhancing).toBe(false))
      expect(useResumeStore.getState().enhanceError).toBeNull()
      expect(useResumeStore.getState().enhanceFocus).toEqual({ sectionId: "summary-1" })
    })
  })
})
