/**
 * Public list prices per million tokens — estimates as of 2026-08; update as
 * providers change pricing. Used only to show a user their own approximate
 * spend: nothing here is stored, and the provider's bill is authoritative.
 */

export interface ModelPrice {
  provider: string
  /** Matched case-insensitively against the start of the model id; longest wins. */
  modelPrefix: string
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  /** Cache-read input price, when the provider bills those separately. */
  cachedInputUsdPerMTok?: number
}

export const MODEL_PRICES: ModelPrice[] = [
  // OpenAI
  { provider: "openai", modelPrefix: "gpt-4o-mini", inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6, cachedInputUsdPerMTok: 0.075 },
  { provider: "openai", modelPrefix: "gpt-4o", inputUsdPerMTok: 2.5, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 1.25 },
  { provider: "openai", modelPrefix: "gpt-4.1-mini", inputUsdPerMTok: 0.4, outputUsdPerMTok: 1.6, cachedInputUsdPerMTok: 0.1 },
  { provider: "openai", modelPrefix: "gpt-4.1", inputUsdPerMTok: 2, outputUsdPerMTok: 8, cachedInputUsdPerMTok: 0.5 },
  { provider: "openai", modelPrefix: "o3", inputUsdPerMTok: 2, outputUsdPerMTok: 8, cachedInputUsdPerMTok: 0.5 },
  // Anthropic
  { provider: "anthropic", modelPrefix: "claude-opus", inputUsdPerMTok: 15, outputUsdPerMTok: 75 },
  { provider: "anthropic", modelPrefix: "claude-sonnet", inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
  { provider: "anthropic", modelPrefix: "claude-haiku", inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  // DeepSeek
  { provider: "deepseek", modelPrefix: "deepseek-reasoner", inputUsdPerMTok: 0.55, outputUsdPerMTok: 2.19, cachedInputUsdPerMTok: 0.14 },
  { provider: "deepseek", modelPrefix: "deepseek-chat", inputUsdPerMTok: 0.27, outputUsdPerMTok: 1.1, cachedInputUsdPerMTok: 0.07 },
  // Google Gemini
  { provider: "google", modelPrefix: "gemini-2.5-flash-lite", inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.4, cachedInputUsdPerMTok: 0.025 },
  { provider: "google", modelPrefix: "gemini-2.5-flash", inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5, cachedInputUsdPerMTok: 0.075 },
  { provider: "google", modelPrefix: "gemini-2.5-pro", inputUsdPerMTok: 1.25, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 0.31 },
]

const PER_MILLION = 1_000_000

export interface EstimateCostInput {
  provider: string
  model: string
  inputTokens?: number | null
  outputTokens?: number | null
  /** Subset of `inputTokens` that was a cache read, when the provider reports it. */
  cachedInputTokens?: number | null
}

/**
 * Finds the price row for a provider/model pair. Longest matching prefix wins,
 * so `gpt-4o-mini` never falls through to the `gpt-4o` row.
 */
export function findModelPrice(provider: string, model: string): ModelPrice | null {
  const providerKey = provider.trim().toLowerCase()
  const modelKey = model.trim().toLowerCase()
  if (!modelKey) return null

  let best: ModelPrice | null = null
  for (const price of MODEL_PRICES) {
    if (price.provider !== providerKey) continue
    if (!modelKey.startsWith(price.modelPrefix)) continue
    if (best === null || price.modelPrefix.length > best.modelPrefix.length) {
      best = price
    }
  }
  return best
}

/**
 * Estimated USD cost of one call. Returns null for a model with no price row —
 * unknown ids and every local provider — so callers can render "unknown" rather
 * than a wrong zero.
 *
 * Cached input tokens are billed at the cheaper cache-read rate when the
 * provider publishes one, and are assumed to be part of `inputTokens`.
 */
export function estimateCostUsd(input: EstimateCostInput): number | null {
  const price = findModelPrice(input.provider, input.model)
  if (!price) return null

  const outputTokens = Math.max(input.outputTokens ?? 0, 0)
  const totalInput = Math.max(input.inputTokens ?? 0, 0)
  const cachedInput = Math.min(Math.max(input.cachedInputTokens ?? 0, 0), totalInput)
  const freshInput = totalInput - cachedInput
  const cachedRate = price.cachedInputUsdPerMTok ?? price.inputUsdPerMTok

  return (
    (freshInput * price.inputUsdPerMTok +
      cachedInput * cachedRate +
      outputTokens * price.outputUsdPerMTok) /
    PER_MILLION
  )
}

/** `$0.0123` style display. Small non-zero amounts never round down to `$0.00`. */
export function formatCostUsd(value: number | null): string {
  if (value === null) return "$—"
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}
