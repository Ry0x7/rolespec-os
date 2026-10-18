import { renderToBuffer } from "@react-pdf/renderer"
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
  // four templates cannot read each other's styles.
  const buffer = await runWithPdfConfig(resolvePdfConfig(template, customization), () =>
    renderToBuffer(element)
  )

  return Buffer.from(buffer)
}
