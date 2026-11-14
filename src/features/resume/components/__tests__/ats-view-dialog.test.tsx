import { describe, it, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("../../actions/analyze-ats", () => ({ analyzeATS: vi.fn() }))
vi.mock("../../actions/enhance", () => ({ enhanceResumeFromATS: vi.fn() }))

import { ATSDrawer } from "../ats-drawer"
import { useResumeStore, type ResumeData, type Section } from "../../hooks/use-resume-store"

const sections: Section[] = [
  {
    id: "s1",
    resumeId: "r1",
    type: "CONTACT",
    title: "Contact",
    order: 0,
    visible: true,
    items: [
      {
        id: "i1",
        sectionId: "s1",
        order: 0,
        content: { fullName: "Ada Lovelace", email: "ada@example.com" },
      },
    ],
  },
  {
    id: "s2",
    resumeId: "r1",
    type: "EXPERIENCE",
    title: "Work Experience",
    order: 1,
    visible: true,
    items: [
      {
        id: "i2",
        sectionId: "s2",
        order: 0,
        content: {
          role: "Engineer",
          company: "Acme",
          startDate: "Jan 2024",
          current: true,
          bullets: ["Cut p95 latency by 40%"],
        },
      },
    ],
  },
]

const makeResume = (overrides: Partial<ResumeData> = {}): ResumeData => ({
  id: "r1",
  title: "Test",
  targetRole: null,
  targetCompany: null,
  template: "MINIMAL",
  sections,
  atsScore: null,
  jobDescription: null,
  latestAnalysis: null,
  ...overrides,
})

// "View as ATS" now lives inside the ATS inspector drawer, so these render it
// open (openInspector: "ats") rather than the standalone results block that
// used to always render.
describe("ATSViewDialog (via ATSDrawer)", () => {
  beforeEach(() => {
    useResumeStore.getState().setResume(makeResume())
    useResumeStore.setState({ openInspector: "ats" })
  })

  it("opens from the ATS drawer's trigger and renders the serialized resume text", () => {
    render(<ATSDrawer />)

    expect(screen.queryByRole("dialog", { name: "ATS view" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "View as ATS" }))

    const dialog = screen.getByRole("dialog", { name: "ATS view" })
    expect(dialog).toBeTruthy()
    expect(screen.getByText("ATS view")).toBeTruthy()
    expect(
      screen.getByText(
        "This is what an applicant tracking system sees after parsing your resume."
      )
    ).toBeTruthy()

    const text = dialog.textContent ?? ""
    expect(text).toContain("## Contact")
    expect(text).toContain("Email: ada@example.com")
    expect(text).toContain("## Experience")
    expect(text).toContain("Engineer at Acme (Jan 2024 - Present)")
    expect(text).toContain("- Cut p95 latency by 40%")
  })

  // Three affordances now share the name "Close": the ATS view dialog's
  // footer button, its own shell X, and the surrounding ATS drawer's X —
  // only the first two belong to the ATS view dialog itself.
  it("closes again from the footer Close button", () => {
    render(<ATSDrawer />)

    fireEvent.click(screen.getByRole("button", { name: "View as ATS" }))
    const dialog = screen.getByRole("dialog", { name: "ATS view" })
    const closers = screen.getAllByRole("button", { name: "Close" })
    expect(closers.length).toBeGreaterThanOrEqual(2)
    const footerClose = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Close"
    )
    expect(footerClose).toBeTruthy()
    fireEvent.click(footerClose!)

    expect(screen.queryByRole("dialog", { name: "ATS view" })).toBeNull()
  })

  it("closes again from the shell's X button", () => {
    render(<ATSDrawer />)

    fireEvent.click(screen.getByRole("button", { name: "View as ATS" }))
    const dialog = screen.getByRole("dialog", { name: "ATS view" })
    const shellClose = dialog.querySelector('button[aria-label="Close"]')
    expect(shellClose).toBeTruthy()
    fireEvent.click(shellClose!)

    expect(screen.queryByRole("dialog", { name: "ATS view" })).toBeNull()
  })
})
