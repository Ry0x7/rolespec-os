// @vitest-environment node
import Decimal from "decimal.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as fxModule from "../fx"
import {
  FX_SOURCE,
  convertForDisplay,
  fxRateCaption,
  fxUnavailableMessage,
  getFxRates,
  resetFxCache,
  type FxRateSet,
  type FxStore,
} from "../fx"

const RATE_DATE = "2026-11-21"

function usdRows() {
  return [
    { base: "USD", quote: "PHP", rate: 56.5, date: RATE_DATE },
    { base: "USD", quote: "JPY", rate: 151.2, date: RATE_DATE },
  ]
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }
}

function mockFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl)
  vi.stubGlobal("fetch", fn)
  return fn
}

function storedSet(): FxRateSet {
  return {
    base: "USD",
    source: FX_SOURCE,
    fetchedAt: `${RATE_DATE}T00:00:00.000Z`,
    stale: true,
    quotes: {
      PHP: { currency: "PHP", rate: new Decimal("55.1"), rateDate: RATE_DATE },
    },
  }
}

function storeWith(rates: FxRateSet | null): FxStore & { write: ReturnType<typeof vi.fn> } {
  return {
    read: async () => rates,
    write: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  resetFxCache()
  delete process.env.FX_TIMEOUT_MS
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetFxCache()
  delete process.env.FX_TIMEOUT_MS
})

describe("getFxRates — success", () => {
  it("returns typed quotes with the published date", async () => {
    mockFetch(async () => jsonResponse(usdRows()))
    const result = await getFxRates("USD", { store: null })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rates.base).toBe("USD")
    expect(result.rates.source).toBe(FX_SOURCE)
    expect(result.rates.stale).toBe(false)
    expect(result.rates.quotes.PHP?.rate.toFixed(1)).toBe("56.5")
    expect(result.rates.quotes.PHP?.rateDate).toBe(RATE_DATE)
    expect(result.rates.quotes.JPY?.currency).toBe("JPY")
  })

  it("asks Frankfurter v2 for every other supported currency", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(usdRows()))
    await getFxRates("USD", { store: null })

    const url = new URL(String((fetchMock.mock.calls[0] as unknown[] | undefined)?.[0]))
    expect(url.pathname).toBe("/v2/rates")
    expect(url.searchParams.get("base")).toBe("USD")
    expect(url.searchParams.get("quotes")).toBe(
      "PHP,EUR,GBP,AUD,CAD,SGD,JPY,INR,AED,SAR,NZD,CHF"
    )
  })

  it("persists the accepted set", async () => {
    mockFetch(async () => jsonResponse(usdRows()))
    const store = storeWith(null)
    await getFxRates("USD", { store })
    expect(store.write).toHaveBeenCalledTimes(1)
    const written = store.write.mock.calls[0]![0] as FxRateSet
    expect(written.quotes.PHP?.rate.toFixed(1)).toBe("56.5")
  })

  it("still returns the rates when persistence fails", async () => {
    mockFetch(async () => jsonResponse(usdRows()))
    const failingStore: FxStore = {
      read: async () => null,
      write: async () => {
        throw new Error("database offline")
      },
    }
    const result = await getFxRates("USD", { store: failingStore })
    expect(result.ok).toBe(true)
  })

  it("drops malformed rows instead of trusting them", async () => {
    mockFetch(async () =>
      jsonResponse([
        { base: "USD", quote: "PHP", rate: 56.5, date: RATE_DATE },
        { base: "EUR", quote: "PHP", rate: 60, date: RATE_DATE },
        { base: "USD", quote: "XXX", rate: 1, date: RATE_DATE },
        { base: "USD", quote: "GBP", rate: 0.8, date: "21/11/2026" },
        { base: "USD", quote: "CHF", rate: 0, date: RATE_DATE },
        { base: "USD", quote: "SGD", rate: "abc", date: RATE_DATE },
        { base: "USD", quote: "USD", rate: 1, date: RATE_DATE },
      ])
    )
    const result = await getFxRates("USD", { store: null })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.rates.quotes)).toEqual(["PHP"])
  })
})

describe("getFxRates — failures", () => {
  it("reports a non-200 and returns the stored last-known set", async () => {
    mockFetch(async () => jsonResponse({}, { ok: false, status: 503 }))
    const result = await getFxRates("USD", { store: storeWith(storedSet()) })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("upstream-error")
    expect(result.lastKnown?.stale).toBe(true)
    expect(result.lastKnown?.quotes.PHP?.rate.toFixed(1)).toBe("55.1")
  })

  it("returns null lastKnown when nothing was ever stored", async () => {
    mockFetch(async () => jsonResponse({}, { ok: false, status: 500 }))
    const result = await getFxRates("USD", { store: storeWith(null) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.lastKnown).toBeNull()
  })

  it("does not fall back to a hard-coded rate on a network error", async () => {
    mockFetch(async () => {
      throw new Error("getaddrinfo ENOTFOUND")
    })
    const result = await getFxRates("USD", { store: null })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("upstream-error")
    expect(result.lastKnown).toBeNull()
    // The fictional fallback this module used to serve must not exist.
    expect(Object.keys(fxModule)).not.toContain("FALLBACK_USD_PHP_RATE")
    expect(Object.keys(fxModule)).not.toContain("getUsdPhpRate")
  })

  it("reports a timeout distinctly", async () => {
    mockFetch(async () => {
      const error = new Error("The operation was aborted due to timeout")
      error.name = "TimeoutError"
      throw error
    })
    const result = await getFxRates("USD", { store: null })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("timeout")
  })

  it("reports a non-array payload as invalid", async () => {
    mockFetch(async () => jsonResponse({ rates: { PHP: 56.5 } }))
    const result = await getFxRates("USD", { store: null })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("invalid-response")
  })

  it("reports an empty usable set as invalid", async () => {
    mockFetch(async () => jsonResponse([{ base: "EUR", quote: "PHP", rate: 60, date: RATE_DATE }]))
    const result = await getFxRates("USD", { store: null })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("invalid-response")
  })

  it("survives a store read failure", async () => {
    mockFetch(async () => jsonResponse({}, { ok: false, status: 500 }))
    const brokenStore: FxStore = {
      read: async () => {
        throw new Error("database offline")
      },
      write: async () => {},
    }
    const result = await getFxRates("USD", { store: brokenStore })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.lastKnown).toBeNull()
  })
})

describe("getFxRates — caching", () => {
  it("serves a second call from cache", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(usdRows()))
    await getFxRates("USD", { store: null, now: 1_000 })
    await getFxRates("USD", { store: null, now: 1_000 + 3_600_000 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("refetches once the 24h success TTL elapses", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(usdRows()))
    await getFxRates("USD", { store: null, now: 0 })
    await getFxRates("USD", { store: null, now: 86_400_001 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("caches a failure for five minutes, then retries", async () => {
    let call = 0
    const fetchMock = mockFetch(async () => {
      call += 1
      return call === 1 ? jsonResponse({}, { ok: false, status: 500 }) : jsonResponse(usdRows())
    })

    const first = await getFxRates("USD", { store: null, now: 1_000_000 })
    expect(first.ok).toBe(false)

    const stillCached = await getFxRates("USD", { store: null, now: 1_299_999 })
    expect(stillCached.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const retried = await getFxRates("USD", { store: null, now: 1_300_001 })
    expect(retried.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("deduplicates concurrent lookups for one base", async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    const fetchMock = mockFetch(
      () => new Promise((resolve) => (resolveFetch = resolve)) as Promise<unknown>
    )

    const pending = getFxRates("USD", { store: null })
    const concurrent = getFxRates("USD", { store: null })
    resolveFetch(jsonResponse(usdRows()))

    const [a, b] = await Promise.all([pending, concurrent])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("convertForDisplay", () => {
  const usdSet: FxRateSet = {
    base: "USD",
    source: FX_SOURCE,
    fetchedAt: `${RATE_DATE}T00:00:00.000Z`,
    stale: false,
    quotes: {
      PHP: { currency: "PHP", rate: new Decimal("56.5"), rateDate: RATE_DATE },
      JPY: { currency: "JPY", rate: new Decimal("151.2"), rateDate: RATE_DATE },
    },
  }

  it("multiplies when the base is the source currency", () => {
    const converted = convertForDisplay(120000, "USD", "PHP", usdSet)
    expect(converted?.amount.toFixed()).toBe("6780000")
    expect(converted?.rate.toFixed(1)).toBe("56.5")
    expect(converted?.inverted).toBe(false)
    expect(converted?.quote.rateDate).toBe(RATE_DATE)
  })

  it("divides when the base is the target currency", () => {
    // Quote semantics: `rate` is units of the quote per one unit of the base,
    // so with USD as base a PHP quote of 0.5 means 0.5 PHP per USD.
    const phpQuoteSet: FxRateSet = {
      ...usdSet,
      base: "USD",
      quotes: { PHP: { currency: "PHP", rate: new Decimal("0.5"), rateDate: RATE_DATE } },
    }
    const converted = convertForDisplay(100, "PHP", "USD", phpQuoteSet)
    expect(converted?.amount.toFixed()).toBe("200")
    expect(converted?.inverted).toBe(true)
    expect(converted?.rate.toFixed()).toBe("2")
  })

  it("returns null for the same currency — there is nothing to convert", () => {
    expect(convertForDisplay(100, "USD", "USD", usdSet)).toBeNull()
  })

  it("returns null without a rate set", () => {
    expect(convertForDisplay(100, "USD", "PHP", null)).toBeNull()
  })

  it("returns null when the base matches neither currency", () => {
    const eurSet: FxRateSet = { ...usdSet, base: "EUR", quotes: {} }
    expect(convertForDisplay(100, "USD", "PHP", eurSet)).toBeNull()
  })

  it("returns null when the needed quote is missing", () => {
    const noPhp: FxRateSet = { ...usdSet, quotes: {} }
    expect(convertForDisplay(100, "USD", "PHP", noPhp)).toBeNull()
  })

  it("returns null rather than dividing by a non-positive stored rate", () => {
    const brokenInverse: FxRateSet = {
      ...usdSet,
      base: "USD",
      quotes: { PHP: { currency: "PHP", rate: new Decimal(0), rateDate: RATE_DATE } },
    }
    expect(convertForDisplay(100, "PHP", "USD", brokenInverse)).toBeNull()

    // The same guard is needed on the multiply path: a corrupt stored rate of 0
    // must not turn every salary into "worth nothing".
    const brokenDirect: FxRateSet = {
      ...usdSet,
      quotes: { PHP: { currency: "PHP", rate: new Decimal(0), rateDate: RATE_DATE } },
    }
    expect(convertForDisplay(100, "USD", "PHP", brokenDirect)).toBeNull()
  })
})

describe("fxRateCaption", () => {
  it("names the day and marks a stale set", () => {
    const quote = {
      currency: "PHP" as const,
      rate: new Decimal("56.5"),
      rateDate: RATE_DATE,
    }
    const fresh: FxRateSet = {
      base: "USD",
      source: FX_SOURCE,
      fetchedAt: `${RATE_DATE}T00:00:00.000Z`,
      stale: false,
      quotes: { PHP: quote },
    }
    expect(fxRateCaption(fresh, quote)).toBe(RATE_DATE)
    expect(fxRateCaption({ ...fresh, stale: true }, quote)).toBe(`${RATE_DATE}, last known`)
  })
})

describe("fxUnavailableMessage", () => {
  it("writes a sentence for every failure reason", () => {
    for (const reason of [
      "invalid-base",
      "timeout",
      "upstream-error",
      "invalid-response",
      "no-rate",
    ] as const) {
      const message = fxUnavailableMessage(reason, "USD", "PHP")
      expect(message.length).toBeGreaterThan(20)
      expect(message).toMatch(/\.$/)
    }
  })

  it("names both currencies where that helps", () => {
    expect(fxUnavailableMessage("no-rate", "USD", "PHP")).toContain("USD→PHP")
  })
})
