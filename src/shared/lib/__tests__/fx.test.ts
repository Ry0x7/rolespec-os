// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { FALLBACK_USD_PHP_RATE, getUsdPhpRate, resetUsdPhpRateCache } from "../fx"

const LIVE_RATE = 56.42

function mockFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl)
  vi.stubGlobal("fetch", fn)
  return fn
}

function okResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body })
}

beforeEach(() => {
  resetUsdPhpRateCache()
  delete process.env.FX_USD_PHP_RATE
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetUsdPhpRateCache()
  delete process.env.FX_USD_PHP_RATE
})

describe("getUsdPhpRate", () => {
  it("returns the live PHP rate", async () => {
    mockFetch(() => okResponse({ rates: { PHP: LIVE_RATE } }))
    expect(await getUsdPhpRate()).toBe(LIVE_RATE)
  })

  it("serves the second call from cache", async () => {
    const fetchMock = mockFetch(() => okResponse({ rates: { PHP: LIVE_RATE } }))

    expect(await getUsdPhpRate()).toBe(LIVE_RATE)
    expect(await getUsdPhpRate()).toBe(LIVE_RATE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("falls back when the request throws", async () => {
    mockFetch(() => Promise.reject(new Error("network down")))
    expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)
  })

  it("falls back on a non-200", async () => {
    mockFetch(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) }))
    expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)
  })

  it("falls back when the payload has no usable rate", async () => {
    mockFetch(() => okResponse({ rates: { PHP: "fifty-eight" } }))
    expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)
  })

  it("prefers FX_USD_PHP_RATE over the hard-coded fallback", async () => {
    process.env.FX_USD_PHP_RATE = "60.5"
    mockFetch(() => Promise.reject(new Error("network down")))
    expect(await getUsdPhpRate()).toBe(60.5)
  })

  it("ignores an unusable FX_USD_PHP_RATE", async () => {
    process.env.FX_USD_PHP_RATE = "not-a-number"
    mockFetch(() => Promise.reject(new Error("network down")))
    expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)
  })

  it("serves the second call from the cached failure without refetching", async () => {
    const fetchMock = mockFetch(() => Promise.reject(new Error("network down")))
    expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)

    fetchMock.mockImplementation(() => okResponse({ rates: { PHP: LIVE_RATE } }))
    expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("caches a non-200 failure too", async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve({ ok: false, status: 503, json: async () => ({}) }),
    )

    expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)
    expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries once the five-minute negative TTL elapses", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = mockFetch(() => Promise.reject(new Error("network down")))
      expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)

      fetchMock.mockImplementation(() => okResponse({ rates: { PHP: LIVE_RATE } }))

      // Still inside the negative TTL: no second attempt.
      vi.advanceTimersByTime(299_000)
      expect(await getUsdPhpRate()).toBe(FALLBACK_USD_PHP_RATE)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(2_000)
      expect(await getUsdPhpRate()).toBe(LIVE_RATE)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps a successful rate cached past the negative TTL", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = mockFetch(() => okResponse({ rates: { PHP: LIVE_RATE } }))
      expect(await getUsdPhpRate()).toBe(LIVE_RATE)

      vi.advanceTimersByTime(600_000)
      expect(await getUsdPhpRate()).toBe(LIVE_RATE)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // ...but not past the 24h success TTL.
      vi.advanceTimersByTime(86_400_000)
      expect(await getUsdPhpRate()).toBe(LIVE_RATE)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
