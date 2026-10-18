/**
 * USD → PHP exchange rate.
 *
 * Salaries are stored in whichever currency the listing quoted, so every display
 * site needs one rate to show the other currency's equivalent. The rate is a
 * nicety, not data: a failed lookup must never break a page, so every failure
 * path returns a usable number instead of throwing.
 *
 * open.er-api.com is keyless and free, and publishes one rate set per day — a
 * 24h in-memory cache therefore costs nothing in freshness and keeps a page of
 * job cards down to a single upstream call per server instance.
 */
import { logger } from "./logger"

const log = logger("fx")

/** Used when the live lookup fails and `FX_USD_PHP_RATE` is unset. */
export const FALLBACK_USD_PHP_RATE = 58

const FX_URL = "https://open.er-api.com/v6/latest/USD"
const CACHE_TTL_MS = 86_400_000
/**
 * Failures are cached too, but only briefly: a down or blocked upstream would
 * otherwise make every render pay the full fetch timeout. Five minutes caps that
 * cost at one slow attempt per instance while keeping recovery quick.
 */
const FAILURE_CACHE_TTL_MS = 300_000
const FETCH_TIMEOUT_MS = 5_000

let cached: { rate: number; expiresAt: number } | null = null

function fallbackRate(): number {
  const fromEnv = Number(process.env.FX_USD_PHP_RATE)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : FALLBACK_USD_PHP_RATE
}

/** Caches the fallback under the short negative TTL and hands it back. */
function cacheFallbackRate(): number {
  const rate = fallbackRate()
  cached = { rate, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS }
  return rate
}

/**
 * Pesos per dollar. Always resolves to a positive number — the fallback is used
 * for a network error, a non-200, or a response whose shape we do not recognise.
 * A failure is cached for five minutes so a broken upstream costs at most one
 * slow attempt per instance in that window; a success is cached for 24h.
 */
export async function getUsdPhpRate(): Promise<number> {
  if (cached && Date.now() < cached.expiresAt) return cached.rate

  try {
    const res = await fetch(FX_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      log.warn("FX lookup returned a non-200", { status: res.status })
      return cacheFallbackRate()
    }

    const body: unknown = await res.json()
    const rate = (body as { rates?: { PHP?: unknown } })?.rates?.PHP
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      log.warn("FX lookup returned an unexpected shape")
      return cacheFallbackRate()
    }

    cached = { rate, expiresAt: Date.now() + CACHE_TTL_MS }
    return rate
  } catch (err) {
    log.warn("FX lookup failed, using the fallback rate", { err })
    return cacheFallbackRate()
  }
}

/** Test seam — drops the cached rate so the next call refetches. */
export function resetUsdPhpRateCache(): void {
  cached = null
}
