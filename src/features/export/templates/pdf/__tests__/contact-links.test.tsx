// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { DEFAULT_CUSTOMIZATION } from "@/features/resume/types/customization"
import { generatePdf } from "../../../services/generate-pdf"

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
        content: {
          fullName: "Ada Lovelace",
          jobTitle: "Analyst",
          email: "ada@example.com",
          phone: "+1 (555) 010-2030",
          location: "London, UK",
          linkedin: "linkedin.com/in/ada",
          website: "https://ada.dev",
        },
        order: 0,
      },
    ],
  },
  {
    id: "s2",
    resumeId: "r1",
    type: "SUMMARY",
    title: "Summary",
    order: 1,
    visible: true,
    items: [{ id: "i2", sectionId: "s2", content: { text: "First programmer." }, order: 0 }],
  },
]

/** URI annotations are written as plain PDF strings, so latin1 is enough. */
async function renderText(template: "MINIMAL" | "MODERN" | "HARVARD" | "CORPORATE") {
  const buffer = await generatePdf({ template, sections, customization: DEFAULT_CUSTOMIZATION })
  expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
  return buffer.toString("latin1")
}

describe("PDF contact hyperlinks", () => {
  it("writes mailto/tel/https URI annotations for MINIMAL", async () => {
    const text = await renderText("MINIMAL")

    expect(text).toContain("mailto:ada@example.com")
    expect(text).toContain("tel:+15550102030")
    expect(text).toContain("https://linkedin.com/in/ada")
    expect(text).toContain("https://ada.dev")
    expect(text).toContain("/URI")
  }, 60000)

  it("writes the same annotations for CORPORATE", async () => {
    const text = await renderText("CORPORATE")

    expect(text).toContain("mailto:ada@example.com")
    expect(text).toContain("tel:+15550102030")
    expect(text).toContain("https://linkedin.com/in/ada")
    expect(text).toContain("https://ada.dev")
  }, 60000)

  it("does not link the location line", async () => {
    const text = await renderText("MINIMAL")

    expect(text).not.toContain("London, UK)")
    expect(text).not.toMatch(/\/URI\s*\(London/)
  }, 60000)
})
