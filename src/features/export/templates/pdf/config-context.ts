import { AsyncLocalStorage } from "node:async_hooks"
import type { TemplateStyleConfig } from "./styles"

/**
 * Carries the customized style config into a PDF template tree.
 *
 * Templates used to close over a module-level config constant, which cannot
 * vary per export. React context is not an option here — these modules are
 * imported from a server action, and `createContext` is client-only in Next.
 * AsyncLocalStorage keeps each `renderToBuffer` call isolated instead, so
 * concurrent exports never read each other's config.
 */
const pdfConfigStorage = new AsyncLocalStorage<TemplateStyleConfig>()

export function runWithPdfConfig<T>(
  config: TemplateStyleConfig,
  fn: () => Promise<T>
): Promise<T> {
  return pdfConfigStorage.run(config, fn)
}

/** Config for the render in flight, or the template's own defaults. */
export function activePdfConfig(fallback: TemplateStyleConfig): TemplateStyleConfig {
  return pdfConfigStorage.getStore() ?? fallback
}
