import { describe, it, expect, beforeEach } from "vitest"
import { useResumeStore } from "../use-resume-store"
import type {
  ResumeData,
  ATSResults,
  Section,
  EnhanceSuggestion,
} from "../use-resume-store"
import type { SectionType } from "@/generated/prisma/enums"
import {
  DEFAULT_CUSTOMIZATION,
  customizationStorageKey,
  saveCustomization,
} from "../../types/customization"
import { enhanceStateKey, saveEnhanceState } from "../../lib/enhance-persistence"

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

const mockAnalysis: ATSResults = {
  overallScore: 85,
  scores: {
    formatting: 90,
    keywords: 80,
    impact: 85,
    completeness: 82,
    readability: 88,
  },
  issues: [],
  suggestions: [],
  missingKeywords: ["TypeScript", "React"],
}

describe("useResumeStore - setResume full reset", () => {
  beforeEach(() => {
    useResumeStore.setState({
      resume: null,
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

  it("resets isAnalyzing to false even if it was true before", () => {
    useResumeStore.setState({ isAnalyzing: true })

    useResumeStore.getState().setResume(makeResume())

    expect(useResumeStore.getState().isAnalyzing).toBe(false)
  })

  it("resets atsError to null even if it was set before", () => {
    useResumeStore.setState({ atsError: "Previous error" })

    useResumeStore.getState().setResume(makeResume())

    expect(useResumeStore.getState().atsError).toBeNull()
  })

  it("resets activeSection to null even if it was set before", () => {
    useResumeStore.setState({ activeSection: "section-123" })

    useResumeStore.getState().setResume(makeResume())

    expect(useResumeStore.getState().activeSection).toBeNull()
  })

  it("resets generateStatus to idle even if it was generating", () => {
    useResumeStore.setState({ generateStatus: "generating" })

    useResumeStore.getState().setResume(makeResume())

    expect(useResumeStore.getState().generateStatus).toBe("idle")
  })

  it("sets atsResults from resume.latestAnalysis when present", () => {
    useResumeStore.getState().setResume(makeResume({ latestAnalysis: mockAnalysis }))

    expect(useResumeStore.getState().atsResults).toEqual(mockAnalysis)
  })

  it("sets atsResults to null when resume has no latestAnalysis", () => {
    useResumeStore.setState({ atsResults: mockAnalysis })

    useResumeStore.getState().setResume(makeResume({ latestAnalysis: null }))

    expect(useResumeStore.getState().atsResults).toBeNull()
  })
})

// Local copy: the shared `makeSection` below is declared later in the file and
// these describe bodies run at collection time.
const makeSectionForExport = (
  id: string,
  order: number,
  type: SectionType = "CUSTOM"
): Section => ({
  id,
  resumeId: "resume-1",
  type,
  title: id,
  order,
  visible: true,
  items: [],
})

describe("useResumeStore - export staleness and save time", () => {
  const lastExport = {
    templateUrls: {
      MINIMAL: { pdfUrl: "https://blob.example/m.pdf" },
    },
  }

  const seeded = (): Section[] => [
    {
      ...makeSectionForExport("summary-section", 0, "SUMMARY"),
      items: [
        {
          id: "summary-item",
          sectionId: "summary-section",
          content: { text: "Original" },
          order: 0,
        },
      ],
    },
    makeSectionForExport("extra-section", 1),
  ]

  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume({ sections: seeded() }))
    useResumeStore.getState().setLastExport(lastExport)
  })

  it("starts a resume with a fresh, non-stale export", () => {
    expect(useResumeStore.getState().exportStale).toBe(false)
    expect(useResumeStore.getState().lastSavedAt).toBeNull()
  })

  // Every content mutation invalidates the generated files, but the files
  // themselves stay downloadable.
  const mutations: [string, () => void][] = [
    [
      "updateSectionItem",
      () =>
        useResumeStore
          .getState()
          .updateSectionItem("summary-section", "summary-item", { text: "Edited" }),
    ],
    ["addSectionItem", () => useResumeStore.getState().addSectionItem("summary-section", { text: "New" })],
    [
      "removeSectionItem",
      () => useResumeStore.getState().removeSectionItem("summary-section", "summary-item"),
    ],
    ["addSection", () => useResumeStore.getState().addSection(makeSectionForExport("added", 2))],
    ["removeSection", () => useResumeStore.getState().removeSection("extra-section")],
    // Down, not up: reorderSection refuses to move anything above index 0.
    ["reorderSection", () => useResumeStore.getState().reorderSection("summary-section", "down")],
    [
      "reorderSections",
      () => useResumeStore.getState().reorderSections(["extra-section", "summary-section"]),
    ],
    [
      "reorderSectionItems",
      () => useResumeStore.getState().reorderSectionItems("summary-section", ["summary-item"]),
    ],
    ["updateTemplate", () => useResumeStore.getState().updateTemplate("MODERN")],
  ]

  for (const [name, mutate] of mutations) {
    it(`${name} marks the export stale but keeps the download URLs`, () => {
      mutate()

      expect(useResumeStore.getState().exportStale).toBe(true)
      expect(useResumeStore.getState().lastExport).toEqual(lastExport)
    })
  }

  it("setLastExport clears the staleness flag", () => {
    useResumeStore.getState().updateTemplate("MODERN")
    expect(useResumeStore.getState().exportStale).toBe(true)

    useResumeStore.getState().setLastExport(lastExport)

    expect(useResumeStore.getState().exportStale).toBe(false)
  })

  it("markClean records the save time and leaves the export stale", () => {
    useResumeStore.getState().updateTemplate("MODERN")

    const before = Date.now()
    useResumeStore.getState().markClean()

    const state = useResumeStore.getState()
    expect(state.isDirty).toBe(false)
    expect(state.saveStatus).toBe("saved")
    expect(state.lastSavedAt).toBeInstanceOf(Date)
    expect(state.lastSavedAt!.getTime()).toBeGreaterThanOrEqual(before)
    // Saving persists content; it does not regenerate the PDF.
    expect(state.exportStale).toBe(true)
  })

  // The server computes staleness from resume.updatedAt vs export.createdAt, so
  // a reload of an edited-then-saved resume has to re-raise the flag that
  // setLastExport just cleared.
  it("setExportStale re-raises staleness after the mount seeding order", () => {
    useResumeStore.getState().setResume(makeResume({ sections: seeded() }))
    useResumeStore.getState().setLastExport(lastExport)
    useResumeStore.getState().setExportStale(true)

    const state = useResumeStore.getState()
    expect(state.exportStale).toBe(true)
    expect(state.lastExport).toEqual(lastExport)
  })

  it("setExportStale(false) leaves a fresh export unlabelled", () => {
    useResumeStore.getState().setLastExport(lastExport)
    useResumeStore.getState().setExportStale(false)

    expect(useResumeStore.getState().exportStale).toBe(false)
  })

  it("setResume resets staleness and the save time for the next resume", () => {
    useResumeStore.getState().updateTemplate("MODERN")
    useResumeStore.getState().markClean()

    useResumeStore.getState().setResume(makeResume({ id: "resume-9" }))

    expect(useResumeStore.getState().exportStale).toBe(false)
    expect(useResumeStore.getState().lastSavedAt).toBeNull()
  })
})

describe("useResumeStore - atsStale", () => {
  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume({ sections: [makeSectionForExport("summary-section", 0, "SUMMARY")] }))
  })

  it("starts a fresh resume not stale", () => {
    expect(useResumeStore.getState().atsStale).toBe(false)
  })

  it("a content edit marks the analysis stale", () => {
    useResumeStore.getState().updateTemplate("MODERN")

    expect(useResumeStore.getState().atsStale).toBe(true)
  })

  it("setAtsResults clears staleness", () => {
    useResumeStore.getState().updateTemplate("MODERN")
    expect(useResumeStore.getState().atsStale).toBe(true)

    useResumeStore.getState().setAtsResults(mockAnalysis)

    expect(useResumeStore.getState().atsStale).toBe(false)
  })

  it("a later edit re-raises staleness after a fresh analysis", () => {
    useResumeStore.getState().setAtsResults(mockAnalysis)
    expect(useResumeStore.getState().atsStale).toBe(false)

    useResumeStore.getState().addSectionItem("summary-section", { text: "New" })

    expect(useResumeStore.getState().atsStale).toBe(true)
  })

  it("setResume resets staleness for the next resume", () => {
    useResumeStore.getState().updateTemplate("MODERN")
    expect(useResumeStore.getState().atsStale).toBe(true)

    useResumeStore.getState().setResume(makeResume({ id: "resume-9" }))

    expect(useResumeStore.getState().atsStale).toBe(false)
  })
})

describe("useResumeStore - atsPreviousScore", () => {
  const quality: ATSResults = { ...mockAnalysis, overallScore: 60, mode: "quality" }

  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume())
  })

  it("is null on a fresh resume and after the first analysis", () => {
    expect(useResumeStore.getState().atsPreviousScore).toBeNull()
    useResumeStore.getState().setAtsResults(quality)
    expect(useResumeStore.getState().atsPreviousScore).toBeNull()
  })

  it("records the replaced score when a comparable re-analysis lands", () => {
    useResumeStore.getState().setAtsResults(quality)
    useResumeStore.getState().setAtsResults({ ...quality, overallScore: 68 })
    expect(useResumeStore.getState().atsPreviousScore).toBe(60)

    useResumeStore.getState().setAtsResults({ ...quality, overallScore: 70 })
    expect(useResumeStore.getState().atsPreviousScore).toBe(68)
  })

  it("does not compare across analysis modes", () => {
    useResumeStore.getState().setAtsResults(quality)
    useResumeStore.getState().setAtsResults({ ...mockAnalysis, mode: "job-match" })
    expect(useResumeStore.getState().atsPreviousScore).toBeNull()
  })

  it("treats a hydrated analysis as the 'before' for the next run", () => {
    useResumeStore.getState().setResume(makeResume({ latestAnalysis: quality }))
    expect(useResumeStore.getState().atsPreviousScore).toBeNull()
    useResumeStore.getState().setAtsResults({ ...quality, overallScore: 64 })
    expect(useResumeStore.getState().atsPreviousScore).toBe(60)
  })

  it("is cleared by clearAtsPreviousScore, setAtsResults(null) and setResume", () => {
    useResumeStore.getState().setAtsResults(quality)
    useResumeStore.getState().setAtsResults({ ...quality, overallScore: 68 })
    useResumeStore.getState().clearAtsPreviousScore()
    expect(useResumeStore.getState().atsPreviousScore).toBeNull()

    useResumeStore.getState().setAtsResults({ ...quality, overallScore: 70 })
    useResumeStore.getState().setAtsResults(null)
    expect(useResumeStore.getState().atsPreviousScore).toBeNull()

    useResumeStore.getState().setAtsResults(quality)
    useResumeStore.getState().setAtsResults({ ...quality, overallScore: 75 })
    useResumeStore.getState().setResume(makeResume({ id: "resume-2" }))
    expect(useResumeStore.getState().atsPreviousScore).toBeNull()
  })
})

describe("useResumeStore - dismissing enhance suggestions", () => {
  const pending: EnhanceSuggestion = {
    id: "sec::item::summary",
    sectionId: "sec",
    itemId: "item",
    field: "summary",
    action: "rewrite",
    original: "Old",
    suggested: "New",
    reason: "Why",
    status: "pending",
  }
  const applied: EnhanceSuggestion = { ...pending, id: "sec::item2::summary", status: "applied" }
  const find = (id: string) =>
    useResumeStore.getState().enhanceSuggestions?.find((s) => s.id === id)

  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.getState().setEnhanceSuggestions([{ ...pending }, { ...applied }])
  })

  it("dismisses and un-dismisses a pending suggestion without touching the resume", () => {
    const resumeBefore = useResumeStore.getState().resume

    useResumeStore.getState().dismissEnhanceSuggestion(pending.id)
    expect(find(pending.id)!.dismissed).toBe(true)
    expect(find(pending.id)!.status).toBe("pending")

    useResumeStore.getState().undismissEnhanceSuggestion(pending.id)
    expect(find(pending.id)!.dismissed).toBe(false)

    expect(useResumeStore.getState().resume).toBe(resumeBefore)
    expect(useResumeStore.getState().isDirty).toBe(false)
    expect(useResumeStore.getState().atsStale).toBe(false)
  })

  it("never dismisses an applied suggestion", () => {
    useResumeStore.getState().dismissEnhanceSuggestion(applied.id)
    expect(find(applied.id)!.dismissed).toBeFalsy()
  })

  it("a new suggestion set (re-run) clears dismissed state", () => {
    useResumeStore.getState().dismissEnhanceSuggestion(pending.id)
    const current = useResumeStore.getState().enhanceSuggestions!

    useResumeStore.getState().setEnhanceSuggestions(current.map((s) => ({ ...s })))

    expect(find(pending.id)!.dismissed).toBeFalsy()
  })
})

describe("useResumeStore - customization persistence", () => {
  beforeEach(() => {
    window.localStorage.clear()
    useResumeStore.setState({ resume: null, customization: { ...DEFAULT_CUSTOMIZATION } })
  })

  it("defaults to DEFAULT_CUSTOMIZATION", () => {
    expect(useResumeStore.getState().customization).toEqual(DEFAULT_CUSTOMIZATION)
  })

  it("merges partial updates and writes them to localStorage", () => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.getState().setCustomization({ density: "compact" })
    useResumeStore.getState().setCustomization({ accent: "#166534" })

    const state = useResumeStore.getState().customization
    expect(state.density).toBe("compact")
    expect(state.accent).toBe("#166534")
    expect(state.fontScale).toBe(DEFAULT_CUSTOMIZATION.fontScale)

    const stored = window.localStorage.getItem(customizationStorageKey("resume-1"))
    expect(stored && JSON.parse(stored)).toEqual(state)
  })

  it("hydrates the stored customization when a resume loads", () => {
    saveCustomization("resume-2", { ...DEFAULT_CUSTOMIZATION, margins: "relaxed" })

    useResumeStore.getState().setResume(makeResume({ id: "resume-2" }))
    expect(useResumeStore.getState().customization.margins).toBe("relaxed")

    // Switching to a resume without stored settings falls back to defaults.
    useResumeStore.getState().setResume(makeResume({ id: "resume-3" }))
    expect(useResumeStore.getState().customization).toEqual(DEFAULT_CUSTOMIZATION)
  })

  it("resets to defaults and persists the reset", () => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.getState().setCustomization({ fontScale: 1.1 })
    useResumeStore.getState().resetCustomization()

    expect(useResumeStore.getState().customization).toEqual(DEFAULT_CUSTOMIZATION)
    const stored = window.localStorage.getItem(customizationStorageKey("resume-1"))
    expect(stored && JSON.parse(stored)).toEqual(DEFAULT_CUSTOMIZATION)
  })
})

const makeSection = (id: string, order: number, type: SectionType = "CUSTOM"): Section => ({
  id,
  resumeId: "resume-1",
  type,
  title: id,
  order,
  visible: true,
  items: [],
})

describe("useResumeStore - section reordering", () => {
  beforeEach(() => {
    useResumeStore.getState().setResume(
      makeResume({
        sections: [
          makeSection("contact", 0, "CONTACT"),
          makeSection("a", 1),
          makeSection("b", 2),
          makeSection("c", 3),
        ],
      })
    )
  })

  const ids = () => useResumeStore.getState().resume!.sections.map((s) => s.id)
  const orders = () => useResumeStore.getState().resume!.sections.map((s) => s.order)

  it("reorderSections re-sorts the array itself, not just the order field", () => {
    useResumeStore.getState().reorderSections(["contact", "c", "a", "b"])

    expect(ids()).toEqual(["contact", "c", "a", "b"])
    expect(orders()).toEqual([0, 1, 2, 3])
  })

  it("reorderSections marks the resume dirty", () => {
    useResumeStore.setState({ isDirty: false })
    useResumeStore.getState().reorderSections(["contact", "c", "a", "b"])

    expect(useResumeStore.getState().isDirty).toBe(true)
  })

  it("reorderSection down swaps with the next section and re-sorts the array", () => {
    useResumeStore.getState().reorderSection("a", "down")

    expect(ids()).toEqual(["contact", "b", "a", "c"])
    expect(orders()).toEqual([0, 1, 2, 3])
  })

  it("reorderSection up swaps with the previous section and re-sorts the array", () => {
    useResumeStore.getState().reorderSection("c", "up")

    expect(ids()).toEqual(["contact", "a", "c", "b"])
    expect(orders()).toEqual([0, 1, 2, 3])
  })

  it("reorderSection refuses to move a section above the contact section", () => {
    useResumeStore.getState().reorderSection("a", "up")

    expect(ids()).toEqual(["contact", "a", "b", "c"])
  })

  it("reorderSection refuses to move the last section down", () => {
    useResumeStore.getState().reorderSection("c", "down")

    expect(ids()).toEqual(["contact", "a", "b", "c"])
  })

  it("reorderSection ignores unknown section ids", () => {
    useResumeStore.getState().reorderSection("nope", "down")

    expect(ids()).toEqual(["contact", "a", "b", "c"])
  })
})

describe("useResumeStore - section item reordering", () => {
  const makeItem = (id: string, order: number) => ({
    id,
    sectionId: "certs",
    content: { name: id },
    order,
  })

  beforeEach(() => {
    useResumeStore.getState().setResume(
      makeResume({
        sections: [
          {
            ...makeSection("certs", 0, "CERTIFICATIONS"),
            items: [makeItem("one", 0), makeItem("two", 1), makeItem("three", 2)],
          },
        ],
      })
    )
  })

  const itemIds = () => useResumeStore.getState().resume!.sections[0].items.map((i) => i.id)
  const itemOrders = () => useResumeStore.getState().resume!.sections[0].items.map((i) => i.order)

  it("reorderSectionItems re-sorts the items array itself, not just the order field", () => {
    useResumeStore.getState().reorderSectionItems("certs", ["three", "one", "two"])

    expect(itemIds()).toEqual(["three", "one", "two"])
    expect(itemOrders()).toEqual([0, 1, 2])
    expect(useResumeStore.getState().isDirty).toBe(true)
  })

  it("reorderSectionItems leaves other sections untouched", () => {
    useResumeStore.getState().reorderSectionItems("nope", ["three", "one", "two"])

    expect(itemIds()).toEqual(["one", "two", "three"])
  })
})

describe("useResumeStore - enhance suggestions", () => {
  const summarySection: Section = {
    ...makeSection("summary-section", 1, "SUMMARY"),
    items: [
      {
        id: "summary-item",
        sectionId: "summary-section",
        content: { text: "Old summary" },
        order: 0,
      },
    ],
  }

  const experienceSection: Section = {
    ...makeSection("exp-section", 2, "EXPERIENCE"),
    items: [
      {
        id: "exp-item",
        sectionId: "exp-section",
        content: { company: "Acme", bullets: ["Old bullet one", "Old bullet two"] },
        order: 0,
      },
    ],
  }

  const summarySuggestion: EnhanceSuggestion = {
    id: "summary-section::summary-item::summary",
    sectionId: "summary-section",
    itemId: "summary-item",
    field: "summary",
    action: "rewrite",
    original: "Old summary",
    suggested: "New summary",
    reason: "Adds the missing keyword",
    status: "pending",
  }

  const bulletSuggestion: EnhanceSuggestion = {
    id: "exp-section::exp-item::b1",
    sectionId: "exp-section",
    itemId: "exp-item",
    field: "bullet",
    action: "rewrite",
    bulletIndex: 1,
    original: "Old bullet two",
    suggested: "New bullet two",
    reason: "Quantifies the impact",
    status: "pending",
  }

  const summaryText = () =>
    (useResumeStore.getState().resume!.sections[0].items[0].content as { text?: string }).text
  const bullets = () =>
    (useResumeStore.getState().resume!.sections[1].items[0].content as { bullets?: string[] })
      .bullets
  const suggestion = (id: string) =>
    useResumeStore.getState().enhanceSuggestions?.find((s) => s.id === id)

  beforeEach(() => {
    useResumeStore
      .getState()
      .setResume(
        makeResume({
          sections: [
            structuredClone(summarySection),
            structuredClone(experienceSection),
          ],
        })
      )
    useResumeStore
      .getState()
      .setEnhanceSuggestions([{ ...summarySuggestion }, { ...bulletSuggestion }])
  })

  it("applyEnhanceSuggestion writes the suggested summary and flips the status", () => {
    useResumeStore.getState().applyEnhanceSuggestion(summarySuggestion.id)

    expect(summaryText()).toBe("New summary")
    expect(suggestion(summarySuggestion.id)?.status).toBe("applied")
    expect(useResumeStore.getState().isDirty).toBe(true)
  })

  it("applyEnhanceSuggestion writes only the targeted bullet index", () => {
    useResumeStore.getState().applyEnhanceSuggestion(bulletSuggestion.id)

    expect(bullets()).toEqual(["Old bullet one", "New bullet two"])
    expect(suggestion(bulletSuggestion.id)?.status).toBe("applied")
  })

  it("revertEnhanceSuggestion restores the original text and status", () => {
    useResumeStore.getState().applyEnhanceSuggestion(bulletSuggestion.id)
    useResumeStore.getState().revertEnhanceSuggestion(bulletSuggestion.id)

    expect(bullets()).toEqual(["Old bullet one", "Old bullet two"])
    expect(suggestion(bulletSuggestion.id)?.status).toBe("pending")
  })

  it("revertEnhanceSuggestion restores the original even after a manual edit", () => {
    useResumeStore.getState().applyEnhanceSuggestion(summarySuggestion.id)
    useResumeStore
      .getState()
      .updateSectionItem("summary-section", "summary-item", { text: "Hand edited" })

    useResumeStore.getState().revertEnhanceSuggestion(summarySuggestion.id)

    expect(summaryText()).toBe("Old summary")
  })

  it("applyEnhanceSuggestion no-ops when the item no longer exists", () => {
    useResumeStore.getState().removeSectionItem("exp-section", "exp-item")
    useResumeStore.setState({ isDirty: false })

    const result = useResumeStore.getState().applyEnhanceSuggestion(bulletSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "missing" })
    expect(useResumeStore.getState().isDirty).toBe(false)
    expect(suggestion(bulletSuggestion.id)?.status).toBe("pending")
  })

  it("applyEnhanceSuggestion no-ops when the bullet index is gone", () => {
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", { bullets: ["Only one bullet"] })
    useResumeStore.setState({ isDirty: false })

    useResumeStore.getState().applyEnhanceSuggestion(bulletSuggestion.id)

    expect(bullets()).toEqual(["Only one bullet"])
    expect(useResumeStore.getState().isDirty).toBe(false)
    expect(suggestion(bulletSuggestion.id)?.status).toBe("pending")
  })

  it("applyEnhanceSuggestion ignores unknown suggestion ids", () => {
    useResumeStore.setState({ isDirty: false })

    const result = useResumeStore.getState().applyEnhanceSuggestion("nope")

    expect(result).toEqual({ ok: false, reason: "missing" })
    expect(useResumeStore.getState().isDirty).toBe(false)
  })

  it("applyEnhanceSuggestion follows the bullet after an earlier one is deleted", () => {
    // The user drops bullet 0 while the suggestions are open, so the targeted
    // text slides from index 1 to index 0.
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", { bullets: ["Old bullet two"] })

    const result = useResumeStore.getState().applyEnhanceSuggestion(bulletSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(bullets()).toEqual(["New bullet two"])
    expect(suggestion(bulletSuggestion.id)?.status).toBe("applied")
  })

  it("applyEnhanceSuggestion refuses to overwrite a different bullet at the same index", () => {
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", {
        bullets: ["Old bullet one", "Something the user typed"],
      })
    useResumeStore.setState({ isDirty: false })

    const result = useResumeStore.getState().applyEnhanceSuggestion(bulletSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "stale" })
    expect(bullets()).toEqual(["Old bullet one", "Something the user typed"])
    expect(useResumeStore.getState().isDirty).toBe(false)
    expect(suggestion(bulletSuggestion.id)?.status).toBe("pending")
  })

  it("revertEnhanceSuggestion refuses to overwrite a hand-edited bullet", () => {
    useResumeStore.getState().applyEnhanceSuggestion(bulletSuggestion.id)
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", {
        bullets: ["Old bullet one", "Hand edited afterwards"],
      })

    const result = useResumeStore.getState().revertEnhanceSuggestion(bulletSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "stale" })
    expect(bullets()).toEqual(["Old bullet one", "Hand edited afterwards"])
  })

  it("applyEnhanceSuggestion matches a bullet that carries surrounding whitespace", () => {
    // Targets are built from the trimmed bullet, so `original` never carries
    // the padding the editor may have kept.
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", {
        bullets: ["Old bullet one", "  Old bullet two  "],
      })

    const result = useResumeStore.getState().applyEnhanceSuggestion(bulletSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(bullets()).toEqual(["Old bullet one", "New bullet two"])
  })

  it("applyEnhanceSuggestion reports stale for an over-cap bullet matching only its capped prefix", () => {
    // The target was capped at 2000 chars; replacing the whole bullet on a
    // prefix match would silently drop the tail.
    const longBullet = "x".repeat(2001)
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", { bullets: ["Old bullet one", longBullet] })
    useResumeStore.setState({
      enhanceSuggestions: [{ ...bulletSuggestion, original: longBullet.slice(0, 2000) }],
      isDirty: false,
    })

    const result = useResumeStore.getState().applyEnhanceSuggestion(bulletSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "stale" })
    expect(bullets()).toEqual(["Old bullet one", longBullet])
    expect(useResumeStore.getState().isDirty).toBe(false)
  })

  it("applyEnhanceSuggestion refuses to overwrite a hand-edited summary", () => {
    // e.g. a suggestion restored from localStorage after the summary changed.
    useResumeStore
      .getState()
      .updateSectionItem("summary-section", "summary-item", { text: "Newer hand-written summary" })
    useResumeStore.setState({ isDirty: false })

    const result = useResumeStore.getState().applyEnhanceSuggestion(summarySuggestion.id)

    expect(result).toEqual({ ok: false, reason: "stale" })
    expect(summaryText()).toBe("Newer hand-written summary")
    expect(useResumeStore.getState().isDirty).toBe(false)
    expect(suggestion(summarySuggestion.id)?.status).toBe("pending")
  })

  it("applyEnhanceSuggestion still applies a summary that only differs by whitespace", () => {
    useResumeStore
      .getState()
      .updateSectionItem("summary-section", "summary-item", { text: "  Old summary\n" })

    const result = useResumeStore.getState().applyEnhanceSuggestion(summarySuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(summaryText()).toBe("New summary")
  })

  it("clearEnhanceError drops only the error, keeping the suggestions", () => {
    useResumeStore.setState({ enhanceError: "boom" })

    useResumeStore.getState().clearEnhanceError()

    expect(useResumeStore.getState().enhanceError).toBeNull()
    expect(useResumeStore.getState().enhanceSuggestions).toHaveLength(2)
  })

  it("reconcileTempIds rewrites the suggestion itemId and the id-embedded segment", () => {
    useResumeStore.getState().setResume(
      makeResume({
        sections: [
          {
            ...makeSection("exp-section", 2, "EXPERIENCE"),
            items: [
              {
                id: "temp-123",
                sectionId: "exp-section",
                content: { bullets: ["Old bullet one", "Old bullet two"] },
                order: 0,
              },
            ],
          },
        ],
      })
    )
    useResumeStore.getState().setEnhanceSuggestions([
      { ...bulletSuggestion, id: "exp-section::temp-123::b1", itemId: "temp-123" },
    ])

    useResumeStore.getState().reconcileTempIds({ "temp-123": "cuid-abc" })

    const reconciled = useResumeStore.getState().enhanceSuggestions![0]
    expect(reconciled.itemId).toBe("cuid-abc")
    expect(reconciled.id).toBe("exp-section::cuid-abc::b1")

    // …and Apply still lands on the renamed item.
    expect(useResumeStore.getState().applyEnhanceSuggestion(reconciled.id)).toEqual({ ok: true })
    expect(
      (useResumeStore.getState().resume!.sections[0].items[0].content as { bullets: string[] })
        .bullets
    ).toEqual(["Old bullet one", "New bullet two"])
  })

  it("clearEnhanceSuggestions drops the list and the error", () => {
    useResumeStore.setState({ enhanceError: "boom" })

    useResumeStore.getState().clearEnhanceSuggestions()

    expect(useResumeStore.getState().enhanceSuggestions).toBeNull()
    expect(useResumeStore.getState().enhanceError).toBeNull()
  })

  it("setResume clears any pending enhance state", () => {
    useResumeStore.setState({ isEnhancing: true, enhanceError: "boom" })

    useResumeStore.getState().setResume(makeResume({ id: "resume-2" }))

    expect(useResumeStore.getState().enhanceSuggestions).toBeNull()
    expect(useResumeStore.getState().isEnhancing).toBe(false)
    expect(useResumeStore.getState().enhanceError).toBeNull()
  })
})

describe("useResumeStore - bullet removal suggestions", () => {
  const experienceSection: Section = {
    ...makeSection("exp-section", 1, "EXPERIENCE"),
    items: [
      {
        id: "exp-item",
        sectionId: "exp-section",
        content: {
          company: "Acme",
          bullets: ["Old bullet one", "Old bullet two", "Old bullet three"],
        },
        order: 0,
      },
    ],
  }

  const removalSuggestion: EnhanceSuggestion = {
    id: "exp-section::exp-item::b1",
    sectionId: "exp-section",
    itemId: "exp-item",
    field: "bullet",
    action: "remove",
    bulletIndex: 1,
    original: "Old bullet two",
    reason: "Unrelated to the target role",
    status: "pending",
  }

  const bullets = () =>
    (useResumeStore.getState().resume!.sections[0].items[0].content as { bullets?: string[] })
      .bullets
  const suggestion = () =>
    useResumeStore.getState().enhanceSuggestions?.find((s) => s.id === removalSuggestion.id)

  beforeEach(() => {
    useResumeStore
      .getState()
      .setResume(makeResume({ sections: [structuredClone(experienceSection)] }))
    useResumeStore.getState().setEnhanceSuggestions([{ ...removalSuggestion }])
  })

  it("applyEnhanceSuggestion splices out only the targeted bullet", () => {
    const result = useResumeStore.getState().applyEnhanceSuggestion(removalSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(bullets()).toEqual(["Old bullet one", "Old bullet three"])
    expect(suggestion()?.status).toBe("applied")
    expect(useResumeStore.getState().isDirty).toBe(true)
  })

  it("applyEnhanceSuggestion follows the bullet after an earlier one is deleted", () => {
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", {
        bullets: ["Old bullet two", "Old bullet three"],
      })

    const result = useResumeStore.getState().applyEnhanceSuggestion(removalSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(bullets()).toEqual(["Old bullet three"])
  })

  it("applyEnhanceSuggestion removes a bullet that carries surrounding whitespace", () => {
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", {
        bullets: ["Old bullet one", " Old bullet two\t", "Old bullet three"],
      })

    const result = useResumeStore.getState().applyEnhanceSuggestion(removalSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(bullets()).toEqual(["Old bullet one", "Old bullet three"])
  })

  it("applyEnhanceSuggestion reports stale instead of deleting a hand-edited bullet", () => {
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", {
        bullets: ["Old bullet one", "Something the user typed", "Old bullet three"],
      })
    useResumeStore.setState({ isDirty: false })

    const result = useResumeStore.getState().applyEnhanceSuggestion(removalSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "stale" })
    expect(bullets()).toEqual([
      "Old bullet one",
      "Something the user typed",
      "Old bullet three",
    ])
    expect(useResumeStore.getState().isDirty).toBe(false)
    expect(suggestion()?.status).toBe("pending")
  })

  it("applyEnhanceSuggestion reports missing when the item is gone", () => {
    useResumeStore.getState().removeSectionItem("exp-section", "exp-item")

    const result = useResumeStore.getState().applyEnhanceSuggestion(removalSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "missing" })
  })

  it("revertEnhanceSuggestion re-inserts the bullet at its original index", () => {
    useResumeStore.getState().applyEnhanceSuggestion(removalSuggestion.id)

    const result = useResumeStore.getState().revertEnhanceSuggestion(removalSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(bullets()).toEqual(["Old bullet one", "Old bullet two", "Old bullet three"])
    expect(suggestion()?.status).toBe("pending")
  })

  it("revertEnhanceSuggestion clamps the index when the list has since shrunk", () => {
    useResumeStore.getState().applyEnhanceSuggestion(removalSuggestion.id)
    useResumeStore.getState().updateSectionItem("exp-section", "exp-item", { bullets: [] })

    const result = useResumeStore.getState().revertEnhanceSuggestion(removalSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(bullets()).toEqual(["Old bullet two"])
  })

  it("revertEnhanceSuggestion appends when the removal carried no index", () => {
    useResumeStore
      .getState()
      .setEnhanceSuggestions([
        { ...removalSuggestion, bulletIndex: undefined, status: "applied" },
      ])
    useResumeStore
      .getState()
      .updateSectionItem("exp-section", "exp-item", {
        bullets: ["Old bullet one", "Old bullet three"],
      })

    const result = useResumeStore.getState().revertEnhanceSuggestion(removalSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(bullets()).toEqual(["Old bullet one", "Old bullet three", "Old bullet two"])
  })

  it("refuses a removal aimed at a non-bullet field", () => {
    // Defence in depth — the action already rejects these server-side.
    useResumeStore
      .getState()
      .setEnhanceSuggestions([{ ...removalSuggestion, field: "summary" }])

    const result = useResumeStore.getState().applyEnhanceSuggestion(removalSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "stale" })
    expect(bullets()).toEqual(["Old bullet one", "Old bullet two", "Old bullet three"])
  })
})

describe("useResumeStore - skills enhance suggestions", () => {
  const skillsSection: Section = {
    ...makeSection("skills-section", 1, "SKILLS"),
    items: [
      {
        id: "skills-item",
        sectionId: "skills-section",
        content: { category: "Languages", skills: ["TypeScript", "Go"] },
        order: 0,
      },
    ],
  }

  const skillsSuggestion: EnhanceSuggestion = {
    id: "skills-section::skills-item::skills",
    sectionId: "skills-section",
    itemId: "skills-item",
    field: "skills",
    action: "rewrite",
    original: "TypeScript, Go",
    suggested: "TypeScript, Go, Rust",
    reason: "Adds the missing Rust keyword",
    status: "pending",
  }

  const content = () =>
    useResumeStore.getState().resume!.sections[0].items[0].content as {
      category?: string
      skills?: string[]
    }
  const suggestion = () =>
    useResumeStore.getState().enhanceSuggestions?.find((s) => s.id === skillsSuggestion.id)

  beforeEach(() => {
    useResumeStore
      .getState()
      .setResume(makeResume({ sections: [structuredClone(skillsSection)] }))
    useResumeStore.getState().setEnhanceSuggestions([{ ...skillsSuggestion }])
  })

  it("applyEnhanceSuggestion splits the list back into skills and keeps the category", () => {
    const result = useResumeStore.getState().applyEnhanceSuggestion(skillsSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(content()).toEqual({ category: "Languages", skills: ["TypeScript", "Go", "Rust"] })
    expect(suggestion()?.status).toBe("applied")
    expect(useResumeStore.getState().isDirty).toBe(true)
  })

  it("trims, drops empties and de-duplicates case-insensitively", () => {
    useResumeStore.getState().setEnhanceSuggestions([
      {
        ...skillsSuggestion,
        suggested: " TypeScript ,, Go,  rust , RUST ,   , Docker",
      },
    ])

    useResumeStore.getState().applyEnhanceSuggestion(skillsSuggestion.id)

    expect(content().skills).toEqual(["TypeScript", "Go", "rust", "Docker"])
  })

  it("revertEnhanceSuggestion puts the original list back", () => {
    useResumeStore.getState().applyEnhanceSuggestion(skillsSuggestion.id)
    const result = useResumeStore.getState().revertEnhanceSuggestion(skillsSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(content()).toEqual({ category: "Languages", skills: ["TypeScript", "Go"] })
    expect(suggestion()?.status).toBe("pending")
  })

  it("reverts even when the model's list needed normalising on the way in", () => {
    useResumeStore
      .getState()
      .setEnhanceSuggestions([
        { ...skillsSuggestion, suggested: "TypeScript,  Go , Rust, rust" },
      ])

    useResumeStore.getState().applyEnhanceSuggestion(skillsSuggestion.id)
    expect(content().skills).toEqual(["TypeScript", "Go", "Rust"])

    const result = useResumeStore.getState().revertEnhanceSuggestion(skillsSuggestion.id)

    expect(result).toEqual({ ok: true })
    expect(content().skills).toEqual(["TypeScript", "Go"])
  })

  it("applyEnhanceSuggestion refuses to overwrite a hand-edited skills list", () => {
    useResumeStore
      .getState()
      .updateSectionItem("skills-section", "skills-item", {
        category: "Languages",
        skills: ["TypeScript", "Python"],
      })
    useResumeStore.setState({ isDirty: false })

    const result = useResumeStore.getState().applyEnhanceSuggestion(skillsSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "stale" })
    expect(content().skills).toEqual(["TypeScript", "Python"])
    expect(useResumeStore.getState().isDirty).toBe(false)
    expect(suggestion()?.status).toBe("pending")
  })

  it("revertEnhanceSuggestion refuses to overwrite a hand-edited skills list", () => {
    useResumeStore.getState().applyEnhanceSuggestion(skillsSuggestion.id)
    useResumeStore
      .getState()
      .updateSectionItem("skills-section", "skills-item", {
        category: "Languages",
        skills: ["TypeScript", "Go", "Rust", "Kotlin"],
      })

    const result = useResumeStore.getState().revertEnhanceSuggestion(skillsSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "stale" })
    expect(content().skills).toEqual(["TypeScript", "Go", "Rust", "Kotlin"])
  })

  it("applyEnhanceSuggestion no-ops when the skills item is gone", () => {
    useResumeStore.getState().removeSectionItem("skills-section", "skills-item")
    useResumeStore.setState({ isDirty: false })

    const result = useResumeStore.getState().applyEnhanceSuggestion(skillsSuggestion.id)

    expect(result).toEqual({ ok: false, reason: "missing" })
    expect(useResumeStore.getState().isDirty).toBe(false)
  })
})

describe("useResumeStore - setResume seeds ATS staleness", () => {
  it("opens with the analysis outdated when the server says so", () => {
    useResumeStore
      .getState()
      .setResume(makeResume({ latestAnalysis: mockAnalysis, latestAnalysisOutdated: true }))
    expect(useResumeStore.getState().atsStale).toBe(true)
  })

  it("opens current when the server does not flag it", () => {
    useResumeStore.setState({ atsStale: true })
    useResumeStore.getState().setResume(makeResume({ latestAnalysis: mockAnalysis }))
    expect(useResumeStore.getState().atsStale).toBe(false)
  })

  it("ignores the flag when there is no analysis to be outdated", () => {
    useResumeStore.getState().setResume(makeResume({ latestAnalysisOutdated: true }))
    expect(useResumeStore.getState().atsStale).toBe(false)
  })
})

describe("useResumeStore - Enhance persistence", () => {
  const experience = (itemId = "exp-item"): Section => ({
    ...makeSection("exp-section", 1, "EXPERIENCE"),
    items: [
      {
        id: itemId,
        sectionId: "exp-section",
        content: { bullets: ["Old bullet one", "Old bullet two"] },
        order: 0,
      },
    ],
  })

  const rewrite = (itemId = "exp-item"): EnhanceSuggestion => ({
    id: `exp-section::${itemId}::b1`,
    sectionId: "exp-section",
    itemId,
    field: "bullet",
    action: "rewrite",
    bulletIndex: 1,
    original: "Old bullet two",
    suggested: "New bullet two",
    reason: "Quantifies the impact",
    status: "pending",
  })

  const removal = (itemId = "exp-item"): EnhanceSuggestion => ({
    id: `exp-section::${itemId}::b0`,
    sectionId: "exp-section",
    itemId,
    field: "bullet",
    action: "remove",
    bulletIndex: 0,
    original: "Old bullet one",
    reason: "Duplicates another bullet",
    status: "pending",
  })

  const stored = (resumeId = "resume-1") => {
    const raw = window.localStorage.getItem(enhanceStateKey(resumeId))
    return raw ? (JSON.parse(raw) as { v: number; suggestions: EnhanceSuggestion[] }) : null
  }
  const bullets = () =>
    (useResumeStore.getState().resume!.sections[0].items[0].content as { bullets: string[] })
      .bullets

  beforeEach(() => {
    window.localStorage.clear()
    useResumeStore.setState({
      resume: null,
      enhanceSuggestions: null,
      enhanceGrounding: [],
      enhanceFocus: null,
      enhanceError: null,
    })
  })

  it("opens with no suggestions when nothing is stored", () => {
    useResumeStore.getState().setResume(makeResume({ sections: [experience()] }))

    expect(useResumeStore.getState().enhanceSuggestions).toBeNull()
    expect(stored()).toBeNull()
  })

  it("writes the list on apply, with the applied row and its original", () => {
    useResumeStore.getState().setResume(makeResume({ sections: [experience()] }))
    useResumeStore.getState().setEnhanceSuggestions([rewrite(), removal()])
    useResumeStore.getState().applyEnhanceSuggestion(rewrite().id)

    const saved = stored()!
    expect(saved.v).toBe(1)
    expect(saved.suggestions).toHaveLength(2)
    const applied = saved.suggestions.find((s) => s.id === rewrite().id)!
    expect(applied.status).toBe("applied")
    expect(applied.original).toBe("Old bullet two")
  })

  it("restores the list on a fresh load, and Revert still restores the original", () => {
    useResumeStore.getState().setResume(makeResume({ sections: [experience()] }))
    useResumeStore.getState().setEnhanceSuggestions([rewrite(), removal()])
    useResumeStore.getState().setEnhanceGrounding([
      { keyword: "Kubernetes", verdict: "unsupported", reason: "Not in the resume" },
    ])
    useResumeStore.getState().setEnhanceFocus({ sectionId: "exp-section" })
    useResumeStore.getState().applyEnhanceSuggestion(rewrite().id)

    // A reload: the server returns the autosaved content, the store starts over.
    useResumeStore.setState({ resume: null, enhanceSuggestions: null })
    useResumeStore.getState().setResume(
      makeResume({
        sections: [
          {
            ...experience(),
            items: [
              { ...experience().items[0], content: { bullets: ["Old bullet one", "New bullet two"] } },
            ],
          },
        ],
      })
    )

    const state = useResumeStore.getState()
    expect(state.enhanceSuggestions).toHaveLength(2)
    expect(state.enhanceSuggestions!.find((s) => s.id === rewrite().id)!.status).toBe("applied")
    expect(state.enhanceGrounding).toEqual([
      { keyword: "Kubernetes", verdict: "unsupported", reason: "Not in the resume" },
    ])
    expect(state.enhanceFocus).toEqual({ sectionId: "exp-section" })

    expect(useResumeStore.getState().revertEnhanceSuggestion(rewrite().id)).toEqual({ ok: true })
    expect(bullets()).toEqual(["Old bullet one", "Old bullet two"])
    expect(stored()!.suggestions.find((s) => s.id === rewrite().id)!.status).toBe("pending")
  })

  it("gives a different resume its own state and leaves the first resume's key alone", () => {
    useResumeStore.getState().setResume(makeResume({ sections: [experience()] }))
    useResumeStore.getState().setEnhanceSuggestions([rewrite()])
    const before = window.localStorage.getItem(enhanceStateKey("resume-1"))

    useResumeStore.getState().setResume(makeResume({ id: "resume-2", sections: [experience()] }))

    expect(useResumeStore.getState().enhanceSuggestions).toBeNull()
    expect(window.localStorage.getItem(enhanceStateKey("resume-1"))).toBe(before)
    expect(stored("resume-2")).toBeNull()
  })

  it("drops rows whose item no longer exists", () => {
    saveEnhanceState("resume-1", {
      suggestions: [rewrite(), rewrite("gone-item")],
      grounding: [],
      focus: null,
    })

    useResumeStore.getState().setResume(makeResume({ sections: [experience()] }))

    expect(useResumeStore.getState().enhanceSuggestions!.map((s) => s.itemId)).toEqual([
      "exp-item",
    ])
    expect(stored()!.suggestions).toHaveLength(1)
  })

  it("clears the key when every row's target is gone", () => {
    saveEnhanceState("resume-1", {
      suggestions: [rewrite("gone-item")],
      grounding: [],
      focus: null,
    })

    useResumeStore.getState().setResume(makeResume({ sections: [experience()] }))

    expect(useResumeStore.getState().enhanceSuggestions).toBeNull()
    expect(stored()).toBeNull()
  })

  it("opens with no suggestions when the stored value is malformed", () => {
    window.localStorage.setItem(enhanceStateKey("resume-1"), "{not json")

    expect(() =>
      useResumeStore.getState().setResume(makeResume({ sections: [experience()] }))
    ).not.toThrow()
    expect(useResumeStore.getState().enhanceSuggestions).toBeNull()
  })

  it("persists the ids reconcileTempIds rewrites", () => {
    useResumeStore.getState().setResume(makeResume({ sections: [experience("temp-123")] }))
    useResumeStore.getState().setEnhanceSuggestions([rewrite("temp-123")])

    useResumeStore.getState().reconcileTempIds({ "temp-123": "cuid-abc" })

    const saved = stored()!.suggestions[0]
    expect(saved.itemId).toBe("cuid-abc")
    expect(saved.id).toBe("exp-section::cuid-abc::b1")
  })

  it("clears the key when the list is cleared", () => {
    useResumeStore.getState().setResume(makeResume({ sections: [experience()] }))
    useResumeStore.getState().setEnhanceSuggestions([rewrite()])

    useResumeStore.getState().clearEnhanceSuggestions()

    expect(stored()).toBeNull()
  })
})
