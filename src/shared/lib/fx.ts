import Decimal from "decimal.js"

import { SUPPORTED_CURRENCIES, isCurrencyCode, type CurrencyCode } from "./money/currencies"
import { dec, type DecimalLike } from "./money/money"
import { logger } from "./logger"

/**
 * Exchange rates for **display only**.
 *
 * Salaries are stored in the currency the posting quoted. Comparing them stays
 * rate-free (ranking refuses cross-currency comparisons), because inventing a
 * conversion is a correctness bug. Showing a reader "≈ ₱13.7M a year" is a
 * different job: it is explicitly approximate, it names the rate and the day it
 * came from, and when no rate is available the app says so instead of printing
 * a number.
 *
 * Rates come from Frankfurter v2 (frankfurter.dev), which publishes blended
 * reference rates from central banks. They are daily references, not live
 * quotes — which is exactly the freshness this needs, and why a 24h cache costs
 * nothing.
 *
 * Every path is typed: a caller either gets a rate set with its source and date,
 * or a failure reason plus the last rate set we managed to store. There is no
 * hardcoded fallback rate anywhere in this module or its consumers.
 */

export const FX_SOURCE = "frankfurter"
const FX_URL = "https://api.frankfurter.dev/v2/rates"
const SUCCESS_TTL_MS = 86_400_000
/**
 * Failures are cached too, but briefly: a down or blocked upstream would
 * otherwise make every render pay the full timeout. Five minutes caps that at
 * one slow attempt per instance while keeping recovery quick.
 */
const FAILURE_TTL_MS = 300_000
const FETCH_TIMEOUT_MS = 5_000

export type FxFailureReason =
  | "invalid-base"
  | "timeout"
  | "upstream-error"
  | "invalid-response"
  | "no-rate"

export interface FxQuote {
  currency: CurrencyCode
  /** Units of `currency` per one unit of `base`. */
  rate: Decimal
  /** The day Frankfurter published this particular rate. */
  rateDate: string
}

export interface FxRateSet {
  base: CurrencyCode
  source: typeof FX_SOURCE
  /** When this process (or the stored snapshot) fetched it. */
  fetchedAt: string
  quotes: Partial<Record<CurrencyCode, FxQuote>>
  /** True when this is the persisted last-known set, served after a failure. */
  stale: boolean
}

export type FxResult =
  | { ok: true; rates: FxRateSet }
  | { ok: false; reason: FxFailureReason; lastKnown: FxRateSet | null }

/** Persistence seam, so the module is testable without a database. */
export interface FxStore {
  read(base: CurrencyCode): Promise<FxRateSet | null>
  write(rates: FxRateSet): Promise<void>
}

interface CacheEntry {
  result: FxResult
  expiresAt: number
}

let cache = new Map<CurrencyCode, CacheEntry>()
let inflight = new Map<CurrencyCode, Promise<FxResult>>()

/** Drops the in-memory cache so the next call refetches. Test seam. */
export function resetFxCache(): void {
  cache = new Map()
  inflight = new Map()
}

function timeoutMs(): number {
  const raw = Number(process.env.FX_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : FETCH_TIMEOUT_MS
}

function othersThan(base: CurrencyCode): CurrencyCode[] {
  return SUPPORTED_CURRENCIES.filter((code) => code !== base)
}

interface RawRow {
  date?: unknown
  base?: unknown
  quote?: unknown
  rate?: unknown
}

function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * Validates one Frankfurter row. A row is usable only when it names the base we
 * asked for, a supported quote, a positive finite rate and a calendar date; a
 * malformed row is dropped rather than trusted.
 */
function readRow(row: RawRow, base: CurrencyCode): FxQuote | null {
  if (row.base !== base) return null
  if (typeof row.quote !== "string" || !isCurrencyCode(row.quote)) return null
  if (row.quote === base) return null
  if (!isIsoDay(row.date)) return null
  const rate = typeof row.rate === "number" ? row.rate : Number(row.rate)
  if (!Number.isFinite(rate) || rate <= 0) return null
  return { currency: row.quote, rate: new Decimal(rate), rateDate: row.date }
}

let defaultStore: FxStore | null | undefined

/**
 * Production persistence lives in its own module so the FX client keeps no
 * static Prisma import: tests inject a store, and a server that only formats
 * money never pulls the database client in.
 */
async function loadDefaultStore(): Promise<FxStore | null> {
  if (defaultStore !== undefined) return defaultStore
  try {
    const { prismaFxStore } = await import("./fx-store")
    defaultStore = prismaFxStore
  } catch (err) {
    log.warn("FX persistence is unavailable; rates will not survive a restart", { err })
    defaultStore = null
  }
  return defaultStore
}

const log = logger("fx")

async function fetchRates(base: CurrencyCode): Promise<FxResult> {
  try {
    const url = new URL(FX_URL)
    url.searchParams.set("base", base)
    url.searchParams.set("quotes", othersThan(base).join(","))

    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()) })
    if (!res.ok) {
      log.warn("FX lookup returned a non-200", { status: res.status, base })
      return { ok: false, reason: "upstream-error", lastKnown: null }
    }

    const body: unknown = await res.json()
    if (!Array.isArray(body)) {
      log.warn("FX lookup returned an unexpected shape", { base })
      return { ok: false, reason: "invalid-response", lastKnown: null }
    }

    const quotes: Partial<Record<CurrencyCode, FxQuote>> = {}
    for (const row of body as RawRow[]) {
      const quote = readRow(row, base)
      if (quote) quotes[quote.currency] = quote
    }
    if (Object.keys(quotes).length === 0) {
      log.warn("FX lookup returned no usable rows", { base })
      return { ok: false, reason: "invalid-response", lastKnown: null }
    }

    return {
      ok: true,
      rates: {
        base,
        source: FX_SOURCE,
        fetchedAt: new Date().toISOString(),
        quotes,
        stale: false,
      },
    }
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
    log.warn(timedOut ? "FX lookup timed out" : "FX lookup failed", { base, err })
    return { ok: false, reason: timedOut ? "timeout" : "upstream-error", lastKnown: null }
  }
}

/**
 * Current rates with `base` as the unit. Always resolves: a failure carries the
 * reason and, when one exists, the last set we stored, marked `stale`.
 *
 * `store` is injectable for tests; production uses the `fx_rate_snapshots` row
 * so a restart (or an offline laptop) still has yesterday's reference rate.
 */
export async function getFxRates(
  base: CurrencyCode,
  options: { store?: FxStore | null; now?: number } = {}
): Promise<FxResult> {
  const now = options.now ?? Date.now()
  const cached = cache.get(base)
  if (cached && now < cached.expiresAt) return cached.result

  const pending = inflight.get(base)
  if (pending) return pending

  const run = (async (): Promise<FxResult> => {
    const store = options.store === undefined ? await loadDefaultStore() : options.store
    const fetched = await fetchRates(base)

    if (fetched.ok) {
      cache.set(base, { result: fetched, expiresAt: now + SUCCESS_TTL_MS })
      if (store) {
        try {
          await store.write(fetched.rates)
        } catch (err) {
          log.warn("Could not persist the FX rate set", { base, err })
        }
      }
      return fetched
    }

    let lastKnown: FxRateSet | null = null
    if (store) {
      try {
        lastKnown = await store.read(base)
      } catch (err) {
        log.warn("Could not read the stored FX rate set", { base, err })
      }
    }
    const result: FxResult = { ok: false, reason: fetched.reason, lastKnown }
    cache.set(base, { result, expiresAt: now + FAILURE_TTL_MS })
    return result
  })()

  inflight.set(base, run)
  try {
    return await run
  } finally {
    inflight.delete(base)
  }
}

/**
 * Converts an amount for display. Returns `null` when the set has no usable
 * path between the two currencies — the caller shows the original figure and
 * says a rate is unavailable, rather than a number from nowhere.
 */
export function convertForDisplay(
  amount: DecimalLike,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: FxRateSet | null
): { amount: Decimal; rate: Decimal; quote: FxQuote; inverted: boolean } | null {
  if (from === to) return null
  if (!rates) return null

  if (rates.base === from) {
    const quote = rates.quotes[to]
    // A non-positive or non-finite rate is corrupt data, not a conversion. The
    // inverted branch always guarded this; the base branch did not, so a stored
    // 0 turned every salary into 0.
    if (!quote || !quote.rate.isFinite() || quote.rate.lte(0)) return null
    return { amount: dec(amount).mul(quote.rate), rate: quote.rate, quote, inverted: false }
  }

  if (rates.base === to) {
    const quote = rates.quotes[from]
    if (!quote || quote.rate.lte(0)) return null
    // `quote.rate` is units of `from` per one unit of `to`.
    return {
      amount: dec(amount).div(quote.rate),
      rate: new Decimal(1).div(quote.rate),
      quote,
      inverted: true,
    }
  }

  return null
}

/** One sentence for the UI when a conversion could not be shown. */
export function fxUnavailableMessage(
  reason: FxFailureReason,
  from: CurrencyCode,
  to: CurrencyCode
): string {
  switch (reason) {
    case "invalid-base":
      return `No rate can be requested with ${to} as the base currency.`
    case "timeout":
      return `The ${from}→${to} rate did not arrive in time, so no equivalent is shown.`
    case "upstream-error":
      return `Exchange rates are unreachable right now, so no ${from}→${to} equivalent is shown.`
    case "invalid-response":
      return `The ${from}→${to} rate could not be read, so no equivalent is shown.`
    case "no-rate":
      return `There is no ${from}→${to} reference rate available.`
  }
}

/** `2026-11-22`, plus `last known` when the set is stale. */
export function fxRateCaption(rates: FxRateSet, quote: FxQuote): string {
  const base = `${quote.rateDate}`
  return rates.stale ? `${base}, last known` : base
}
