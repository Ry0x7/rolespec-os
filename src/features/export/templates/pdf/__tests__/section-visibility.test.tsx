// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { generatePdf } from "../../../services/generate-pdf"

const TEMPLATES = ["MINIMAL", "MODERN", "HARVARD", "CORPORATE"] as const

function contact(visible: boolean): Section {
  return {
    id: "s-contact",
    resumeId: "r1",
    type: "CONTACT",
    title: "Contact",
    order: 0,
    visible,
    items: [
      {
        id: "i-contact",
        sectionId: "s-contact",
        content: { fullName: "Ada Lovelace", email: "ada@example.com" },
        order: 0,
      },
    ],
  }
}

function certifications(visible: boolean): Section {
  return {
    id: "s-certs",
    resumeId: "r1",
    type: "CERTIFICATIONS",
    title: "Certifications",
    order: 1,
    visible,
    items: [
      {
        id: "i-cert",
        sectionId: "s-certs",
        content: { name: "Solutions Architect", organization: "AWS", dateObtained: "2024-06" },
        order: 0,
      },
    ],
  }
}

async function textOf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse")
  const { text } = await new PDFParse(new Uint8Array(buffer)).getText()
  return text
}

describe("PDF section visibility matches the preview", () => {
  // The preview drops a section only on `visible === false`; the PDF used to
  // require a truthy flag, so a section that reached the renderer without one
  // silently vanished from the export.
  it("keeps a section whose visible flag was never set", async () => {
    const unset = undefined as unknown as boolean
    const buffer = await generatePdf({
      template: "MINIMAL",
      sections: [contact(unset), certifications(unset)],
    })

    const text = await textOf(buffer)
    expect(text).toContain("Ada Lovelace")
    expect(text).toContain("Solutions Architect")
  }, 30000)

  // Without a visible Skills section to host it, the preview renders the
  // combined block under Certifications; the PDF returned null and lost them.
  for (const template of TEMPLATES) {
    it(`${template} keeps grouped certifications when no Skills section exists`, async () => {
      const buffer = await generatePdf({
        template,
        sections: [contact(true), certifications(true)],
        groupAdditional: true,
        groupAdditionalTitle: "Additional Information",
      })

      const text = await textOf(buffer)
      expect(text).toContain("Solutions Architect")
      // Templates uppercase their headings via `textTransform`.
      expect(text.toLowerCase()).toContain("additional information")
    }, 30000)
  }

  it("still hides an explicitly hidden section", async () => {
    const buffer = await generatePdf({
      template: "MINIMAL",
      sections: [contact(true), certifications(false)],
    })

    const text = await textOf(buffer)
    expect(text).toContain("Ada Lovelace")
    expect(text).not.toContain("Solutions Architect")
  }, 30000)
})
