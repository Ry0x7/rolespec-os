import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { mockReorderResumeSections, mockAddResumeSection, mockRemoveResumeSection } = vi.hoisted(
  () => ({
    mockReorderResumeSections: vi.fn(),
    mockAddResumeSection: vi.fn(),
    mockRemoveResumeSection: vi.fn(),
  })
)

// The session does not resolve under vitest.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, update: vi.fn() }),
}))

vi.mock("../../actions/sections", () => ({
  reorderResumeSections: mockReorderResumeSections,
  addResumeSection: mockAddResumeSection,
  removeResumeSection: mockRemoveResumeSection,
}))

import { SectionPanel } from "../section-panel"
import { useResumeStore, type ResumeData, type Section } from "../../hooks/use-resume-store"

function section(id: string, type: Section["type"], title: string, order: number): Section {
  return { id, resumeId: "r1", type, title, order, visible: true, items: [] }
}

function makeResume(): ResumeData {
  return {
    id: "r1",
    title: "Test",
    targetRole: null,
    targetCompany: null,
    template: "MINIMAL",
    atsScore: null,
    jobDescription: null,
    latestAnalysis: null,
    sections: [
      section("s-contact", "CONTACT", "Contact", 0),
      section("s-summary", "SUMMARY", "Summary", 1),
      section("s-exp", "EXPERIENCE", "Experience", 2),
      section("s-skills", "SKILLS", "Skills", 3),
    ],
  }
}

const sectionIds = () => useResumeStore.getState().resume!.sections.map((s) => s.id)
const button = (label: string) => screen.getByLabelText(label) as HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
  mockReorderResumeSections.mockResolvedValue({})
  useResumeStore.getState().setResume(makeResume())
})

afterEach(() => {
  cleanup()
})

describe("SectionPanel move buttons", () => {
  it("moves a section down and persists the new order", async () => {
    render(<SectionPanel />)

    fireEvent.click(button("Move Summary section down"))

    expect(sectionIds()).toEqual(["s-contact", "s-exp", "s-summary", "s-skills"])
    await waitFor(() => {
      expect(mockReorderResumeSections).toHaveBeenCalledWith("r1", [
        "s-contact",
        "s-exp",
        "s-summary",
        "s-skills",
      ])
    })
  })

  it("moves a section up and persists the new order", async () => {
    render(<SectionPanel />)

    fireEvent.click(button("Move Skills section up"))

    expect(sectionIds()).toEqual(["s-contact", "s-summary", "s-skills", "s-exp"])
    await waitFor(() => {
      expect(mockReorderResumeSections).toHaveBeenCalledWith("r1", [
        "s-contact",
        "s-summary",
        "s-skills",
        "s-exp",
      ])
    })
  })

  it("re-renders the panel in the new order after a move", async () => {
    render(<SectionPanel />)

    fireEvent.click(button("Move Summary section down"))

    await waitFor(() => {
      const titles = screen
        .getAllByLabelText(/^Move .+ section up$/)
        .map((el) => el.getAttribute("aria-label"))
      expect(titles).toEqual([
        "Move Experience section up",
        "Move Summary section up",
        "Move Skills section up",
      ])
    })
  })

  it("disables move up on the first draggable section and move down on the last", () => {
    render(<SectionPanel />)

    expect(button("Move Summary section up").disabled).toBe(true)
    expect(button("Move Summary section down").disabled).toBe(false)
    expect(button("Move Skills section down").disabled).toBe(true)
    expect(button("Move Skills section up").disabled).toBe(false)
  })

  it("does not render move controls for the contact section", () => {
    render(<SectionPanel />)

    expect(screen.queryByLabelText("Move Contact section up")).toBeNull()
    expect(screen.queryByLabelText("Move Contact section down")).toBeNull()
  })
})

/**
 * With one Experience section open the left pane's scrollHeight is ~2110px
 * against a ~779px viewport, and at that depth every section header — the open
 * one's included — was off-screen, so there was no way to see where you were or
 * to collapse back to the section list without blind scrolling. The header row
 * now sticks to the top of the pane's scroll container while its own section is
 * in view.
 *
 * jsdom computes no layout, so these assert the RULES that make it work rather
 * than a measured position.
 */
describe("SectionPanel sticky section headers", () => {
  const headerRow = (sectionId: string) =>
    document.getElementById(`resume-section-${sectionId}`)!.firstElementChild!

  it("pins every section's header row to the top of the pane, only at xl", () => {
    render(<SectionPanel />)

    for (const id of ["s-contact", "s-summary", "s-exp", "s-skills"]) {
      const cls = headerRow(id).className
      expect(cls).toContain("xl:sticky")
      expect(cls).toContain("xl:top-0")
      // Below `xl` the pane is not a scroll container — the document is, so an
      // ungated rule pinned the row at viewport y=0 inside the app header and
      // ghosted through its translucent background.
      expect(cls).not.toMatch(/(^|\s)sticky(\s|$)/)
      expect(cls).not.toMatch(/(^|\s)top-0(\s|$)/)
    }
  })

  it("keeps the header below the editor toolbar's stacking tier", () => {
    render(<SectionPanel />)

    for (const id of ["s-contact", "s-exp"]) {
      const cls = headerRow(id).className
      expect(cls).toContain("z-10")
      // `--z-sticky` (30) belongs to the editor toolbar; this row must scroll
      // UNDER it, so it must never claim that tier.
      expect(cls).not.toContain("--z-sticky")
    }
  })

  it("gives the pinned header an opaque background", () => {
    render(<SectionPanel />)

    // A translucent row would let the form content scroll through it. Each row
    // states the background of the container it actually sits on.
    expect(headerRow("s-contact").className).toContain("bg-background")
    expect(headerRow("s-exp").className).toContain("bg-card")

    // The hover tint REPLACES that base colour, so it has to be opaque too —
    // at `bg-muted/50` the form content showed straight through a pinned row.
    for (const id of ["s-contact", "s-exp"]) {
      const cls = headerRow(id).className
      expect(cls).toContain("hover:bg-muted")
      expect(cls).not.toContain("hover:bg-muted/50")
    }
  })

  /**
   * `position: sticky` resolves against the nearest scrolling ancestor, and an
   * intermediate `overflow: hidden/auto/scroll` would become that ancestor and
   * silently turn the rule into a no-op. The pane itself is the only scroller.
   */
  it("has no overflow-clipping ancestor between a header row and the panel root", () => {
    const { container } = render(<SectionPanel />)

    const clippers: string[] = []
    for (let el = headerRow("s-exp").parentElement; el && el !== container; el = el.parentElement) {
      const cls = el.className
      if (typeof cls === "string" && /\boverflow-(x-|y-)?(auto|hidden|scroll)\b/.test(cls)) {
        clippers.push(cls)
      }
    }

    expect(clippers).toEqual([])
  })
})
