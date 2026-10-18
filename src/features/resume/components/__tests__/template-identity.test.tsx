import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"

vi.mock("../../actions", () => ({ updateResume: vi.fn() }))

import { ResumePreview } from "../resume-preview"
import { useResumeStore, type ResumeData, type Section } from "../../hooks/use-resume-store"
import { DEFAULT_CUSTOMIZATION } from "../../types/customization"

function section(id: string, type: string, items: Section["items"]): Section {
  return { id, resumeId: "r1", type: type as Section["type"], title: type, order: 0, visible: true, items }
}

function makeResume(template: string): ResumeData {
  return {
    id: "r1",
    title: "Test",
    targetRole: null,
    targetCompany: null,
    template,
    atsScore: null,
    jobDescription: null,
    latestAnalysis: null,
    sections: [
      section("s-contact", "CONTACT", [
        {
          id: "i1",
          sectionId: "s-contact",
          content: { fullName: "Ada Lovelace", email: "ada@example.com", github: "github.com/ada" },
          order: 0,
        },
      ]),
      section("s-exp", "EXPERIENCE", [
        {
          id: "i2",
          sectionId: "s-exp",
          content: {
            role: "Engineer",
            company: "Analytical Engines",
            location: "London",
            startDate: "2020",
            endDate: "2024",
            bullets: ["Shipped the first program"],
          },
          order: 0,
        },
      ]),
      section("s-skills", "SKILLS", [
        { id: "i3", sectionId: "s-skills", content: { category: "Core", skills: ["TypeScript", "Rust"] }, order: 0 },
      ]),
    ],
  }
}

let originalRO: typeof ResizeObserver | undefined
let originalRect: () => DOMRect

// Small enough that the whole resume fits on one page: the mirror plus exactly
// one painted page, which is what the mirror-parity assertion compares.
const NODE_HEIGHT = 40

beforeEach(() => {
  originalRO = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver

  // jsdom has no layout; give every measured node a height and the container a
  // realistic width so the pagination pass actually runs.
  originalRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    return {
      height: NODE_HEIGHT,
      width: 595,
      top: 0,
      left: 0,
      right: 595,
      bottom: NODE_HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
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

function renderTemplate(template: string) {
  useResumeStore.setState({ resume: makeResume(template) })
  return render(<ResumePreview />).container
}

describe("template visual identities (preview)", () => {
  it("MINIMAL keeps a quiet left-aligned block with a comma-separated skill line", () => {
    const c = renderTemplate("MINIMAL")

    expect(c.querySelector('[data-contact-layout="left"]')).toBeTruthy()
    expect(c.querySelector('[data-contact-layout="left"]')!.className).toContain("text-left")
    expect(c.querySelector("[data-skill-pill]")).toBeNull()
    expect(c.querySelector("[data-skill-grid]")).toBeNull()
    expect(c.querySelector('[data-entry-layout="single-line"]')).toBeTruthy()
    // Sentence-case heading, hairline rule.
    const heading = c.querySelector("h2")!
    expect(heading.className).not.toContain("uppercase")
    expect(heading.className).toContain("border-b")
    expect(c.querySelector("[data-accent-bar]")).toBeNull()
  })

  it("MODERN uses accent bars and skill pills", () => {
    const c = renderTemplate("MODERN")

    expect(c.querySelector('[data-contact-layout="accent-bar"]')).toBeTruthy()
    // Accent bar next to the name and in every section heading.
    expect(c.querySelectorAll("[data-accent-bar]").length).toBeGreaterThan(1)
    expect(c.querySelectorAll("[data-skill-pill]").length).toBe(4) // 2 skills × (mirror + page)
    expect(c.querySelector("[data-skill-pill]")!.className).toContain("rounded-full")
    expect(c.querySelector('[data-entry-layout="accent-role"]')).toBeTruthy()
    // The full-width heading rule is gone.
    expect(c.querySelector("h2")!.className).not.toContain("border-b")
  })

  it("HARVARD centres the header and uses the academic entry block", () => {
    const c = renderTemplate("HARVARD")

    const header = c.querySelector('[data-contact-layout="centered"]')!
    expect(header).toBeTruthy()
    expect(header.className).toContain("text-center")
    expect(header.querySelector(".flex.flex-wrap")!.className).toContain("justify-center")
    expect(c.querySelector('[data-entry-layout="academic"]')).toBeTruthy()
    expect(c.querySelector('[data-entry-layout="academic"] .italic')).toBeTruthy()
    expect(c.querySelector("h2")!.className).toContain("uppercase")
    expect(c.querySelector("[data-skill-pill]")).toBeNull()
  })

  it("CORPORATE banners the name and grids the skills in two columns", () => {
    const c = renderTemplate("CORPORATE")

    const header = c.querySelector('[data-contact-layout="banner"]')!
    expect(header).toBeTruthy()
    expect(header.className).toContain("border-b-2")
    expect(header.className).toContain("var(--resume-name)")
    const grid = c.querySelector("[data-skill-grid]")!
    expect(grid).toBeTruthy()
    expect(grid.className).toContain("grid-cols-2")
    expect(c.querySelector('[data-entry-layout="structured"]')).toBeTruthy()
    // Filled heading chip, no rule.
    expect(c.querySelector("h2")!.className).toContain("bg-[color:var(--resume-heading-bg)]")
  })

  it("keeps the measurement mirror structurally identical to the painted page", () => {
    const c = renderTemplate("MODERN")

    const shells = Array.from(c.querySelectorAll<HTMLElement>(".bg-white"))
    expect(shells.length).toBe(2) // mirror + one page
    const signature = (el: HTMLElement) =>
      Array.from(el.querySelectorAll("[data-entry-layout],[data-skill-pill],[data-accent-bar]"))
        .map((n) => (n as HTMLElement).dataset.entryLayout ?? n.getAttribute("data-skill-pill") ?? "bar")
        .join("|")
    expect(signature(shells[0])).toBe(signature(shells[1]))
    expect(signature(shells[0]).length).toBeGreaterThan(0)
  })

  // The mirror measures line breaks for the export, so its content box and the
  // painted page's must be the identical A4 point width. A `border` sits inside
  // the border box and shrank the painted column 2px below the mirror's.
  it("lays the mirror and the painted page out at the same A4 width", () => {
    const c = renderTemplate("MODERN")

    const mirror = c.querySelector<HTMLElement>(".invisible.select-none")!
    const pageStack = c.querySelector<HTMLElement>(".flex.select-none.flex-col")!
    expect(mirror.style.width).toBe("595.28px")
    expect(pageStack.style.width).toBe("595.28px")

    const page = Array.from(c.querySelectorAll<HTMLElement>(".bg-white"))[1]
    expect(page.className).toContain("ring-1")
    expect(page.className).not.toMatch(/(^|\s)border(\s|$)/)
  })

  it("still routes the accent customization through the new bar elements", () => {
    useResumeStore.setState({
      resume: makeResume("MODERN"),
      customization: { ...DEFAULT_CUSTOMIZATION, accent: "#166534" },
    })
    const { container } = render(<ResumePreview />)

    for (const shell of container.querySelectorAll<HTMLElement>(".bg-white")) {
      expect(shell.style.getPropertyValue("--resume-name")).toBe("#166534")
      expect(shell.style.getPropertyValue("--resume-heading")).toBe("#166534")
    }
    // Bars paint from the vars, never from a hard-coded hex.
    for (const bar of container.querySelectorAll<HTMLElement>("[data-accent-bar]")) {
      expect(bar.className).toContain("var(--resume-")
    }
  })

  it("preserves the github contact link on every template", () => {
    for (const template of ["MINIMAL", "MODERN", "HARVARD", "CORPORATE"]) {
      const c = renderTemplate(template)
      expect(c.querySelector('a[href="https://github.com/ada"]')).toBeTruthy()
      cleanup()
    }
  })
})
