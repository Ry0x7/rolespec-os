import { describe, expect, it } from "vitest"
import type { Section } from "../../hooks/use-resume-store"
import { serializeSections } from "../serialize-sections"

function section(type: Section["type"], title: string, contents: Record<string, unknown>[]): Section {
  return {
    id: `section-${type}`,
    resumeId: "resume-1",
    type,
    title,
    order: 0,
    visible: true,
    items: contents.map((content, order) => ({
      id: `item-${order}`,
      sectionId: `section-${type}`,
      content,
      order,
    })),
  }
}

describe("serializeSections", () => {
  it("serializes custom item titles with their body and supports legacy text", () => {
    const result = serializeSections([
      section("CUSTOM", "Achievements", [
        { title: "Engineering award", content: "Industry Association\nRecognized for reliability." },
        { title: "Solo distinction" },
        { title: "Legacy achievement", text: "Legacy body" },
      ]),
    ])

    expect(result).toBe(
      [
        "## Achievements",
        "Engineering award\nIndustry Association\nRecognized for reliability.",
        "Solo distinction",
        "Legacy achievement\nLegacy body",
      ].join("\n")
    )
    expect(result).not.toContain("{\"")
  })

  it("labels obtained and expiration dates and retains expiration-only credentials", () => {
    const result = serializeSections([
      section("CERTIFICATIONS", "Certifications", [
        {
          name: "Cloud Architect",
          organization: "Cloud Guild",
          dateObtained: "Apr 2024",
          expirationDate: "Apr 2027",
        },
        { name: "End-only credential", expirationDate: "Aug 2028" },
      ]),
    ])

    expect(result).toBe(
      [
        "## Certifications",
        "Cloud Architect - Cloud Guild — Obtained: Apr 2024; Expires: Apr 2027",
        "End-only credential — Expires: Aug 2028",
      ].join("\n")
    )
  })
})
