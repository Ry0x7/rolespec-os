// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { DEFAULT_CUSTOMIZATION } from "@/features/resume/types/customization"
import { generatePdf } from "../../../services/generate-pdf"

const TEMPLATES = ["MINIMAL", "MODERN", "HARVARD", "CORPORATE"] as const

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
          github: "github.com/ada",
        },
        order: 0,
      },
    ],
  },
  {
    id: "s2",
    resumeId: "r1",
    type: "EXPERIENCE",
    title: "Experience",
    order: 1,
    visible: true,
    items: [
      {
        id: "i2",
        sectionId: "s2",
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
    ],
  },
  {
    id: "s3",
    resumeId: "r1",
    type: "SKILLS",
    title: "Skills",
    order: 2,
    visible: true,
    items: [
      {
        id: "i3",
        sectionId: "s3",
        content: { category: "Core", skills: ["TypeScript", "Rust", "Prolog", "Ada"] },
        order: 0,
      },
    ],
  },
]

/** PDFs carry a creation timestamp and file id; drop both before comparing. */
function stableBytes(buffer: Buffer): string {
  return buffer
    .toString("latin1")
    .replace(/\/CreationDate \(D:[^)]*\)/g, "")
    .replace(/\/ID \[[^\]]*\]/g, "")
}

describe("PDF template identities", () => {
  it("renders a valid PDF for every template and produces four distinct documents", async () => {
    const buffers = await Promise.all(
      TEMPLATES.map((template) =>
        generatePdf({ template, sections, customization: DEFAULT_CUSTOMIZATION })
      )
    )

    for (const buffer of buffers) {
      expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
      expect(buffer.length).toBeGreaterThan(500)
    }

    const stable = buffers.map(stableBytes)
    for (let i = 0; i < stable.length; i++) {
      for (let j = i + 1; j < stable.length; j++) {
        expect(
          stable[i] === stable[j],
          `${TEMPLATES[i]} and ${TEMPLATES[j]} rendered identical content`
        ).toBe(false)
      }
    }
  }, 60000)

  it("keeps every template rendering under the customizer", async () => {
    const buffers = await Promise.all(
      TEMPLATES.map((template) =>
        generatePdf({
          template,
          sections,
          customization: {
            ...DEFAULT_CUSTOMIZATION,
            density: "compact",
            accent: "#166534",
            fontScale: 1.1,
            margins: "relaxed",
          },
        })
      )
    )

    for (const buffer of buffers) {
      expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
    }
  }, 60000)
})
