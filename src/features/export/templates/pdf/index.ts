import type { ComponentType } from "react"
import { MinimalTemplate } from "./minimal"
import { ModernTemplate } from "./modern"
import { HarvardTemplate } from "./harvard"
import { CorporateTemplate } from "./corporate"
import type { TemplateProps } from "./minimal"

export type { TemplateProps }

export const PDF_TEMPLATES: Record<string, ComponentType<TemplateProps>> = {
  MINIMAL: MinimalTemplate,
  MODERN: ModernTemplate,
  HARVARD: HarvardTemplate,
  CORPORATE: CorporateTemplate,
  // New variants reuse the closest layout renderer. The active PDF config
  // (via AsyncLocalStorage) still carries the variant's own colors/spacing,
  // so export matches the preview without duplicating renderer code.
  EXECUTIVE: CorporateTemplate,
  CREATIVE: ModernTemplate,
  TECH: ModernTemplate,
  ELEGANT: MinimalTemplate,
}
