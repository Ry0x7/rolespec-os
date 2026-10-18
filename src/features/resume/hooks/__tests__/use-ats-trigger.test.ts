import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useResumeStore } from "../use-resume-store"
import type { ResumeData } from "../use-resume-store"

// Mock the analyzeATS server action
vi.mock("../../actions/analyze-ats", () => ({
  analyzeATS: vi.fn(),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "authenticated", update: vi.fn() }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { toast } from "sonner"
import { analyzeATS } from "../../actions/analyze-ats"
import { useATSTrigger } from "../use-ats-trigger"

const mockedAnalyzeATS = vi.mocked(analyzeATS)

const makeResume = (overrides: Partial<ResumeData> = {}): ResumeData => ({
  id: "resume-a",
  title: "Test Resume A",
  targetRole: null,
  targetCompany: null,
  template: "MINIMAL",
  sections: [],
  atsScore: null,
  jobDescription: null,
  latestAnalysis: null,
  ...overrides,
})

const mockAnalysisResult = {
  overallScore: 85,
  scores: {
    formatting: 90,
    keywords: 80,
    impact: 85,
    completeness: 82,
    readability: 88,
  },
  issues: [] as { severity: "critical" | "warning" | "info"; category: string; message: string; section: string; suggestion: string }[],
  suggestions: [] as { category: string; title: string; description: string; priority: "high" | "medium" | "low" }[],
  missingKeywords: ["TypeScript", "React"],
  mode: "job-match" as const,
}

describe("useATSTrigger - stale response guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useResumeStore.setState({
      resume: makeResume(),
      activeSection: null,
      isDirty: false,
      saveStatus: "idle",
      generateStatus: "idle",
      lastExport: null,
      atsResults: null,
      isAnalyzing: false,
      atsError: null,
      jobDescription: "",
      missingKeywords: [],
    })
  })

  it("applies results in normal flow (no navigation)", async () => {
    mockedAnalyzeATS.mockResolvedValue({ success: true, data: mockAnalysisResult })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    const state = useResumeStore.getState()
    expect(state.atsResults).toEqual(mockAnalysisResult)
    expect(state.isAnalyzing).toBe(false)
    expect(state.atsError).toBeNull()
  })

  it("marks the landed analysis stale when content changed during the run", async () => {
    useResumeStore.setState({
      resume: makeResume({
        sections: [
          {
            id: "section-1",
            resumeId: "resume-a",
            type: "SUMMARY",
            title: "Summary",
            order: 0,
            visible: true,
            items: [
              { id: "item-1", sectionId: "section-1", content: { text: "Scored" }, order: 0 },
            ],
          },
        ],
      }),
    })
    mockedAnalyzeATS.mockImplementation(async () => {
      // The user keeps editing while the analysis is running.
      useResumeStore.getState().updateSectionItem("section-1", "item-1", { text: "Edited mid-run" })
      return { success: true, data: mockAnalysisResult }
    })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    const state = useResumeStore.getState()
    expect(state.atsResults).toEqual(mockAnalysisResult)
    expect(state.atsStale).toBe(true)
  })

  it("clears staleness when nothing changed during the run", async () => {
    useResumeStore.setState({ atsStale: true })
    mockedAnalyzeATS.mockResolvedValue({ success: true, data: mockAnalysisResult })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    expect(useResumeStore.getState().atsStale).toBe(false)
  })

  it("discards results when resume switches mid-flight", async () => {
    // analyzeATS will resolve, but during the await the store switches to resume-b
    mockedAnalyzeATS.mockImplementation(async () => {
      // Simulate navigation: switch to a different resume while request is in-flight
      useResumeStore.setState({ resume: makeResume({ id: "resume-b", title: "Resume B" }) })
      return { success: true, data: mockAnalysisResult }
    })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    const state = useResumeStore.getState()
    // Results should NOT have been applied since the resume changed
    expect(state.atsResults).toBeNull()
    // isAnalyzing should NOT have been reset (finally guard skips it)
    // The store might still show isAnalyzing from the setState before trigger started,
    // but since we switched resumes, the guard in finally should not set it to false
    // for the NEW resume (resume-b's isAnalyzing was never set to true)
  })

  it("sets error in normal flow when analyzeATS throws", async () => {
    mockedAnalyzeATS.mockRejectedValue(new Error("Network failure"))

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    const state = useResumeStore.getState()
    expect(state.atsError).toBe("Analysis failed. Please try again.")
    expect(state.isAnalyzing).toBe(false)
  })

  it("discards error when resume switches mid-flight and analyzeATS throws", async () => {
    mockedAnalyzeATS.mockImplementation(async () => {
      // Simulate navigation during the request
      useResumeStore.setState({ resume: makeResume({ id: "resume-b", title: "Resume B" }) })
      throw new Error("Network failure")
    })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    const state = useResumeStore.getState()
    // Error should NOT have been applied since the resume changed
    expect(state.atsError).toBeNull()
  })

  it("toasts and sets error when rate limited", async () => {
    mockedAnalyzeATS.mockResolvedValue({
      error: "Too many ATS scans. Please wait a few minutes and try again.",
      code: "RATE_LIMITED",
    })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    expect(useResumeStore.getState().atsError).toBe(
      "Too many ATS scans. Please wait a few minutes and try again."
    )
    expect(toast.error).toHaveBeenCalledWith(
      "Too many ATS scans. Please wait a few minutes and try again."
    )
  })

  it("sends the store's current sections and job description, not the DB copy", async () => {
    const sections = [
      {
        id: "sec-1",
        resumeId: "resume-a",
        type: "SUMMARY" as const,
        title: "Summary",
        order: 0,
        visible: true,
        items: [
          {
            id: "item-1",
            sectionId: "sec-1",
            content: { text: "Edited but not saved" },
            metadata: null,
            order: 0,
          },
        ],
      },
    ]
    useResumeStore.setState({
      resume: makeResume({ sections }),
      jobDescription: "Kubernetes required.",
    })
    mockedAnalyzeATS.mockResolvedValue({ success: true, data: mockAnalysisResult })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    expect(mockedAnalyzeATS).toHaveBeenCalledWith(
      "resume-a",
      sections,
      "Kubernetes required.",
      "job-match"
    )
  })

  it("requests a quality run when there is no job description", async () => {
    mockedAnalyzeATS.mockResolvedValue({
      success: true,
      data: { ...mockAnalysisResult, missingKeywords: [], mode: "quality" },
    })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    expect(mockedAnalyzeATS).toHaveBeenCalledWith("resume-a", [], undefined, "quality")
    expect(toast.error).not.toHaveBeenCalled()
    expect(useResumeStore.getState().atsError).toBeNull()
    expect(useResumeStore.getState().atsResults?.mode).toBe("quality")
  })

  it("requests a quality run when the job description is whitespace only", async () => {
    useResumeStore.setState({ jobDescription: "   " })
    mockedAnalyzeATS.mockResolvedValue({
      success: true,
      data: { ...mockAnalysisResult, missingKeywords: [], mode: "quality" },
    })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    expect(mockedAnalyzeATS).toHaveBeenCalledWith("resume-a", [], "   ", "quality")
  })

  it("toasts a job-description hint when the server reports one is missing", async () => {
    mockedAnalyzeATS.mockResolvedValue({
      error: "Add a job description before analyzing.",
      code: "MISSING_JOB_DESCRIPTION",
    })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    expect(useResumeStore.getState().atsError).toBe("Add a job description before analyzing.")
    expect(toast.error).toHaveBeenCalledWith(
      "Add a job description in the Job Target panel, then analyze."
    )
  })

  it("does not toast for generic errors", async () => {
    mockedAnalyzeATS.mockResolvedValue({ error: "Resume not found" })

    const { result } = renderHook(() => useATSTrigger())

    await act(async () => {
      await result.current.trigger()
    })

    expect(useResumeStore.getState().atsError).toBe("Resume not found")
    expect(toast.error).not.toHaveBeenCalled()
  })
})
