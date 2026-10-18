// @vitest-environment node
import { describe, it, expect } from "vitest"
import { estimateCostUsd, findModelPrice, formatCostUsd } from "../ai-pricing"

describe("findModelPrice", () => {
  it("takes the longest matching prefix", () => {
    expect(findModelPrice("openai", "gpt-4o-mini-2026-01-01")?.modelPrefix).toBe(
      "gpt-4o-mini",
    )
    expect(findModelPrice("openai", "gpt-4o-2024-08-06")?.modelPrefix).toBe("gpt-4o")
    expect(findModelPrice("openai", "gpt-4.1-mini")?.modelPrefix).toBe("gpt-4.1-mini")
  })

  it("is case-insensitive on both provider and model", () => {
    expect(findModelPrice("OpenAI", "GPT-4O")?.modelPrefix).toBe("gpt-4o")
  })

  it("does not match across providers", () => {
    expect(findModelPrice("anthropic", "gpt-4o")).toBeNull()
  })

  it("returns null for an unknown or empty model", () => {
    expect(findModelPrice("openai", "some-unreleased-model")).toBeNull()
    expect(findModelPrice("openai", "  ")).toBeNull()
  })
})

describe("estimateCostUsd", () => {
  it("prices input and output per million tokens", () => {
    // gpt-4o: $2.50 in / $10.00 out per MTok.
    const cost = estimateCostUsd({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    })
    expect(cost).toBeCloseTo(2.5 + 5, 10)
  })

  it("bills cached input at the cheaper cache-read rate", () => {
    // 1M input of which 1M is a cache read: 1.25 instead of 2.50.
    const cost = estimateCostUsd({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(1.25, 10)
  })

  it("falls back to the input rate when a provider publishes no cache price", () => {
    const cost = estimateCostUsd({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 400_000,
    })
    expect(cost).toBeCloseTo(3, 10)
  })

  it("treats null token counts as zero", () => {
    expect(
      estimateCostUsd({
        provider: "deepseek",
        model: "deepseek-chat",
        inputTokens: null,
        outputTokens: null,
      }),
    ).toBe(0)
  })

  it("never counts more cached tokens than input tokens", () => {
    const cost = estimateCostUsd({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 5_000_000,
    })
    expect(cost).toBeCloseTo(1.25, 10)
  })

  it("returns null for an unknown model and for a local provider", () => {
    expect(
      estimateCostUsd({ provider: "openai", model: "mystery-1", inputTokens: 10 }),
    ).toBeNull()
    expect(
      estimateCostUsd({ provider: "claude-code", model: "sonnet", inputTokens: 10 }),
    ).toBeNull()
    expect(
      estimateCostUsd({ provider: "ollama", model: "qwen2.5vl:7b", inputTokens: 10 }),
    ).toBeNull()
  })

  it("prices the deepseek models apart from each other", () => {
    const chat = estimateCostUsd({
      provider: "deepseek",
      model: "deepseek-chat",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    const reasoner = estimateCostUsd({
      provider: "deepseek",
      model: "deepseek-reasoner",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(chat).toBeCloseTo(0.27 + 1.1, 10)
    expect(reasoner).toBeCloseTo(0.55 + 2.19, 10)
  })

  it("prices the gemini models apart from each other", () => {
    const flashLite = estimateCostUsd({
      provider: "google",
      model: "gemini-2.5-flash-lite",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    const flash = estimateCostUsd({
      provider: "google",
      model: "gemini-2.5-flash",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    const pro = estimateCostUsd({
      provider: "google",
      model: "gemini-2.5-pro",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    // flash-lite must not fall through to the shorter `gemini-2.5-flash` prefix.
    expect(flashLite).toBeCloseTo(0.1 + 0.4, 10)
    expect(flash).toBeCloseTo(0.3 + 2.5, 10)
    expect(pro).toBeCloseTo(1.25 + 10, 10)
  })
})

describe("formatCostUsd", () => {
  it("renders an em-dash placeholder for an unknown cost", () => {
    expect(formatCostUsd(null)).toBe("$—")
  })

  it("keeps sub-cent amounts visible", () => {
    expect(formatCostUsd(0)).toBe("$0.00")
    expect(formatCostUsd(0.0004)).toBe("$0.0004")
    expect(formatCostUsd(1.239)).toBe("$1.24")
  })
})
