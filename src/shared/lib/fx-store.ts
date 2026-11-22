import Decimal from "decimal.js"

import type { Prisma } from "@/generated/prisma/client"

import type { FxRateSet, FxStore } from "./fx"
import { isCurrencyCode, type CurrencyCode } from "./money/currencies"
import { prisma } from "./prisma"

/**
 * Last-known FX rates, persisted.
 *
 * Frankfurter is usually reachable, but a laptop on a plane is not, and a
 * desktop restart must not erase yesterday's reference rate. One row per base
 * currency holds the last accepted set; a later failure reads it and marks it
 * `stale`, so the UI can say "last known" instead of showing nothing.
 *
 * The source string is repeated rather than imported from `./fx` so this module
 * has no runtime dependency on the FX client (and therefore none on the client
 * bundle if one ever imports the formatter).
 */
const SOURCE = "frankfurter"

interface PersistedQuote {
  currency: string
  rate: string
  rateDate: string
}

interface PersistedRates {
  quotes: PersistedQuote[]
}

function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function encode(rates: FxRateSet): Prisma.InputJsonObject {
  return {
    quotes: Object.values(rates.quotes).map((quote): Prisma.InputJsonObject => ({
      currency: quote.currency,
      // A string keeps the rate exact through JSON; floats would round-trip
      // through a double and change the last digit.
      rate: quote.rate.toFixed(),
      rateDate: quote.rateDate,
    })),
  }
}

function decode(base: CurrencyCode, fetchedAt: Date, payload: unknown): FxRateSet | null {
  if (!payload || typeof payload !== "object") return null
  const quotesRaw = (payload as PersistedRates).quotes
  if (!Array.isArray(quotesRaw)) return null

  const quotes: FxRateSet["quotes"] = {}
  for (const entry of quotesRaw) {
    if (!entry || typeof entry !== "object") continue
    if (typeof entry.currency !== "string" || !isCurrencyCode(entry.currency)) continue
    if (!isIsoDay(entry.rateDate)) continue
    try {
      const rate = new Decimal(String(entry.rate))
      if (rate.isFinite() && rate.gt(0)) {
        quotes[entry.currency] = { currency: entry.currency, rate, rateDate: entry.rateDate }
      }
    } catch {
      // A corrupt row is skipped, never repaired into a guess.
    }
  }

  if (Object.keys(quotes).length === 0) return null
  return {
    base,
    source: SOURCE,
    fetchedAt: fetchedAt.toISOString(),
    quotes,
    stale: true,
  }
}

export const prismaFxStore: FxStore = {
  async read(base) {
    const row = await prisma.fxRateSnapshot.findUnique({ where: { base } })
    if (!row || row.source !== SOURCE) return null
    return decode(row.base as CurrencyCode, row.fetchedAt, row.payload)
  },
  async write(rates) {
    await prisma.fxRateSnapshot.upsert({
      where: { base: rates.base },
      create: {
        base: rates.base,
        source: SOURCE,
        fetchedAt: new Date(rates.fetchedAt),
        payload: encode(rates),
      },
      update: {
        source: SOURCE,
        fetchedAt: new Date(rates.fetchedAt),
        payload: encode(rates),
      },
    })
  },
}
