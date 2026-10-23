import { describe, expect, it } from "vitest"
import { importResumeText, ResumeTextRequiredError } from "../import-resume-text"

describe("local text import", () => {
  it("keeps unfamiliar headings, bullets, dates and Unicode text without inventing fields", () => {
    const source = "李明\r\nCustom credentials\r\nExperience:\r\nAcme | Engineer | 2020–Present\r\n• Built tools\r\nEducation\r\nUniversity of Manila\r\n-- 1 of 1 --"
    const result = importResumeText(source)
    expect(result.importedSections).toEqual([
      { title: "Imported details", content: "李明\nCustom credentials" },
      { title: "Experience", content: "Acme | Engineer | 2020–Present\n• Built tools" },
      { title: "Education", content: "University of Manila" },
    ])
    expect(result.experience).toEqual([])
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
