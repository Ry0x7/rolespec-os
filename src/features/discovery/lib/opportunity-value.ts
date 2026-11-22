import type { SerializedOpportunityValue } from "@/features/opportunity/serialize"

// The serializer itself lives with the engine so saved jobs can use it too;
// this re-export keeps the discovery call sites unchanged.
export { serializeOpportunityValue } from "@/features/opportunity/serialize"
export type { SerializedOpportunityValue } from "@/features/opportunity/serialize"

type ValueCarrier = { opportunityValue?: SerializedOpportunityValue }

/**
 * Splits a run into what the user can act on and what their own settings
 * excluded. The excluded rows keep their reasons — a posting is never dropped
 * without the user being able to see why.
 *
 * Only the user's own pay settings exclude a row here. Eligibility has its own,
 * already-visible mechanism (the qualification verdict and the "ruled out"
 * toggle), and duplicating it would take that decision away from the user.
 */
export function partitionByOpportunityValue<T extends ValueCarrier>(
  candidates: T[]
): { accepted: T[]; excluded: T[] } {
  const accepted: T[] = []
  const excluded: T[] = []
  for (const candidate of candidates) {
    const settingsBlock = candidate.opportunityValue?.rejections.some(
      (rejection) =>
        rejection.severity === "BLOCK" &&
        (rejection.code === "MINIMUM_PAY" || rejection.code === "UNKNOWN_PAY")
    )
    if (settingsBlock) excluded.push(candidate)
    else accepted.push(candidate)
  }
  return { accepted, excluded }
}
