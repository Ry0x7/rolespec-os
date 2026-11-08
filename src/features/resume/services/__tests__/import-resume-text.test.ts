import { describe, expect, it } from "vitest"
import { importResumeText, ResumeTextRequiredError } from "../import-resume-text"

describe("local text import", () => {
  it("structures familiar headings without inventing fields", () => {
    const source = [
      "Ada Lovelace",
      "ada@example.com",
      "Professional Summary",
      "Analytical engine programmer with a focus on",
      "mathematical notation.",
      "Experience",
      "Analytical Engines Ltd — Programmer — 2018 to Present",
      "",
      "• Wrote the first algorithm",
      "• Documented the engine",
      "Skills",
      "Languages: English, French",
      "Technical: Mathematics, Notation",
      "Education",
      "University of London — B.A. Mathematics — 2018",
      "Awards",
      "Royal Society member",
    ].join("\n")

    const result = importResumeText(source)

    expect(result.summary).toEqual({
      text: "Analytical engine programmer with a focus on mathematical notation.",
    })
    expect(result.experience).toEqual([
      {
        role: "Analytical Engines Ltd — Programmer — 2018 to Present",
        bullets: ["Wrote the first algorithm", "Documented the engine"],
      },
    ])
    expect(result.skills).toEqual([
      { category: "Languages", skills: ["English", "French"] },
      { category: "Technical", skills: ["Mathematics", "Notation"] },
    ])
    expect(result.education).toEqual([
      { school: "University of London", degree: "B.A. Mathematics", endDate: "2018" },
    ])

    // Recognized headings are typed sections now; only the unfamiliar one is
    // left for the route to persist as a CUSTOM section.
    expect(result.importedSections).toEqual([
      { title: "Imported details", content: "Ada Lovelace\nada@example.com" },
      { title: "Awards", content: "Royal Society member" },
    ])
    expect(result.importedSections?.map((section) => section.title)).not.toContain("Experience")
  })

  it("keeps every source line's text in the structured output", () => {
    const source = [
      "Summary",
      "Registered nurse with eight years in critical care.",
      "Experience",
      "Northwind Labs — Senior Engineer — 2022 to Present",
      "• Led the design system migration",
      "• Cut bundle size by 27%",
      "Education",
      "University of the Philippines — BS Computer Science — 2018",
      "Skills",
      "TypeScript, React, Next.js",
      "Certifications",
      "RN (OR license)",
      "Awards",
      "Nurse of the year",
    ].join("\n")

    const serialized = JSON.stringify(importResumeText(source))

    for (const fragment of [
      "Registered nurse with eight years in critical care.",
      "Northwind Labs — Senior Engineer — 2022 to Present",
      "Led the design system migration",
      "Cut bundle size by 27%",
      "University of the Philippines",
      "BS Computer Science",
      "2018",
      "TypeScript",
      "React",
      "Next.js",
      "RN (OR license)",
      "Nurse of the year",
    ]) {
      expect(serialized).toContain(fragment)
    }
  })

  it("keeps unfamiliar headings, bullets, dates and Unicode text without inventing fields", () => {
    const source = "李明\r\nCustom credentials\r\nExperience:\r\nAcme | Engineer | 2020–Present\r\n• Built tools\r\nEducation\r\nUniversity of Manila\r\n-- 1 of 1 --"
    const result = importResumeText(source)
    expect(result.importedSections).toEqual([
      { title: "Imported details", content: "李明\nCustom credentials" },
    ])
    expect(result.experience).toEqual([
      {
        role: "Acme | Engineer | 2020–Present",
        bullets: ["Built tools"],
      },
    ])
    expect(result.education).toEqual([{ school: "University of Manila" }])
  })

  it("keeps a lone experience line as a tailorable bullet rather than a guessed job title", () => {
    const result = importResumeText("Experience\nBuilt the note engine")
    expect(result.experience).toEqual([{ bullets: ["Built the note engine"] }])
  })

  it("keeps a lone header-like experience line verbatim as the role", () => {
    const result = importResumeText("Experience\nAcme | Engineer | 2020–Present")
    expect(result.experience).toEqual([{ role: "Acme | Engineer | 2020–Present" }])
  })

  it("preserves an unstructured resume as one editable section", () => {
    expect(importResumeText("Ada Lovelace\nBuilt tools").importedSections).toEqual([
      { title: "Imported details", content: "Ada Lovelace\nBuilt tools" },
    ])
  })

  it.each(["", " \n\t", "-- 1 of 1 --\n"]) ("rejects extraction without readable resume text: %j", (source) => {
    expect(() => importResumeText(source)).toThrow(ResumeTextRequiredError)
  })
})
