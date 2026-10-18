import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { useResumeStore, type ATSResults, type ResumeData } from "../../hooks/use-resume-store"

const { mockGetJobDescription } = vi.hoisted(() => ({
  mockGetJobDescription: vi.fn(),
}))

vi.mock("../../actions/get-job-description", () => ({
  getJobDescriptionForResume: mockGetJobDescription,
}))

vi.mock("../../actions/save", () => ({ saveResume: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// The header, results and preview panes are exercised by their own test
// files — stubbing them here keeps this file focused on the editor's own
// composition: the compact Job Target summary, the drawer and the prefill.
vi.mock("../editor-header", () => ({ EditorHeader: () => <div data-testid="header" /> }))
vi.mock("../section-panel", () => ({ SectionPanel: () => <div data-testid="sections" /> }))
vi.mock("../ats-drawer", () => ({ ATSDrawer: () => <div data-testid="ats-drawer" /> }))
vi.mock("../enhance-drawer", () => ({ EnhanceDrawer: () => <div data-testid="enhance-drawer" /> }))
vi.mock("../resume-preview", () => ({ ResumePreview: () => <div data-testid="preview" /> }))

import { ResumeEditor } from "../resume-editor"

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

const jobOptions = [
  { id: "job-1", companyName: "Acme", jobTitle: "Backend Engineer", hasJobDescription: true },
]

describe("ResumeEditor - compact Job Target summary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // `resume: null` forces the mount effect's hydration guard to run fresh —
    // it otherwise no-ops when the incoming resume shares the previous test's id.
    useResumeStore.setState({ resume: null, jobDescription: "", openInspector: null })
    mockGetJobDescription.mockResolvedValue({ jobDescription: "Loaded listing text" })
  })

  it("says a job description is missing and why it matters when there is none", () => {
    render(<ResumeEditor resume={makeResume()} />)

    expect(screen.getByText("No job target — Analyze checks overall resume quality. Add one to check job match.")).toBeTruthy()
    expect(screen.getByText("Target: No target role")).toBeTruthy()
  })

  it("shows the attached state and a character count once one is present", () => {
    render(<ResumeEditor resume={makeResume({ targetRole: "Backend Engineer" })} />)
    act(() => {
      useResumeStore.getState().setJobDescription("Kubernetes required.")
    })

    expect(screen.getByText("Target: Backend Engineer")).toBeTruthy()
    expect(screen.getByText("Job description attached (20 characters)")).toBeTruthy()
  })

  it("hides the hint while the store has no resume, and shows it once it does", () => {
    // The mount effect hydrates the store synchronously under RTL, so the
    // pre-hydration paint is reproduced by putting the store back into its
    // `resume: null` state — the exact condition the guard reads.
    render(<ResumeEditor resume={makeResume()} />)
    act(() => {
      useResumeStore.setState({ resume: null, jobDescription: "" })
    })

    expect(
      screen.queryByText(
        "No job target — Analyze checks overall resume quality. Add one to check job match."
      )
    ).toBeNull()
    expect(screen.queryByText(/Job description attached/)).toBeNull()

    act(() => {
      useResumeStore.getState().setResume(makeResume())
    })

    expect(
      screen.getByText(
        "No job target — Analyze checks overall resume quality. Add one to check job match."
      )
    ).toBeTruthy()
  })

  it("opens the drawer from the Change button and Escape closes it", () => {
    render(<ResumeEditor resume={makeResume()} />)

    expect(useResumeStore.getState().openInspector).toBeNull()
    fireEvent.click(screen.getByLabelText("Change job target"))
    expect(useResumeStore.getState().openInspector).toBe("job")
    expect(screen.getByLabelText("Job target")).toBeTruthy()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(useResumeStore.getState().openInspector).toBeNull()
  })
})

describe("ResumeEditor - deep-link job description prefill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useResumeStore.setState({ resume: null, jobDescription: "", openInspector: null })
    mockGetJobDescription.mockResolvedValue({ jobDescription: "Loaded listing text" })
  })

  it("loads the description even though the drawer is never opened", async () => {
    render(
      <ResumeEditor
        resume={makeResume()}
        jobOptions={jobOptions}
        initialJobId="job-1"
      />
    )

    // The drawer was never opened in this test, and the panel that owns the
    // saved-job picker only mounts inside it — so this only passes if the
    // fetch runs from somewhere that stays mounted regardless.
    await waitFor(() => {
      expect(useResumeStore.getState().jobDescription).toBe("Loaded listing text")
    })
    expect(mockGetJobDescription).toHaveBeenCalledWith("job-1")
    expect(mockGetJobDescription).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Job description attached (19 characters)")).toBeTruthy()
  })

  // Before slice 3 this was shown inline by the panel; the hoisted effect's
  // `if (!("error" in result))` guard silently swallowed it instead.
  it("toasts the action's error instead of swallowing it", async () => {
    mockGetJobDescription.mockResolvedValue({ error: "This job has no description saved." })

    render(<ResumeEditor resume={makeResume()} jobOptions={jobOptions} initialJobId="job-1" />)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This job has no description saved.")
    )
    expect(useResumeStore.getState().jobDescription).toBe("")
  })
})

describe("ResumeEditor - ATS inspector auto-open", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useResumeStore.setState({ resume: null, jobDescription: "", openInspector: null })
    mockGetJobDescription.mockResolvedValue({ jobDescription: "Loaded listing text" })
  })

  const analysis: ATSResults = {
    overallScore: 72,
    scores: { formatting: 80, keywords: 60, impact: 70, completeness: 75, readability: 90 },
    issues: [],
    suggestions: [],
    missingKeywords: [],
  }

  it("does not open on mount for a resume hydrated with a saved analysis", () => {
    render(<ResumeEditor resume={makeResume({ latestAnalysis: analysis })} />)

    expect(useResumeStore.getState().openInspector).toBeNull()
  })

  it("opens the inspector when a fresh analysis lands", () => {
    render(<ResumeEditor resume={makeResume()} />)

    act(() => useResumeStore.getState().setIsAnalyzing(true))
    expect(useResumeStore.getState().openInspector).toBeNull()

    act(() => {
      useResumeStore.getState().setAtsResults(analysis)
      useResumeStore.getState().setIsAnalyzing(false)
    })

    expect(useResumeStore.getState().openInspector).toBe("ats")
  })

  // Re-analyze lives in the Enhance drawer and narrates the score movement
  // there — auto-switching to ATS would unmount it mid-sentence.
  it("stays on the Enhance inspector when the run was started from it", () => {
    render(<ResumeEditor resume={makeResume()} />)

    act(() => {
      useResumeStore.getState().setOpenInspector("enhance")
      useResumeStore.getState().setIsAnalyzing(true)
    })

    act(() => {
      useResumeStore.getState().setAtsResults(analysis)
      useResumeStore.getState().setIsAnalyzing(false)
    })

    expect(useResumeStore.getState().openInspector).toBe("enhance")
  })

  // Only Enhance owns the completion moment. A run started from the ATS
  // drawer and then left behind (drawer closed, Job Target or Preview opened
  // meanwhile) still lands the user on the fresh results.
  it.each(["job", "preview"] as const)(
    "switches from the %s inspector to ATS when the run finishes",
    (inspector) => {
      render(<ResumeEditor resume={makeResume()} />)

      act(() => useResumeStore.getState().setIsAnalyzing(true))
      act(() => useResumeStore.getState().setOpenInspector(inspector))
      expect(useResumeStore.getState().openInspector).toBe(inspector)

      act(() => {
        useResumeStore.getState().setAtsResults(analysis)
        useResumeStore.getState().setIsAnalyzing(false)
      })

      expect(useResumeStore.getState().openInspector).toBe("ats")
    },
  )
})

describe("ResumeEditor - Enhance inspector auto-open", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useResumeStore.setState({ resume: null, jobDescription: "", openInspector: null })
    mockGetJobDescription.mockResolvedValue({ jobDescription: "Loaded listing text" })
  })

  const suggestion = {
    id: "s1::i1::summary",
    sectionId: "s1",
    itemId: "i1",
    field: "summary" as const,
    action: "rewrite" as const,
    original: "Old",
    suggested: "New",
    reason: "reason",
    status: "pending" as const,
  }

  it("does not open on mount", () => {
    render(<ResumeEditor resume={makeResume()} />)

    expect(useResumeStore.getState().openInspector).toBeNull()
  })

  it("opens the inspector when a run lands with suggestions", () => {
    render(<ResumeEditor resume={makeResume()} />)

    act(() => useResumeStore.getState().setIsEnhancing(true))
    expect(useResumeStore.getState().openInspector).toBeNull()

    act(() => {
      useResumeStore.getState().setEnhanceSuggestions([suggestion])
      useResumeStore.getState().setIsEnhancing(false)
    })

    expect(useResumeStore.getState().openInspector).toBe("enhance")
  })
})

describe("ResumeEditor - resume switch closes an open inspector", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useResumeStore.setState({ resume: null, jobDescription: "", openInspector: null })
    mockGetJobDescription.mockResolvedValue({ jobDescription: "Loaded listing text" })
  })

  it("clears openInspector when the editor hydrates a different resume", () => {
    const { rerender } = render(<ResumeEditor resume={makeResume({ id: "resume-1" })} />)
    useResumeStore.getState().setOpenInspector("job")
    expect(useResumeStore.getState().openInspector).toBe("job")

    rerender(<ResumeEditor resume={makeResume({ id: "resume-2" })} />)

    expect(useResumeStore.getState().openInspector).toBeNull()
  })
})

/**
 * The single-mount invariant. `ResumePreview` owns a hidden A4 measurement
 * mirror and a pair of ResizeObservers, and pagination is derived from them —
 * so two live copies would mean two mirrors racing and a page count that can
 * disagree with the exported PDF. The editor must therefore RELOCATE the one
 * mount between the inline pane and the sheet, never render both and hide one
 * with CSS. These assert on composition (the mocked preview's testid), which
 * is exactly where that mistake would show up.
 */
describe("ResumeEditor - preview mounts exactly once", () => {
  const realMatchMedia = window.matchMedia

  function setViewport(isDesktop: boolean) {
    // `useMediaQuery` reads `matchMedia().matches`; jsdom ships none, and its
    // absence is what makes the default in every other test the mobile branch.
    window.matchMedia = ((query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useResumeStore.setState({ resume: null, jobDescription: "", openInspector: null })
    mockGetJobDescription.mockResolvedValue({ jobDescription: "Loaded listing text" })
  })

  afterEach(() => {
    window.matchMedia = realMatchMedia
  })

  it("renders the inline pane and no sheet at desktop widths", () => {
    setViewport(true)
    render(<ResumeEditor resume={makeResume()} />)

    expect(screen.getAllByTestId("preview")).toHaveLength(1)
    expect(document.querySelectorAll("[data-preview-pane]")).toHaveLength(1)
    // The sheet is not even mounted, so its trigger state cannot open one.
    expect(screen.queryByLabelText("Resume preview")).toBeNull()
  })

  it("renders no inline pane below xl, and still exactly one preview once the sheet opens", () => {
    setViewport(false)
    render(<ResumeEditor resume={makeResume()} />)

    // Closed sheet: Drawer renders nothing, so there is no preview at all.
    expect(screen.queryAllByTestId("preview")).toHaveLength(0)
    expect(document.querySelectorAll("[data-preview-pane]")).toHaveLength(0)

    act(() => {
      useResumeStore.getState().setOpenInspector("preview")
    })

    // Open sheet: one preview, one pane — the inline copy must NOT also appear.
    expect(screen.getAllByTestId("preview")).toHaveLength(1)
    expect(document.querySelectorAll("[data-preview-pane]")).toHaveLength(1)
  })

  it("closes the preview sheet on Escape", () => {
    setViewport(false)
    render(<ResumeEditor resume={makeResume()} />)
    act(() => {
      useResumeStore.getState().setOpenInspector("preview")
    })
    expect(screen.getByLabelText("Resume preview")).toBeTruthy()

    fireEvent.keyDown(document, { key: "Escape" })

    // Asserted on state rather than on the panel being gone: `Drawer` wraps it
    // in framer's AnimatePresence, whose exit never completes under jsdom.
    expect(useResumeStore.getState().openInspector).toBeNull()
  })
})

/**
 * The split switches at `xl` (1280px), not at `lg` (1024px) as it first did.
 * The app shell's sidebar is a fixed 240px, so a 1024px viewport left the two
 * panes ~383px and ~392px wide and the preview painted a 344px-wide A4 page
 * (scale 0.578) — measurably worse than the single-column layout with the
 * preview sheet.
 *
 * The JS query that decides which preview MOUNTS and the CSS classes that
 * actually split the columns have to agree; a stale `lg:` step would mount the
 * inline pane into a grid column that does not exist yet.
 */
describe("ResumeEditor - the split pane switches at xl", () => {
  const realMatchMedia = window.matchMedia
  let queries: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    useResumeStore.setState({ resume: null, jobDescription: "", openInspector: null })
    queries = []
    window.matchMedia = ((query: string) => {
      queries.push(query)
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }
    }) as unknown as typeof window.matchMedia
  })

  afterEach(() => {
    window.matchMedia = realMatchMedia
  })

  it("decides where the preview mounts from a 1280px query", () => {
    render(<ResumeEditor resume={makeResume()} />)

    expect(queries).toContain("(min-width: 1280px)")
    expect(queries).not.toContain("(min-width: 1024px)")
  })

  it("carries the grid split on `xl:` and keeps no `lg:` step anywhere", () => {
    const { container } = render(<ResumeEditor resume={makeResume()} />)

    const grid = container.querySelector("[class*='grid-cols-']")
    expect(grid).not.toBeNull()
    expect(grid!.className).toContain("xl:grid")
    expect(grid!.className).toContain("xl:overflow-hidden")

    // Every child that owns editor layout is stubbed except the editor's own
    // markup, so a surviving `lg:` here is a breakpoint the split left behind.
    const stale = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .map((el) => el.className)
      .filter((cls) => typeof cls === "string" && /(^|\s)lg:/.test(cls))

    expect(stale).toEqual([])
  })
})
