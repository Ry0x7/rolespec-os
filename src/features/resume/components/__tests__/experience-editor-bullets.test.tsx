import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { ExperienceEditor } from "../editors/experience-editor"
import { useResumeStore, type ResumeData, type Section } from "../../hooks/use-resume-store"

function expSection(bullets: string[]): Section {
  return {
    id: "s-exp",
    resumeId: "r1",
    type: "EXPERIENCE",
    title: "Experience",
    order: 0,
    visible: true,
    items: [
      {
        id: "i-exp",
        sectionId: "s-exp",
        order: 0,
        content: { company: "Acme", role: "Nurse", bullets },
      },
    ],
  }
}

function makeResume(bullets: string[]): ResumeData {
  return {
    id: "r1",
    title: "Test",
    targetRole: null,
    targetCompany: null,
    template: "MINIMAL",
    atsScore: null,
    jobDescription: null,
    latestAnalysis: null,
    sections: [expSection(bullets)],
  }
}

function storedBullets(): string[] {
  const item = useResumeStore.getState().resume!.sections[0].items[0]
  return (item.content as { bullets?: string[] }).bullets ?? []
}

// The editor takes its section as a prop, so the harness subscribes to the
// store for it — that is what the real section panel does.
function Harness() {
  const section = useResumeStore((s) => s.resume!.sections[0])
  return <ExperienceEditor section={section} />
}

function renderEditor(bullets: string[]) {
  useResumeStore.getState().setResume(makeResume(bullets))
  render(<Harness />)
  return () => screen.getAllByPlaceholderText("Achieved X by doing Y, resulting in Z")
}

beforeEach(() => {
  useResumeStore.getState().setResume(makeResume([""]))
})

afterEach(() => {
  cleanup()
})

describe("ExperienceEditor bullet editing", () => {
  it("renders bullets as auto-growing textareas", () => {
    const fields = renderEditor(["Led triage"])
    expect(fields()[0].tagName).toBe("TEXTAREA")
  })

  it("Enter inserts an empty bullet right below and focuses it", () => {
    const fields = renderEditor(["first", "second"])
    fireEvent.keyDown(fields()[0], { key: "Enter" })

    expect(storedBullets()).toEqual(["first", "", "second"])
    const after = fields()
    expect(after).toHaveLength(3)
    expect(document.activeElement).toBe(after[1])
  })

  it("Backspace in an empty bullet removes it and focuses the end of the previous one", () => {
    const fields = renderEditor(["first", ""])
    fireEvent.keyDown(fields()[1], { key: "Backspace" })

    expect(storedBullets()).toEqual(["first"])
    const after = fields()
    expect(after).toHaveLength(1)
    expect(document.activeElement).toBe(after[0])
    expect((after[0] as HTMLTextAreaElement).selectionStart).toBe("first".length)
  })

  it("keeps the last remaining bullet on Backspace", () => {
    const fields = renderEditor([""])
    fireEvent.keyDown(fields()[0], { key: "Backspace" })

    expect(storedBullets()).toEqual([""])
    expect(fields()).toHaveLength(1)
  })

  it("shows the character counter only once a bullet runs long", () => {
    const fields = renderEditor(["short"])
    expect(screen.queryByText(/\/220$/)).toBeNull()

    fireEvent.change(fields()[0], { target: { value: "x".repeat(200) } })
    expect(screen.getByText("200/220")).toBeTruthy()
  })
})

describe("ExperienceEditor accessible names", () => {
  it("names the position delete button after the company", () => {
    renderEditor(["Led triage"])
    expect(screen.getByRole("button", { name: "Remove Acme" })).toBeTruthy()
  })

  it("falls back to a generic position name when the company is empty", () => {
    const resume = makeResume([""])
    resume.sections[0].items[0].content = { company: "", role: "Nurse", bullets: [""] }
    useResumeStore.getState().setResume(resume)
    render(<Harness />)
    expect(screen.getByRole("button", { name: "Remove position" })).toBeTruthy()
  })

  it("names each bullet delete button by position", () => {
    renderEditor(["first", "second"])
    expect(screen.getByRole("button", { name: "Remove bullet 1" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Remove bullet 2" })).toBeTruthy()
  })
})

describe("ExperienceEditor keyword and guidance rendering", () => {
  beforeEach(() => {
    useResumeStore.setState({ missingKeywords: [], atsResults: null })
  })

  it("no longer renders an inert missing-keywords list", () => {
    renderEditor(["Led triage without mentioning the stack"])
    useResumeStore.getState().setMissingKeywords(["Kubernetes", "Terraform"])
    cleanup()
    render(<Harness />)

    expect(screen.queryByText(/Missing keywords:/)).toBeNull()
    expect(screen.queryByText("Kubernetes")).toBeNull()
  })

  it("shows the static tip when there is no matching ATS finding", () => {
    renderEditor(["Led triage"])
    expect(screen.getByText(/Start each bullet with a strong action verb/)).toBeTruthy()
  })

  it("shows a matching ATS finding instead of the static tip", () => {
    renderEditor(["Led triage"])
    useResumeStore.setState({
      atsResults: {
        overallScore: 50,
        scores: { formatting: 50, keywords: 50, impact: 50, completeness: 50, readability: 50 },
        issues: [
          {
            severity: "critical",
            category: "impact",
            message: "Bullets lack measurable outcomes",
            section: "Experience",
            suggestion: "Add a number to at least one bullet",
          },
        ],
        suggestions: [],
      },
    })
    cleanup()
    render(<Harness />)

    expect(screen.getByText("Bullets lack measurable outcomes")).toBeTruthy()
    expect(screen.getByText("Add a number to at least one bullet")).toBeTruthy()
    expect(screen.queryByText(/Start each bullet with a strong action verb/)).toBeNull()
  })
})
