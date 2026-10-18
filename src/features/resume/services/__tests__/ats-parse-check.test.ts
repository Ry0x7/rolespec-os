import { describe, it, expect } from "vitest"

import { checkParseCompatibility } from "../ats-parse-check"
import type { Section, SectionItem } from "../../hooks/use-resume-store"

let seq = 0

function item(content: Record<string, unknown>): SectionItem {
  seq += 1
  return { id: `i${seq}`, sectionId: `s${seq}`, order: 0, content }
}

function section(overrides: Partial<Section>): Section {
  seq += 1
  return {
    id: `s${seq}`,
    resumeId: "r1",
    type: "CUSTOM",
    title: "Custom",
    order: 0,
    visible: true,
    items: [],
    ...overrides,
  }
}

const contactSection = (content: Record<string, unknown> = {}) =>
  section({
    type: "CONTACT",
    title: "Contact",
    items: [
      item({ fullName: "Ada Lovelace", email: "ada@example.com", phone: "+1 555 123 4567", ...content }),
    ],
  })

const experienceSection = (items: SectionItem[]) =>
  section({ type: "EXPERIENCE", title: "Work Experience", items })

const skillsSection = () =>
  section({ type: "SKILLS", title: "Skills", items: [item({ skills: ["TypeScript"] })] })

/** A resume that fires none of the checks. */
function cleanResume(): Section[] {
  return [
    contactSection(),
    experienceSection([
      item({
        role: "Engineer",
        company: "Acme",
        startDate: "Jan 2024",
        current: true,
        bullets: ["Cut p95 latency by 40%"],
      }),
    ]),
    skillsSection(),
  ]
}

function messages(sections: Section[]): string[] {
  return checkParseCompatibility(sections).map((i) => i.message)
}

describe("checkParseCompatibility", () => {
  it("returns no issues for a parseable resume", () => {
    expect(checkParseCompatibility(cleanResume())).toEqual([])
  })

  describe("standard sections", () => {
    it("flags a missing experience section as a warning", () => {
      const sections = [contactSection(), skillsSection()]

      const issue = checkParseCompatibility(sections).find((i) => i.section === "Experience")

      expect(issue?.severity).toBe("warning")
      expect(issue?.message).toContain("No work experience section")
    })

    it("flags a missing skills section as a warning", () => {
      const sections = [
        contactSection(),
        experienceSection([item({ role: "Engineer", startDate: "Jan 2024" })]),
      ]

      const issue = checkParseCompatibility(sections).find((i) => i.section === "Skills")

      expect(issue?.severity).toBe("warning")
      expect(issue?.message).toContain("No skills section")
    })

    it("flags a missing contact section as critical", () => {
      const sections = [
        experienceSection([item({ role: "Engineer", startDate: "Jan 2024" })]),
        skillsSection(),
      ]

      const issue = checkParseCompatibility(sections).find((i) => i.section === "Contact")

      expect(issue?.severity).toBe("critical")
      expect(issue?.message).toContain("No contact section")
    })

    it("treats a hidden section as absent", () => {
      const sections = cleanResume().map((s) =>
        s.type === "SKILLS" ? { ...s, visible: false } : s
      )

      expect(messages(sections).join(" ")).toContain("No skills section")
    })
  })

  describe("contact completeness", () => {
    it("flags a missing email as critical and a missing phone as a warning", () => {
      const sections = [
        contactSection({ email: "", phone: "" }),
        experienceSection([item({ role: "Engineer", startDate: "Jan 2024" })]),
        skillsSection(),
      ]

      const issues = checkParseCompatibility(sections)
      const email = issues.find((i) => i.message.includes("Missing email address"))
      const phone = issues.find((i) => i.message.includes("Missing phone number"))

      expect(email?.severity).toBe("critical")
      expect(phone?.severity).toBe("warning")
    })

    it("does not flag contact channels when both are present", () => {
      const joined = messages(cleanResume()).join(" ")

      expect(joined).not.toContain("Missing email address")
      expect(joined).not.toContain("Missing phone number")
    })
  })

  describe("date signals", () => {
    it("flags experience and education entries with no start date", () => {
      const sections = [
        contactSection(),
        experienceSection([item({ role: "Engineer" }), item({ role: "Intern", startDate: "Jan 2022" })]),
        section({
          type: "EDUCATION",
          title: "Education",
          items: [item({ degree: "BSc", school: "State" })],
        }),
        skillsSection(),
      ]

      const issues = checkParseCompatibility(sections)

      expect(issues.find((i) => i.section === "Work Experience")?.message).toContain(
        "1 experience entry has no start date"
      )
      expect(issues.find((i) => i.section === "Education")?.message).toContain(
        "1 education entry has no start date"
      )
    })

    it("flags multiple current roles as info", () => {
      const sections = [
        contactSection(),
        experienceSection([
          item({ role: "Engineer", startDate: "Jan 2024", current: true }),
          item({ role: "Advisor", startDate: "Jan 2023", current: true }),
        ]),
        skillsSection(),
      ]

      const issue = checkParseCompatibility(sections).find((i) =>
        i.message.includes("marked as current")
      )

      expect(issue?.severity).toBe("info")
      expect(issue?.message).toContain("2 roles")
    })

    it("does not flag a single current role", () => {
      expect(messages(cleanResume()).join(" ")).not.toContain("marked as current")
    })
  })

  describe("problem characters", () => {
    it("flags emoji in section content and names the section", () => {
      const sections = [
        contactSection(),
        experienceSection([
          item({ role: "Engineer", startDate: "Jan 2024", bullets: ["Shipped the thing 🚀"] }),
        ]),
        skillsSection(),
      ]

      const issue = checkParseCompatibility(sections).find((i) =>
        i.message.includes("may not survive text extraction")
      )

      expect(issue?.severity).toBe("warning")
      expect(issue?.section).toBe("Work Experience")
      expect(issue?.message).toContain("Work Experience")
    })

    it("allows accented letters and typographic punctuation", () => {
      const sections = [
        contactSection({ fullName: "Zoë Müller" }),
        experienceSection([
          item({
            role: "Engineer",
            startDate: "Jan 2024",
            bullets: ["Led the “platform” team — shipped 3 services…"],
          }),
        ]),
        skillsSection(),
      ]

      expect(messages(sections).join(" ")).not.toContain("may not survive text extraction")
    })
  })

  describe("overlong bullets", () => {
    it("flags bullets longer than 350 characters as info", () => {
      const sections = [
        contactSection(),
        experienceSection([
          item({ role: "Engineer", startDate: "Jan 2024", bullets: ["a".repeat(351)] }),
        ]),
        skillsSection(),
      ]

      const issue = checkParseCompatibility(sections).find((i) =>
        i.message.includes("longer than 350 characters")
      )

      expect(issue?.severity).toBe("info")
      expect(issue?.message).toContain("1 bullet is")
    })

    it("does not flag a bullet at the limit", () => {
      const sections = [
        contactSection(),
        experienceSection([
          item({ role: "Engineer", startDate: "Jan 2024", bullets: ["a".repeat(350)] }),
        ]),
        skillsSection(),
      ]

      expect(messages(sections).join(" ")).not.toContain("longer than 350 characters")
    })
  })

  describe("custom section titles", () => {
    it("flags a title no ATS field-maps as info", () => {
      const sections = [
        ...cleanResume(),
        section({ type: "CUSTOM", title: "My Journey", items: [item({ text: "Some prose" })] }),
      ]

      const issue = checkParseCompatibility(sections).find((i) => i.section === "My Journey")

      expect(issue?.severity).toBe("info")
      expect(issue?.message).toContain("field-map")
    })

    it("does not flag a standard custom title", () => {
      const sections = [
        ...cleanResume(),
        section({ type: "CUSTOM", title: "Awards", items: [item({ text: "Employee of the year" })] }),
      ]

      expect(messages(sections).join(" ")).not.toContain("field-map")
    })

    it.each([
      "Clinical Rotations",
      "Student Teaching",
      "Professional Affiliations",
      "Practicum",
      "Military Service",
      "Continuing Education",
    ])("does not flag the non-technical heading %s", (title) => {
      const sections = [
        ...cleanResume(),
        section({ type: "CUSTOM", title, items: [item({ text: "Some detail" })] }),
      ]

      expect(messages(sections).join(" ")).not.toContain("field-map")
    })

    it("still flags a genuinely odd heading alongside a recognized non-technical one", () => {
      const sections = [
        ...cleanResume(),
        section({
          type: "CUSTOM",
          title: "Clinical Rotations",
          items: [item({ text: "Med-surg, 12 weeks" })],
        }),
        section({ type: "CUSTOM", title: "Vibes & Values", items: [item({ text: "Some prose" })] }),
      ]

      const flagged = checkParseCompatibility(sections).filter((i) =>
        i.message.includes("field-map")
      )

      expect(flagged.map((i) => i.section)).toEqual(["Vibes & Values"])
    })

    it("does not flag an empty custom section", () => {
      const sections = [...cleanResume(), section({ type: "CUSTOM", title: "My Journey", items: [] })]

      expect(messages(sections).join(" ")).not.toContain("field-map")
    })
  })
})
