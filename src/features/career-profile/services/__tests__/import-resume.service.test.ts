// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))

import {
  mapResumeToCareerFacts,
  parseResumeDate,
} from "../import-resume.service"

const RESUME = {
  resumeId: "resume_1",
  resumeTitle: "Master Resume",
}

function section(
  type: string,
  items: Array<Record<string, unknown>>,
  order = 0
) {
  return {
    type,
    title: type,
    order,
    items: items.map((content, index) => ({ content, order: index })),
  }
}

describe("parseResumeDate", () => {
  it("reads a month picker value as the first of that month in UTC", () => {
    expect(parseResumeDate("2024-03")?.toISOString()).toBe("2024-03-01T00:00:00.000Z")
  })

  it("reads a full date as UTC midnight", () => {
    expect(parseResumeDate("2024-03-15")?.toISOString()).toBe("2024-03-15T00:00:00.000Z")
  })

  it.each(["2026-02-31", "2026-13-01", "2026/03/01", "", null, "Present"])(
    "rejects %s rather than rolling it forward",
    (value) => {
      expect(parseResumeDate(value)).toBeNull()
    }
  )
})

describe("mapResumeToCareerFacts", () => {
  it("maps experience, education, project and certification rows with provenance", () => {
    const result = mapResumeToCareerFacts({
      ...RESUME,
      sections: [
        section(
          "EXPERIENCE",
          [
            {
              role: "Charge Nurse",
              company: "Lakeside Medical Center",
              startDate: "2021-03",
              current: true,
              bullets: ["Ran a 24-bed ICU", "  Cut errors by 32%  "],
            },
          ],
          2
        ),
        section(
          "EDUCATION",
          [
            {
              degree: "B.S. Nursing",
              school: "Oregon Health & Science University",
              startDate: "2014-09",
              graduationDate: "2018-05",
            },
          ],
          3
        ),
        section(
          "PROJECTS",
          [
            {
              name: "Triage board",
              startDate: "2023-01",
              endDate: "2023-06",
              bullets: ["Built a live bed board", "Used by 40 nurses"],
            },
          ],
          4
        ),
        section(
          "CERTIFICATIONS",
          [{ name: "CCRN", organization: "AACN", dateObtained: "2022-08" }],
          5
        ),
      ],
    })

    expect(result.evidence).toHaveLength(4)
    const [experience, education, project, certification] = result.evidence

    expect(experience).toMatchObject({
      kind: "EXPERIENCE",
      title: "Charge Nurse",
      organization: "Lakeside Medical Center",
      details: "Ran a 24-bed ICU\nCut errors by 32%",
      outcome: null,
      metadata: {
        sourceResumeId: "resume_1",
        sourceResumeTitle: "Master Resume",
      },
    })
    expect(experience.startDate?.toISOString()).toBe("2021-03-01T00:00:00.000Z")
    expect(experience.endDate).toBeNull()

    expect(education).toMatchObject({
      kind: "EDUCATION",
      title: "B.S. Nursing",
      organization: "Oregon Health & Science University",
    })
    expect(education.startDate?.toISOString()).toBe("2014-09-01T00:00:00.000Z")
    expect(education.endDate?.toISOString()).toBe("2018-05-01T00:00:00.000Z")

    expect(project).toMatchObject({
      kind: "PROJECT",
      title: "Triage board",
      details: "Built a live bed board\nUsed by 40 nurses",
    })
    expect(project.endDate?.toISOString()).toBe("2023-06-01T00:00:00.000Z")

    expect(certification).toMatchObject({
      kind: "CERTIFICATION",
      title: "CCRN",
      organization: "AACN",
    })
    expect(certification.endDate?.toISOString()).toBe("2022-08-01T00:00:00.000Z")
  })

  it("maps skills as unconfirmed capability names, keeping the category", () => {
    const result = mapResumeToCareerFacts({
      ...RESUME,
      sections: [
        section("SKILLS", [
          { category: "Clinical", skills: ["Triage", "ACLS", "  ", "Triage"] },
          { skills: ["Epic"] },
        ]),
      ],
    })

    expect(result.capabilities).toEqual([
      { name: "Triage", category: "Clinical" },
      { name: "ACLS", category: "Clinical" },
      { name: "Epic", category: null },
    ])
  })

  it("ignores contact, summary and custom text, and untitled rows", () => {
    const result = mapResumeToCareerFacts({
      ...RESUME,
      sections: [
        section("CONTACT", [{ fullName: "Ada" }]),
        section("SUMMARY", [{ text: "Engineer" }]),
        section("CUSTOM", [{ text: "Interests" }]),
        section("EXPERIENCE", [{ company: "No title" }]),
        section("PROJECTS", [{ bullets: ["No name"] }]),
      ],
    })

    expect(result.evidence).toEqual([])
    expect(result.capabilities).toEqual([])
  })

  it("deduplicates the same row within one resume, ignoring case and punctuation", () => {
    const result = mapResumeToCareerFacts({
      ...RESUME,
      sections: [
        section("EXPERIENCE", [
          { role: "Registered Nurse", company: "Acme, Inc." },
          { role: "registered nurse", company: "Acme Inc" },
        ]),
      ],
    })

    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0].title).toBe("Registered Nurse")
  })

  it("caps every field to the evidence-form limits", () => {
    const result = mapResumeToCareerFacts({
      ...RESUME,
      sections: [
        section("EXPERIENCE", [
          {
            role: "x".repeat(300),
            company: "y".repeat(300),
            bullets: ["z".repeat(6000)],
          },
        ]),
      ],
    })

    expect(result.evidence[0].title).toHaveLength(200)
    expect(result.evidence[0].organization).toHaveLength(200)
    expect(result.evidence[0].details).toHaveLength(5000)
  })
})
