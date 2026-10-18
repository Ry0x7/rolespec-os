import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"

vi.mock("../../actions", () => ({ updateResume: vi.fn() }))

import { ResumePreview } from "../resume-preview"
import { useResumeStore, type ResumeData, type Section } from "../../hooks/use-resume-store"
import { DEFAULT_CUSTOMIZATION, customizationStorageKey } from "../../types/customization"

const SECTION_HEIGHT = 300

function section(id: string, type: string, items: Section["items"]): Section {
  return {
    id,
    resumeId: "r1",
    type: type as Section["type"],
    title: type,
    order: 0,
    visible: true,
    items,
  }
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
      section("s-contact", "CONTACT", [
        { id: "i1", sectionId: "s-contact", content: { fullName: "Ada Lovelace", email: "ada@example.com" }, order: 0 },
      ]),
      section("s-summary", "SUMMARY", [
        { id: "i2", sectionId: "s-summary", content: { text: "Engineer." }, order: 0 },
      ]),
      section("s-skills", "SKILLS", [
        { id: "i3", sectionId: "s-skills", content: { category: "Core", skills: ["TypeScript"] }, order: 0 },
      ]),
    ],
  }
}

let originalRO: typeof ResizeObserver | undefined
let originalRect: () => DOMRect

beforeEach(() => {
  originalRO = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver

  // jsdom has no layout: give every measured node a fixed height and the
  // container a realistic width so pagination math is exercised.
  originalRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    return { height: SECTION_HEIGHT, width: 595, top: 0, left: 0, right: 595, bottom: SECTION_HEIGHT, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 595 })

  window.localStorage.clear()
  useResumeStore.setState({
    resume: null,
    groupAdditional: false,
    customization: { ...DEFAULT_CUSTOMIZATION },
  })
})

afterEach(() => {
  cleanup()
  Element.prototype.getBoundingClientRect = originalRect
  if (originalRO) globalThis.ResizeObserver = originalRO
  useResumeStore.setState({ resume: null })
})

describe("ResumePreview first-open measurement", () => {
  it("measures and paginates after the store hydrates post-mount", () => {
    // Mounts with an empty store, exactly like the editor's parent effect order.
    const { container } = render(<ResumePreview />)
    expect(container.innerHTML).toBe("")

    act(() => {
      useResumeStore.getState().setResume(makeResume())
    })

    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0)

    // A4 is 841.89px tall (react-pdf's own page height) minus 64px padding =>
    // ~778px usable, so
    // three 300px sections must split across two pages. Without measurement the
    // component falls back to a single page.
    expect(screen.getByText("2 pages")).toBeTruthy()
    expect(screen.getByLabelText("Page 2")).toBeTruthy()
  })

  // react-pdf never clones a section heading onto the page it splits onto, so
  // neither does the preview — it used to repeat it with a "(cont.)" marker and
  // charge its height, spending a page the export did not.
  it("does not repeat a section heading on continuation pages", () => {
    const resume = makeResume()
    resume.sections = [
      resume.sections[0],
      section(
        "s-exp",
        "EXPERIENCE",
        Array.from({ length: 4 }, (_, i) => ({
          id: `e${i}`,
          sectionId: "s-exp",
          content: { role: `Engineer ${i}`, company: "Analytical Engines" },
          order: i,
        }))
      ),
    ]

    useResumeStore.setState({ resume })
    render(<ResumePreview />)

    // The section splits (every measured node is 300px tall).
    expect(screen.getByLabelText("Page 2")).toBeTruthy()
    expect(screen.queryByText("(cont.)")).toBeNull()
    // Once in the measurement mirror, once on the page the section starts on.
    expect(screen.getAllByText("Experience")).toHaveLength(2)
  })

  it("keeps measured heights after toggling compact spacing", () => {
    useResumeStore.setState({ resume: makeResume() })
    render(<ResumePreview />)
    expect(screen.getByText("2 pages")).toBeTruthy()

    act(() => {
      screen.getByRole("button", { name: "Switch to compact spacing" }).click()
    })

    // Heights are re-measured synchronously; previously they were wiped, which
    // dropped the layout back to the unpaginated single-page fallback.
    expect(screen.getByText("2 pages")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Switch to spacious spacing" })).toBeTruthy()
  })

  it("persists the density toggle to the store and localStorage", () => {
    useResumeStore.setState({ resume: makeResume() })
    render(<ResumePreview />)

    act(() => {
      screen.getByRole("button", { name: "Switch to compact spacing" }).click()
    })

    expect(useResumeStore.getState().customization.density).toBe("compact")
    expect(window.localStorage.getItem(customizationStorageKey("r1"))).toContain("compact")
  })

  it("applies customization to both the measurement mirror and the painted page", () => {
    useResumeStore.setState({
      resume: makeResume(),
      customization: { ...DEFAULT_CUSTOMIZATION, accent: "#166534", fontScale: 1.1 },
    })
    const { container } = render(<ResumePreview />)

    const shells = Array.from(container.querySelectorAll<HTMLElement>(".bg-white"))
    expect(shells.length).toBeGreaterThan(1)
    for (const shell of shells) {
      expect(shell.style.getPropertyValue("--resume-heading")).toBe("#166534")
    }

    // Body size = 11px base * 1.1 on the mirror and on every page.
    const inners = shells
      .map((shell) => shell.querySelector<HTMLElement>(":scope > .flex.flex-col"))
      .filter((node): node is HTMLElement => node !== null)
    expect(inners.length).toBe(shells.length)
    for (const inner of inners) {
      expect(inner.style.fontSize).toBe("12.1px")
    }
  })

  it("opens the customizer panel from the toolbar", () => {
    useResumeStore.setState({ resume: makeResume() })
    render(<ResumePreview />)

    act(() => {
      screen.getByRole("button", { name: "Customize appearance" }).click()
    })

    const panel = screen.getByRole("dialog", { name: "Resume appearance settings" })
    expect(panel).toBeTruthy()

    act(() => {
      screen.getByRole("button", { name: "Text size: L" }).click()
    })
    expect(useResumeStore.getState().customization.fontScale).toBe(1.1)

    act(() => {
      screen.getByRole("button", { name: "Reset to defaults" }).click()
    })
    expect(useResumeStore.getState().customization).toEqual(DEFAULT_CUSTOMIZATION)
  })

  it("renders detailed certifications on their own rows when no Skills section is visible", () => {
    const resume = makeResume()
    resume.sections = [
      resume.sections[0],
      section("s-certs", "CERTIFICATIONS", [
        { id: "c1", sectionId: "s-certs", content: { name: "SAA", organization: "AWS", dateObtained: "Aug 2024" }, order: 0 },
        { id: "c2", sectionId: "s-certs", content: { name: "SAP", organization: "AWS", dateObtained: "2020", credentialId: "X-9" }, order: 1 },
      ]),
    ]

    useResumeStore.setState({ resume, groupAdditional: true })
    render(<ResumePreview />)

    // Dated certs keep their own line and their own date instead of collapsing
    // into "AWS: SAA, SAP — 2020 – Aug 2024".
    expect(screen.getAllByText("SAA").length).toBeGreaterThan(0)
    expect(screen.getAllByText("SAP").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Aug 2024").length).toBeGreaterThan(0)
    expect(screen.getAllByText("2020").length).toBeGreaterThan(0)
    expect(screen.queryByText(/SAA, SAP/)).toBeNull()
    expect(screen.queryByText("2020 – Aug 2024")).toBeNull()
  })

  it("still merges bare certifications sharing an organization", () => {
    const resume = makeResume()
    resume.sections = [
      resume.sections[0],
      section("s-certs", "CERTIFICATIONS", [
        { id: "c1", sectionId: "s-certs", content: { name: "SAA", organization: "AWS" }, order: 0 },
        { id: "c2", sectionId: "s-certs", content: { name: "SAP", organization: "AWS" }, order: 1 },
      ]),
    ]

    useResumeStore.setState({ resume, groupAdditional: true })
    render(<ResumePreview />)

    expect(screen.getAllByText(/SAA, SAP/).length).toBeGreaterThan(0)
  })

  it("renders an expiration-only certification date", () => {
    const resume = makeResume()
    resume.sections = [
      resume.sections[0],
      section("s-certs", "CERTIFICATIONS", [
        { id: "c1", sectionId: "s-certs", content: { name: "SAA", organization: "AWS", expirationDate: "2030-01" }, order: 0 },
      ]),
    ]

    useResumeStore.setState({ resume, groupAdditional: false })
    render(<ResumePreview />)

    expect(screen.getAllByText("Expires Jan 2030").length).toBeGreaterThan(0)
  })

  it("renders contact email and phone as mailto/tel links and location as plain text", () => {
    const resume = makeResume()
    resume.sections[0].items[0].content = {
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+1 (555) 010-2030",
      location: "London, UK",
    }

    useResumeStore.setState({ resume })
    render(<ResumePreview />)

    const emailLinks = screen.getAllByText("ada@example.com")
    expect(emailLinks[0].tagName).toBe("A")
    expect(emailLinks[0].getAttribute("href")).toBe("mailto:ada@example.com")

    const phoneLinks = screen.getAllByText("+1 (555) 010-2030")
    expect(phoneLinks[0].tagName).toBe("A")
    expect(phoneLinks[0].getAttribute("href")).toBe("tel:+15550102030")

    const locations = screen.getAllByText("London, UK")
    expect(locations[0].tagName).toBe("SPAN")
  })
})

/**
 * 100% is A4 at 72dpi (595.28px) — only ~75% of physical A4 — so the fixed
 * presets go above 1, and at any of them the page is wider than the pane. The
 * painted stack is `transform: scale`d, which never changes a layout box, so
 * the scroll container can only see the overflow if a wrapper carries the
 * scaled dimensions. jsdom computes no layout: these assert that contract
 * (classes + inline sizes), not a measured scroll position — the reachability
 * of both page edges was verified in a browser.
 */
describe("ResumePreview zoom and horizontal scrolling", () => {
  const scrollBox = () => document.querySelector<HTMLElement>("[data-preview-scroll]")!
  const sizingWrapper = () => scrollBox().lastElementChild as HTMLElement

  it("offers the fixed presets above 100%", () => {
    useResumeStore.setState({ resume: makeResume() })
    render(<ResumePreview />)

    expect(screen.getByRole("button", { name: "Fit page width to the pane" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Fit a whole page" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Actual size" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Zoom to 125%" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Zoom to 150%" })).toBeTruthy()
  })

  it("scrolls the page horizontally instead of clipping it", () => {
    useResumeStore.setState({ resume: makeResume() })
    render(<ResumePreview />)

    // The pane/sheet outside keeps the vertical axis; this box owns the
    // horizontal one, which no ancestor of the mobile sheet provided.
    expect(scrollBox().className).toContain("overflow-x-auto")
  })

  it("sizes the wrapper to the scaled page at each preset", () => {
    useResumeStore.setState({ resume: makeResume() })
    render(<ResumePreview />)

    // offsetWidth is stubbed to 595, so fit-width lands just under the A4 box
    // and the page still fits: centred, no rounding up.
    expect(scrollBox().className).toContain("justify-center")

    for (const [name, expected] of [
      ["Actual size", 596],
      ["Zoom to 125%", Math.ceil(595.28 * 1.25)],
      ["Zoom to 150%", Math.ceil(595.28 * 1.5)],
    ] as const) {
      act(() => {
        screen.getByRole("button", { name }).click()
      })

      // Centring an overflowing flex item puts its start edge at a negative
      // offset no scroll position can reach — that is how the left half of the
      // page became unreachable in the mobile sheet.
      expect(scrollBox().className).toContain("justify-start")
      expect(sizingWrapper().style.width).toBe(`${expected}px`)
      expect(sizingWrapper().className).toContain("shrink-0")
    }
  })

  it("keeps the page count identical across zoom presets", () => {
    useResumeStore.setState({ resume: makeResume() })
    render(<ResumePreview />)
    expect(screen.getByText("2 pages")).toBeTruthy()

    // Zoom must never reach the measurement mirror or `paginateSections`.
    for (const name of ["Zoom to 150%", "Fit a whole page", "Actual size"] as const) {
      act(() => {
        screen.getByRole("button", { name }).click()
      })
      expect(screen.getByText("2 pages")).toBeTruthy()
    }
  })
})

describe("ResumePreview sticky toolbar stacking", () => {
  /**
   * Regression: the preview's sticky bar was given the app-level `--z-sticky`
   * tier, which made it a PEER of the editor toolbar (both resolved to 30).
   * Equal z means DOM order decides, and this bar sits later in the tree, so it
   * painted over the toolbar's open Export menu. The menu's own z-60 could not
   * help — it is scoped inside the toolbar's stacking context and can never
   * outrank a sibling one.
   *
   * jsdom computes neither layout nor paint order, so this asserts the RULE
   * that prevents it: subordinate in-pane chrome must not claim the app-level
   * sticky tier. It only has to outrank the painted pages, which are z-auto.
   */
  it("does not put the in-pane toolbar on the app-level sticky tier", () => {
    useResumeStore.setState({ resume: makeResume() })
    const { container } = render(<ResumePreview />)

    const stickyBar = container.querySelector(".sticky")
    expect(stickyBar).not.toBeNull()

    const cls = stickyBar!.className
    expect(cls).toContain("z-10")
    expect(cls).not.toContain("--z-sticky")
  })
})
