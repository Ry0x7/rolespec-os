import { createElement } from "react"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import type { ResumeCustomization } from "@/features/resume/types/customization"
import "../templates/pdf/setup"
import { PDF_TEMPLATES } from "../templates/pdf"
import { runWithPdfConfig } from "../templates/pdf/config-context"
import { resolvePdfConfig } from "../templates/pdf/customize"

interface GeneratePdfOptions {
  template: string
  sections: Section[]
  metadata?: { targetRole?: string; targetCompany?: string }
  groupAdditional?: boolean
  groupAdditionalTitle?: string
  customization?: ResumeCustomization
}

export async function generatePdf({
  template,
  sections,
  metadata,
  groupAdditional,
  groupAdditionalTitle,
  customization,
}: GeneratePdfOptions): Promise<Buffer> {
  const TemplateComponent = PDF_TEMPLATES[template] ?? PDF_TEMPLATES.MINIMAL

  // Templates return <Document> at their root which satisfies DocumentProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(TemplateComponent, { sections, metadata, groupAdditional, groupAdditionalTitle }) as any

  // The customized config is scoped to this render, so parallel exports of the
  // templates cannot read each other's styles. `@react-pdf/renderer` (the
  // layout engine) loads only on the export path — never in the editor bundle
  // — keeping first paint free of the PDF runtime. No AI is involved: this
  // renders the stored sections verbatim.
  const { renderToBuffer } = await import("@react-pdf/renderer")
  const buffer = await runWithPdfConfig(resolvePdfConfig(template, customization), () =>
    renderToBuffer(element)
  )

  return Buffer.from(buffer)
}
