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
        content: { fullName: "Ada Lovelace", email: "ada@example.com" },
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
          startDate: "2020",
          endDate: "2024",
          bullets: ["Shipped the first program", "Wrote the notes"],
        },
        order: 0,
      },
    ],
  },
]

/** Item-heavy resume used to prove pagination reacts to the page metrics. */
function longSections(): Section[] {
  return [
    {
      id: "s2",
      resumeId: "r1",
      type: "EXPERIENCE",
      title: "Experience",
      order: 1,
      visible: true,
      items: Array.from({ length: 14 }, (_, i) => ({
        id: `i${i}`,
        sectionId: "s2",
        order: i,
        content: {
          role: `Senior Engineer ${i}`,
          company: `Company ${i}`,
          startDate: "2018",
          endDate: "2024",
          bullets: Array.from(
            { length: 5 },
            (_, b) =>
              `Delivered a substantial cross-functional initiative number ${b} that reduced latency and improved reliability across many services.`
          ),
        },
      })),
    },
  ]
}

/** Page total from the PDF's page-tree node. */
function pageCount(buffer: Buffer): number {
  const match = buffer.toString("latin1").match(/\/Count (\d+)/)
  return match ? Number(match[1]) : 0
}

describe("generatePdf with customization", () => {
  it("renders with defaults", async () => {
    const buffer = await generatePdf({ template: "MINIMAL", sections })
    expect(buffer.length).toBeGreaterThan(500)
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
  }, 30000)

  it("produces different output when the customization changes", async () => {
    const plain = await generatePdf({
      template: "MINIMAL",
      sections,
      customization: DEFAULT_CUSTOMIZATION,
    })
    const customized = await generatePdf({
      template: "MINIMAL",
      sections,
      customization: {
        ...DEFAULT_CUSTOMIZATION,
        density: "compact",
        fontFamily: "serif",
        fontScale: 1.1,
        accent: "#166534",
        margins: "compact",
        lineHeight: "relaxed",
      },
    })

    expect(customized.subarray(0, 4).toString()).toBe("%PDF")
    // Font, size, colour and padding all shift the content stream, so the byte
    // count moves too (timestamps alone would keep the length identical).
    expect(customized.length).not.toBe(plain.length)
  }, 30000)

  it("keeps concurrent renders isolated", async () => {
    const [a, b, c] = await Promise.all([
      generatePdf({ template: "MINIMAL", sections, customization: DEFAULT_CUSTOMIZATION }),
      generatePdf({
        template: "MINIMAL",
        sections,
        customization: { ...DEFAULT_CUSTOMIZATION, fontScale: 1.1, margins: "relaxed" },
      }),
      generatePdf({ template: "MINIMAL", sections, customization: DEFAULT_CUSTOMIZATION }),
    ])

    // Byte equality is impossible (each PDF carries its own creation date), so
    // compare sizes: the two default renders must agree and the scaled one must
    // not — a shared module-level config would let them bleed into each other.
    expect(a.length).toBe(c.length)
    expect(a.length).not.toBe(b.length)
  }, 30000)

  it("paginates a long resume and reclaims pages in compact density", async () => {
    const spacious = await generatePdf({
      template: "MINIMAL",
      sections: longSections(),
      customization: DEFAULT_CUSTOMIZATION,
    })
    const compact = await generatePdf({
      template: "MINIMAL",
      sections: longSections(),
      customization: { ...DEFAULT_CUSTOMIZATION, density: "compact", margins: "compact" },
    })

    expect(pageCount(spacious)).toBeGreaterThan(1)
    expect(pageCount(compact)).toBeLessThan(pageCount(spacious))
  }, 30000)
})
