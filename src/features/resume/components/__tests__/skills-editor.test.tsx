import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { SkillsEditor } from "../editors/skills-editor"
import { useResumeStore, type ResumeData, type Section } from "../../hooks/use-resume-store"

function skillsSection(categories: { category: string; skills: string[] }[]): Section {
  return {
    id: "s-skills",
    resumeId: "r1",
    type: "SKILLS",
    title: "Skills",
    order: 0,
    visible: true,
    items: categories.map((c, i) => ({
      id: `cat-${i}`,
      sectionId: "s-skills",
      order: i,
      content: c,
    })),
  }
}

function makeResume(section: Section): ResumeData {
  return {
    id: "r1",
    title: "Test",
    targetRole: null,
    targetCompany: null,
    template: "MINIMAL",
    atsScore: null,
    jobDescription: null,
    latestAnalysis: null,
    sections: [section],
  }
}

// The editor takes its section as a prop, so the harness re-reads it from the
// store on every render — that is what the real section panel does.
function Harness() {
  const section = useResumeStore((s) => s.resume!.sections[0])
  return <SkillsEditor section={section} />
}

function renderEditor(section: Section) {
  useResumeStore.getState().setResume(makeResume(section))
  render(<Harness />)
}

afterEach(cleanup)

describe("SkillsEditor keyword chips", () => {
  beforeEach(() => {
    useResumeStore.setState({ missingKeywords: [] })
  })

  it("renders the suggested-keyword chip set once per section, not once per category", () => {
    renderEditor(
      skillsSection([
        { category: "Core", skills: [] },
        { category: "Tools", skills: [] },
      ])
    )
    useResumeStore.getState().setMissingKeywords(["Kubernetes", "Terraform"])
    // Re-render with the updated store value.
    cleanup()
    render(<Harness />)

    // This is the regression the QA doc measured: 2 categories x 20 keywords
    // used to render 40 chips. With one shared chip set, each keyword's
    // "Add" button appears exactly once.
    expect(screen.getAllByRole("button", { name: 'Add "Kubernetes" to skills' })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: 'Add "Terraform" to skills' })).toHaveLength(1)
  })

  it("clicking a suggested keyword adds it to the first category", () => {
    renderEditor(
      skillsSection([
        { category: "Core", skills: ["React"] },
        { category: "Tools", skills: [] },
      ])
    )
    useResumeStore.getState().setMissingKeywords(["Kubernetes"])
    cleanup()
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: 'Add "Kubernetes" to skills' }))

    const items = useResumeStore.getState().resume!.sections[0].items
    expect((items[0].content as { skills?: string[] }).skills).toEqual(["React", "Kubernetes"])
    expect((items[1].content as { skills?: string[] }).skills).toEqual([])
  })

  it("clicking a suggested keyword with no categories yet creates one", () => {
    renderEditor(skillsSection([]))
    useResumeStore.getState().setMissingKeywords(["Kubernetes"])
    cleanup()
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: 'Add "Kubernetes" to skills' }))

    const items = useResumeStore.getState().resume!.sections[0].items
    expect(items).toHaveLength(1)
    expect((items[0].content as { skills?: string[] }).skills).toEqual(["Kubernetes"])
  })

  it("stops suggesting a keyword once it has been added anywhere in the section", () => {
    renderEditor(skillsSection([{ category: "Core", skills: ["Kubernetes"] }]))
    useResumeStore.getState().setMissingKeywords(["Kubernetes", "Terraform"])
    cleanup()
    render(<Harness />)

    expect(screen.queryByRole("button", { name: 'Add "Kubernetes" to skills' })).toBeNull()
    expect(screen.getByRole("button", { name: 'Add "Terraform" to skills' })).toBeTruthy()
  })

  it("shows no suggested-keyword block when there is nothing missing", () => {
    renderEditor(skillsSection([{ category: "Core", skills: [] }]))
    useResumeStore.getState().setMissingKeywords([])
    cleanup()
    render(<Harness />)

    expect(screen.queryByText(/click to add to your skills/)).toBeNull()
  })
})

describe("SkillsEditor guidance", () => {
  beforeEach(() => {
    useResumeStore.setState({ missingKeywords: [], atsResults: null })
  })

  it("shows the static tip when there is no matching ATS finding", () => {
    renderEditor(skillsSection([{ category: "Core", skills: [] }]))
    expect(screen.getByText(/Group skills by category/)).toBeTruthy()
  })

  it("shows a matching ATS finding instead of the static tip", () => {
    renderEditor(skillsSection([{ category: "Core", skills: [] }]))
    useResumeStore.setState({
      atsResults: {
        overallScore: 50,
        scores: { formatting: 50, keywords: 50, impact: 50, completeness: 50, readability: 50 },
        issues: [
          {
            severity: "warning",
            category: "keywords",
            message: "Skills section is thin",
            section: "Skills",
          },
        ],
        suggestions: [],
      },
    })
    cleanup()
    render(<Harness />)

    expect(screen.getByText("Skills section is thin")).toBeTruthy()
    expect(screen.queryByText(/Group skills by category/)).toBeNull()
  })
})
