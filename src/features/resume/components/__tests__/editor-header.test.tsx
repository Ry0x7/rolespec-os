import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { useResumeStore } from "../../hooks/use-resume-store"
import type { ResumeData } from "../../hooks/use-resume-store"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: {} }, status: "authenticated", update: vi.fn() }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("@/features/export/actions/generate", () => ({
  generateResume: vi.fn(),
}))

vi.mock("@/features/export/actions/export-pdf", () => ({
  exportResumePdf: vi.fn(),
}))

vi.mock("../../actions/analyze-ats", () => ({
  analyzeATS: vi.fn(),
}))

vi.mock("../../actions/enhance", () => ({
  enhanceResumeFromATS: vi.fn(),
}))

import { EditorHeader } from "../editor-header"
import { exportResumePdf } from "@/features/export/actions/export-pdf"
import { generateResume } from "@/features/export/actions/generate"

afterEach(cleanup)

const makeResume = (overrides: Partial<ResumeData> = {}): ResumeData => ({
  id: "resume-header",
  title: "Header Resume",
  targetRole: null,
  targetCompany: null,
  template: "MINIMAL",
  sections: [],
  atsScore: null,
  jobDescription: null,
  latestAnalysis: null,
  ...overrides,
})

const lastExport = {
  templateUrls: {
    MINIMAL: {
      pdfUrl: "https://blob.example/minimal.pdf",
    },
  },
}

describe("EditorHeader - save state line", () => {
  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume())
  })

  it("shows nothing before the first save", () => {
    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.queryByRole("status")).toBeNull()
  })

  it("shows 'Unsaved changes' while dirty", () => {
    useResumeStore.setState({ isDirty: true, saveStatus: "idle" })

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByRole("status").textContent).toBe("Unsaved changes")
  })

  it("shows 'Saving…' while a save is in flight, even when still dirty", () => {
    useResumeStore.setState({ isDirty: true, saveStatus: "saving" })

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByRole("status").textContent).toBe("Saving…")
  })

  it("shows the local time of the last save once clean", () => {
    const savedAt = new Date(2026, 0, 2, 14, 5)
    useResumeStore.setState({ isDirty: false, saveStatus: "saved", lastSavedAt: savedAt })

    render(<EditorHeader onSave={vi.fn()} />)

    const expected = savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    expect(screen.getByRole("status").textContent).toBe(`Saved ${expected}`)
  })
})

describe("EditorHeader - plain PDF download", () => {
  const withContent = () =>
    makeResume({
      sections: [
        {
          id: "sec-1",
          resumeId: "resume-header",
          type: "SUMMARY",
          title: "Summary",
          order: 0,
          visible: true,
          items: [{ id: "item-1", sectionId: "sec-1", content: { text: "Hi" }, order: 0 }],
        },
      ],
    })

  // Download PDF now lives inside the Export menu, which only renders its
  // items once opened.
  function openExportMenu() {
    fireEvent.click(screen.getByLabelText("Export"))
  }

  beforeEach(() => {
    vi.mocked(exportResumePdf).mockReset()
  })

  it("is disabled while the resume has no content", () => {
    useResumeStore.getState().setResume(makeResume())

    render(<EditorHeader onSave={vi.fn()} />)
    openExportMenu()

    expect(screen.getByLabelText("Download PDF").hasAttribute("disabled")).toBe(true)
  })

  it("is enabled without any export and opens the returned url", async () => {
    useResumeStore.getState().setResume(withContent())
    vi.mocked(exportResumePdf).mockResolvedValue({
      success: true,
      pdfUrl: "/api/exports/resume-header/b/minimal-x.pdf",
      template: "MINIMAL",
    })
    const opened: string[] = []
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        opened.push(this.href)
      })

    render(<EditorHeader onSave={vi.fn()} />)
    openExportMenu()
    const button = screen.getByLabelText("Download PDF")
    expect(button.hasAttribute("disabled")).toBe(false)

    fireEvent.click(button)
    await waitFor(() => expect(exportResumePdf).toHaveBeenCalled())
    await waitFor(() => expect(opened.length).toBe(1))
    expect(opened[0]).toContain("/api/exports/resume-header/b/minimal-x.pdf")

    clickSpy.mockRestore()
  })

  it("saves pending edits before rendering, so the file is not a revision behind", async () => {
    useResumeStore.getState().setResume(withContent())
    useResumeStore.setState({ isDirty: true })
    const order: string[] = []
    const onSave = vi.fn(async () => {
      order.push("save")
    })
    vi.mocked(exportResumePdf).mockImplementation(async () => {
      order.push("export")
      return { success: true, pdfUrl: "/api/exports/a/b/c.pdf", template: "MINIMAL" }
    })
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {
        order.push("open")
      })

    render(<EditorHeader onSave={onSave} />)
    openExportMenu()
    fireEvent.click(screen.getByLabelText("Download PDF"))

    // Waiting for the open (not just the export) keeps the handler from
    // finishing after this test's spy is gone.
    await waitFor(() => expect(order).toEqual(["save", "export", "open"]))
    clickSpy.mockRestore()
  })

  it("surfaces the action's error instead of opening anything", async () => {
    useResumeStore.getState().setResume(withContent())
    vi.mocked(exportResumePdf).mockResolvedValue({ error: "Resume not found" })
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})

    render(<EditorHeader onSave={vi.fn()} />)
    openExportMenu()
    fireEvent.click(screen.getByLabelText("Download PDF"))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Resume not found"))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})

describe("EditorHeader - generate toast honesty", () => {
  const generatedSections = [
    {
      id: "sec-1",
      resumeId: "resume-header",
      type: "SUMMARY" as const,
      title: "Summary",
      order: 0,
      visible: true,
      items: [{ id: "item-1", sectionId: "sec-1", content: { text: "Hi" }, order: 0 }],
    },
  ]

  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume({ sections: generatedSections }))
    vi.mocked(generateResume).mockReset()
    vi.mocked(toast.success).mockReset()
  })

  it("claims a full generation only when the AI pass actually ran", async () => {
    vi.mocked(generateResume).mockResolvedValue({
      success: true,
      templateUrls: lastExport.templateUrls,
      sections: generatedSections,
      optimized: true,
    } as never)

    render(<EditorHeader onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText("Generate AI-optimized export"))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Resume generated successfully!")
    )
  })

  it("says the export skipped optimization when no AI key is configured", async () => {
    vi.mocked(generateResume).mockResolvedValue({
      success: true,
      templateUrls: lastExport.templateUrls,
      sections: generatedSections,
      optimized: false,
      optimizeFallbackReason: "ai_key_required",
    } as never)

    render(<EditorHeader onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText("Generate AI-optimized export"))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Exported without AI optimization — no AI key configured."
      )
    )
  })

  it("says the export skipped optimization on any other soft failure", async () => {
    vi.mocked(generateResume).mockResolvedValue({
      success: true,
      templateUrls: lastExport.templateUrls,
      sections: generatedSections,
      optimized: false,
      optimizeFallbackReason: "failed",
    } as never)

    render(<EditorHeader onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText("Generate AI-optimized export"))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Exported without AI optimization.")
    )
  })
})

describe("EditorHeader - export staleness", () => {
  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.getState().setLastExport(lastExport)
  })

  it("renders the download links without a stale label on a fresh export", () => {
    render(<EditorHeader onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText("Export"))

    expect(screen.getByLabelText("Download AI-optimized PDF")).toBeTruthy()
    expect(screen.queryByText("outdated")).toBeNull()
  })

  it("keeps the links clickable and labels them once the resume is edited", () => {
    useResumeStore.setState({ exportStale: true })

    render(<EditorHeader onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText("Export"))

    expect(screen.getByLabelText("Download AI-optimized PDF").getAttribute("href")).toBe(
      "https://blob.example/minimal.pdf"
    )
    expect(screen.getByText("outdated").getAttribute("title")).toBe(
      "Generated before your latest edits — Generate again for an up-to-date file"
    )
  })

  it("omits the AI-optimized item when no export exists for the current template", () => {
    useResumeStore.getState().setResume(makeResume({ template: "MODERN" }))
    useResumeStore.getState().setLastExport(lastExport)

    render(<EditorHeader onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText("Export"))

    expect(screen.queryByLabelText("Download AI-optimized PDF")).toBeNull()
  })
})

describe("EditorHeader - ATS toolbar button", () => {
  const analysis = {
    overallScore: 72,
    scores: { formatting: 80, keywords: 60, impact: 70, completeness: 75, readability: 90 },
    issues: [],
    suggestions: [],
    missingKeywords: [],
  }

  it("shows just 'ATS' and opens the inspector before any analysis exists", () => {
    useResumeStore.getState().setResume(makeResume())

    render(<EditorHeader onSave={vi.fn()} />)
    const button = screen.getByRole("button", { name: "ATS analysis" })
    expect(button.hasAttribute("disabled")).toBe(false)

    fireEvent.click(button)
    expect(useResumeStore.getState().openInspector).toBe("ats")
  })

  it("shows the score inline once an analysis exists", () => {
    useResumeStore.getState().setResume(makeResume({ latestAnalysis: analysis }))

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByRole("button", { name: "ATS score 72" })).toBeTruthy()
  })
})

describe("EditorHeader - header analysis status", () => {
  const qualityAnalysis = {
    overallScore: 65,
    scores: { formatting: 80, keywords: 60, impact: 70, completeness: 75, readability: 90 },
    issues: [
      { severity: "info" as const, category: "Impact", message: "Add a metric to the first bullet" },
      {
        severity: "critical" as const,
        category: "Completeness",
        message: "No summary section — recruiters read that first",
      },
      { severity: "critical" as const, category: "Impact", message: "Second critical, not shown" },
    ],
    suggestions: [],
    missingKeywords: [],
    mode: "quality" as const,
  }

  it("nudges a never-analyzed resume to run Resume Quality and opens the inspector", () => {
    useResumeStore.getState().setResume(makeResume())

    render(<EditorHeader onSave={vi.fn()} />)
    expect(screen.getByText("Not analyzed yet")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Run Resume Quality" }))
    expect(useResumeStore.getState().openInspector).toBe("ats")
  })

  it("names the nudge 'Run analysis' when the resume carries a job description", () => {
    useResumeStore.getState().setResume(makeResume({ jobDescription: "Listing text" }))

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Run analysis" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Run Resume Quality" })).toBeNull()
  })

  it("shows a quality-mode chip with the highest-severity issue, and opens the inspector", () => {
    useResumeStore.getState().setResume(makeResume({ latestAnalysis: qualityAnalysis }))

    render(<EditorHeader onSave={vi.fn()} />)

    const chip = screen.getByRole("button", { name: "Quality score 65, open analysis" })
    expect(chip.textContent).toContain("Quality 65")
    // First issue at the worst severity present — not the first issue overall.
    expect(chip.textContent).toContain("No summary section — recruiters read that first")
    expect(chip.getAttribute("title")).toBe(
      "No summary section — recruiters read that first"
    )

    fireEvent.click(chip)
    expect(useResumeStore.getState().openInspector).toBe("ats")
  })

  // At `lg` the app sidebar takes 248px from the header, and the toolbar
  // row with this line added overflows the viewport (measured 1024px:
  // Generate's right edge at 1044px even at an 8rem cap). Below `xl` the
  // button's title and the drawer carry the message instead.
  it("shows the issue line only from xl, where the toolbar has room", () => {
    useResumeStore.getState().setResume(makeResume({ latestAnalysis: qualityAnalysis }))

    render(<EditorHeader onSave={vi.fn()} />)

    const line = screen.getByText("No summary section — recruiters read that first")
    expect(line.className).toContain("xl:block")
    expect(line.className).not.toContain("lg:block")
  })

  it("labels a job-match analysis 'ATS'", () => {
    useResumeStore.getState().setResume(
      makeResume({
        jobDescription: "Listing text",
        latestAnalysis: { ...qualityAnalysis, issues: [], mode: "job-match" },
      })
    )

    render(<EditorHeader onSave={vi.fn()} />)

    const chip = screen.getByRole("button", { name: "ATS score 65, open analysis" })
    expect(chip.textContent).toContain("ATS 65")
    expect(chip.textContent).toContain("No issues flagged")
  })

  it("falls back to the denormalized score when only atsScore was hydrated", () => {
    useResumeStore.getState().setResume(makeResume({ atsScore: 42 }))

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Quality score 42, open analysis" })).toBeTruthy()
    expect(screen.queryByText("Not analyzed yet")).toBeNull()
  })

  it("replaces the chip with 'Analyzing…' while a run is in flight", () => {
    useResumeStore.getState().setResume(makeResume({ latestAnalysis: qualityAnalysis }))
    useResumeStore.setState({ isAnalyzing: true })

    render(<EditorHeader onSave={vi.fn()} />)

    expect(
      screen.getAllByRole("status").some((el) => el.textContent === "Analyzing…")
    ).toBe(true)
    expect(screen.queryByRole("button", { name: /open analysis/ })).toBeNull()
  })

  it("renders nothing before the store has the resume, then the real state after", () => {
    // The loader's data reaches the store from an effect, so the first paint
    // after navigation has `resume: null`. Rendering the never-analyzed branch
    // there flashed "Not analyzed yet" on an analyzed job-match resume.
    useResumeStore.setState({ resume: null, atsResults: null, isAnalyzing: false })

    const { unmount } = render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.queryByText("Not analyzed yet")).toBeNull()
    expect(screen.queryByRole("button", { name: "Run Resume Quality" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Run analysis" })).toBeNull()
    expect(screen.queryByRole("button", { name: /open analysis/ })).toBeNull()

    unmount()
    useResumeStore.getState().setResume(
      makeResume({
        jobDescription: "Listing text",
        latestAnalysis: { ...qualityAnalysis, mode: "job-match" },
      })
    )
    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByRole("button", { name: "ATS score 65, open analysis" })).toBeTruthy()
  })
})

describe("EditorHeader - Enhance toolbar button", () => {
  it("opens the inspector instead of running the AI directly, and is never disabled", () => {
    useResumeStore.getState().setResume(makeResume())

    render(<EditorHeader onSave={vi.fn()} />)
    const button = screen.getByRole("button", { name: "Enhance" })
    expect(button.hasAttribute("disabled")).toBe(false)

    fireEvent.click(button)
    expect(useResumeStore.getState().openInspector).toBe("enhance")
  })

  it("shows the pending suggestion count once suggestions exist", () => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.getState().setEnhanceSuggestions([
      {
        id: "s::i::summary",
        sectionId: "s",
        itemId: "i",
        field: "summary",
        action: "rewrite",
        original: "Old",
        suggested: "New",
        reason: "reason",
        status: "pending",
      },
    ])

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Enhance" }).textContent).toContain("1")
  })
})

describe("EditorHeader - save button", () => {
  it("is disabled while the resume is clean", () => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ isDirty: false, saveStatus: "idle" })

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByLabelText("Saved").hasAttribute("disabled")).toBe(true)
  })

  it("is enabled once the resume is dirty", () => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ isDirty: true, saveStatus: "idle" })

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByLabelText("Save").hasAttribute("disabled")).toBe(false)
  })
})

describe("EditorHeader - preview toggle", () => {
  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ openInspector: null })
  })

  it("opens the preview inspector", () => {
    render(<EditorHeader onSave={vi.fn()} />)

    fireEvent.click(screen.getByLabelText("Preview"))

    expect(useResumeStore.getState().openInspector).toBe("preview")
  })

  it("opens each inspector from its own toolbar control", () => {
    render(<EditorHeader onSave={vi.fn()} />)

    fireEvent.click(screen.getByLabelText("Job target"))
    expect(useResumeStore.getState().openInspector).toBe("job")

    // One field, so opening another closes the first by construction.
    fireEvent.click(screen.getByLabelText("ATS analysis"))
    expect(useResumeStore.getState().openInspector).toBe("ats")

    fireEvent.click(screen.getByLabelText("Enhance"))
    expect(useResumeStore.getState().openInspector).toBe("enhance")
  })
})

describe("EditorHeader - back to job", () => {
  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume())
  })

  it("links back to the job a tailored resume belongs to", () => {
    render(
      <EditorHeader
        onSave={vi.fn()}
        linkedJob={{ id: "app-9", title: "Staff Engineer" }}
      />
    )

    const link = screen.getByRole("link", { name: "Back to job: Staff Engineer" })
    expect(link.getAttribute("href")).toBe("/jobs/app-9#prepare")
  })

  it("renders nothing for a resume with no linked job", () => {
    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.queryByText(/Back to job:/)).toBeNull()
  })
})

describe("EditorHeader - resume kind badge", () => {
  it("labels a master resume", () => {
    useResumeStore.getState().setResume(makeResume({ variant: "MASTER" }))

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByText("Master")).toBeTruthy()
  })

  it("labels a role family resume and names its family", () => {
    useResumeStore
      .getState()
      .setResume(makeResume({ variant: "ROLE_FAMILY", roleFamilyName: "Backend" }))

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByText("Role family")).toBeTruthy()
    expect(screen.getByText("Backend")).toBeTruthy()
  })

  it("keeps the back-to-job link beside the badge on a tailored resume", () => {
    useResumeStore.getState().setResume(makeResume({ variant: "JOB_TAILORED" }))

    render(
      <EditorHeader onSave={vi.fn()} linkedJob={{ id: "app-9", title: "Staff Engineer" }} />
    )

    expect(screen.getByText("Job tailored")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Back to job: Staff Engineer" })).toBeTruthy()
  })

  it("renders no badge when the kind is not known", () => {
    useResumeStore.getState().setResume(makeResume())

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.queryByText(/^(Master|Role family|Job tailored)$/)).toBeNull()
  })
})

describe("EditorHeader - resume lineage", () => {
  it("links a derived resume to its source, keeping the back-to-job link", () => {
    useResumeStore.getState().setResume(
      makeResume({
        variant: "JOB_TAILORED",
        sourceResume: { id: "resume-src", title: "Platform Master", status: "ACTIVE" },
        origin: null,
      })
    )

    render(
      <EditorHeader onSave={vi.fn()} linkedJob={{ id: "app-9", title: "Staff Engineer" }} />
    )

    expect(
      screen.getByRole("link", { name: "From Platform Master" }).getAttribute("href")
    ).toBe("/resumes/resume-src")
    expect(screen.getByRole("link", { name: "Back to job: Staff Engineer" })).toBeTruthy()
  })

  it("says a profile-built master came from the Career Profile", () => {
    useResumeStore
      .getState()
      .setResume(makeResume({ variant: "MASTER", origin: "profile", sourceResume: null }))

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByText("From Career Profile")).toBeTruthy()
  })

  it("shows nothing for a master without careerProfileId", () => {
    useResumeStore
      .getState()
      .setResume(makeResume({ variant: "MASTER", origin: null, sourceResume: null }))

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByText("Master")).toBeTruthy()
    expect(screen.queryByText(/^From /)).toBeNull()
    expect(screen.queryByText("Uploaded")).toBeNull()
  })

  it("names an archived source without linking it", () => {
    useResumeStore.getState().setResume(
      makeResume({
        variant: "ROLE_FAMILY",
        sourceResume: { id: "resume-src", title: "Old Master", status: "ARCHIVED" },
        origin: null,
      })
    )

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.getByText("From Old Master")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "From Old Master" })).toBeNull()
  })

  it("shows no lineage for a pre-lineage derived resume", () => {
    useResumeStore
      .getState()
      .setResume(makeResume({ variant: "ROLE_FAMILY", sourceResume: null, origin: null }))

    render(<EditorHeader onSave={vi.fn()} />)

    expect(screen.queryByText(/^From /)).toBeNull()
    expect(screen.queryByText("Uploaded")).toBeNull()
  })
})

describe("EditorHeader - Export menu is not clipped", () => {
  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ openInspector: null })
  })

  /**
   * Regression: the toolbar row briefly carried `overflow-x-auto` to pre-empt
   * an overflow that never happened (icon-only buttons fit 320px). Because
   * `DropdownMenuContent` is absolutely positioned and `overflow-x: auto`
   * computes `overflow-y` to `auto` too, it cropped the open menu to the 32px
   * height of the row. jsdom computes no layout, so this asserts the CAUSE —
   * no scroll-clipping ancestor between the menu and the header — rather than
   * the visual symptom.
   */
  it("has no overflow-clipping ancestor between the Export menu and the toolbar", () => {
    const { container } = render(<EditorHeader onSave={vi.fn()} />)

    fireEvent.click(screen.getByLabelText("Export"))
    const menu = screen.getByRole("menu")

    const clippers: string[] = []
    for (let el = menu.parentElement; el && el !== container; el = el.parentElement) {
      const cls = el.className
      if (typeof cls === "string" && /\boverflow-(x-|y-)?(auto|hidden|scroll)\b/.test(cls)) {
        clippers.push(cls)
      }
    }

    expect(clippers).toEqual([])
  })

  /**
   * Regression: when the toolbar row wraps on a phone, Export lands at the
   * left edge of the second line and a right-aligned menu ran off-screen left
   * ("Download PDF" at left -115 on a 390px viewport). Below `md` the menu
   * positions against the row and anchors left; from `md` it is right-aligned
   * under the trigger. jsdom computes no layout, so this asserts the classes.
   */
  it("anchors the Export menu to the row's left edge below md, right-aligned from md", () => {
    render(<EditorHeader onSave={vi.fn()} />)

    const trigger = screen.getByLabelText("Export")
    fireEvent.click(trigger)
    const menu = screen.getByRole("menu")

    expect(menu.className).toMatch(/(^|\s)left-0(\s|$)/)
    expect(menu.className).toMatch(/(^|\s)right-auto(\s|$)/)
    expect(menu.className).toMatch(/(^|\s)md:right-0(\s|$)/)
    expect(menu.className).toMatch(/(^|\s)md:left-auto(\s|$)/)
    expect(menu.className).not.toMatch(/(^|\s)right-0(\s|$)/)
    expect(trigger.parentElement?.className).toMatch(/(^|\s)static(\s|$)/)
    expect(trigger.parentElement?.className).toMatch(/(^|\s)md:relative(\s|$)/)
    expect(trigger.parentElement?.parentElement?.className).toMatch(/(^|\s)relative(\s|$)/)
  })
})

describe("EditorHeader - toolbar fits a phone", () => {
  beforeEach(() => {
    // Never analyzed: the widest toolbar state, with the "Run Resume Quality"
    // nudge in the row.
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ openInspector: null })
  })

  /**
   * Regression: at 390px the never-analyzed toolbar measured 427px and pushed
   * the page sideways (scrollWidth 443). The row wraps instead of scrolling —
   * a scroll container would clip the Export menu (see above). jsdom computes
   * no layout, so this asserts the structural fix.
   */
  it("lets the toolbar row wrap", () => {
    render(<EditorHeader onSave={vi.fn()} />)

    screen.getByRole("button", { name: "Run Resume Quality" })
    const row = screen.getByLabelText("Job target").parentElement
    expect(row?.className).toMatch(/\bflex-wrap\b/)
    expect(row?.contains(screen.getByLabelText("Export"))).toBe(true)
  })
})
