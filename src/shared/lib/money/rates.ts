import { getFxRates, type FxFailureReason, type FxRateSet, type FxStore } from "@/shared/lib/fx"
import type { CurrencyCode } from "@/shared/lib/money/currencies"

/**
 * Display rates for one reader, with the failure reason kept alongside.
 *
 * A page that shows converted pay needs both halves of `FxResult`: the rate set
 * to convert with, and — when the lookup failed — the reason to print instead
 * of a number. Collapsing that into "rates or null" loses the distinction
 * between "still loading" and "the provider is down", which are different
 * sentences on screen.
 *
 * Server-side only: the store is Prisma-backed. Client components receive the
 * resolved set as props.
 */
export interface DisplayRates {
  rates: FxRateSet | null
  failure: FxFailureReason | null
}

export async function loadDisplayRates(
  base: CurrencyCode,
  store?: FxStore | null
): Promise<DisplayRates> {
  const result = await getFxRates(base, store === undefined ? {} : { store })
  if (result.ok) return { rates: result.rates, failure: null }
  return { rates: result.lastKnown, failure: result.reason }
}
