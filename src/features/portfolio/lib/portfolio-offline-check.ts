export interface PortfolioCheck {
  id: string
  label: string
  pass: boolean
  hint: string
}

/**
 * Instant no-AI URL hygiene checklist. Runs fully client-side from the
 * typed URL so the user gets value before (or without) spending an AI call.
 */
export function portfolioOfflineCheck(rawUrl: string): PortfolioCheck[] {
  const url = rawUrl.trim()
  const hasProtocol = /^https:\/\//i.test(url)
  const hasCustomDomain =
    /\.[a-z]{2,}(\/|$)/i.test(url) &&
    !/^(https?:\/\/)?(localhost|127\.|192\.168\.|.*\.local)/i.test(url)
  const looksShareable = url.length > 12 && !/\s/.test(url)
  return [
    {
      id: "https",
      label: "Serves over HTTPS",
      pass: hasProtocol,
      hint: hasProtocol ? "Good — secure by default" : "Add https:// so links never warn",
    },
    {
      id: "domain",
      label: "Public, shareable address",
      pass: hasCustomDomain && looksShareable,
      hint:
        hasCustomDomain && looksShareable
          ? "Ready to put on a resume"
          : "Use a public URL, not localhost or a bare word",
    },
    {
      id: "length",
      label: "Short enough to type",
      pass: url.length > 0 && url.length <= 80,
      hint: url.length > 80 ? "Consider a shorter slug or custom domain" : "Fits on one resume line",
    },
  ]
}
