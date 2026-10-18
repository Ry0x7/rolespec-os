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
}
