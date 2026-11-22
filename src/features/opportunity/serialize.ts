import type { OpportunityValue } from "./types"

/**
 * The engine's result with money as exact decimal strings.
 *
 * Server and client components do not share JavaScript objects: a `Decimal`
 * instance crossing that boundary is not supported (React warns, and some
 * values arrive as plain objects with no methods). Strings keep every digit and
 * every consumer formats them with the money helpers.
 */
export type SerializedOpportunityValue = Omit<
  OpportunityValue,
  "compensation" | "hourly"
> & {
  compensation: Omit<
    OpportunityValue["compensation"],
    "min" | "max" | "annualMin" | "annualMax" | "annualMidpoint" | "expectedMidpoint"
  > & {
    min: string | null
    max: string | null
    annualMin: string | null
    annualMax: string | null
    annualMidpoint: string | null
    expectedMidpoint: string | null
  }
  hourly: Omit<OpportunityValue["hourly"], "effectiveHourly" | "expectedHourly"> & {
    effectiveHourly: string | null
    expectedHourly: string | null
  }
}

function moneyString(
  value: OpportunityValue["compensation"]["min"] | undefined
): string | null {
  return value == null ? null : value.toFixed(2)
}

/** Keeps the shape, converts only the money to transport-safe strings. */
export function serializeOpportunityValue(
  value: OpportunityValue
): SerializedOpportunityValue {
  return {
    ...value,
    compensation: {
      ...value.compensation,
      min: moneyString(value.compensation.min),
      max: moneyString(value.compensation.max),
      annualMin: moneyString(value.compensation.annualMin),
      annualMax: moneyString(value.compensation.annualMax),
      annualMidpoint: moneyString(value.compensation.annualMidpoint),
      expectedMidpoint: moneyString(value.compensation.expectedMidpoint),
    },
    hourly: {
      ...value.hourly,
      effectiveHourly: moneyString(value.hourly.effectiveHourly),
      expectedHourly: moneyString(value.hourly.expectedHourly),
    },
  }
}
