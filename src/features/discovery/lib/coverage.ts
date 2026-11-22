import { parseStoredSalary } from "@/features/ranking/salary"

import type { MarketFit } from "../services/market-fit.service"

/**
 * What a discovery run actually knew, counted rather than implied.
 *
 * Pay is split into three honest states: a posting fact (`stated`), a parse of
 * that fact (`parsed`, an inference), and nothing (`unknown`). Regional
 * eligibility is likewise known/restricted/unknown. Freshness and dedupe are
 * counted so "we found 80 postings" cannot hide 40 repeats or 60 undated rows.
 */
export interface DiscoveryCoverage {
  received: number
  unique: number
  duplicatesRemoved: number
  unreadable: number
  pay: {
    stated: number
    parsed: number
    unknown: number
  }
  regionalEligibility: {
    known: number
    restricted: number
    unknown: number
  }
  freshness: {
    dated: number
    fresh: number
    stale: number
    undated: number
  }
  /** Candidates carrying an explicit verdict from the user. */
  userFeedback: number
}

export interface CoverageCandidate {
  salaryText?: string | null
  postedAt?: string | Date | null
  qualification: { marketFit: { fit: MarketFit } }
  feedback?: string | null
}

const FRESH_DAYS = 14
const STALE_DAYS = 30
const DAY_MS = 86_400_000

function ageDays(postedAt: string | Date, now: Date): number | null {
  const time = postedAt instanceof Date ? postedAt.getTime() : new Date(postedAt).getTime()
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.floor((now.getTime() - time) / DAY_MS))
}

export function buildDiscoveryCoverage(input: {
  candidates: readonly CoverageCandidate[]
  received: number
  duplicatesRemoved: number
  unreadable: number
  now: Date
}): DiscoveryCoverage {
  const coverage: DiscoveryCoverage = {
    received: input.received,
    unique: input.candidates.length,
    duplicatesRemoved: input.duplicatesRemoved,
    unreadable: input.unreadable,
    pay: { stated: 0, parsed: 0, unknown: 0 },
    regionalEligibility: { known: 0, restricted: 0, unknown: 0 },
    freshness: { dated: 0, fresh: 0, stale: 0, undated: 0 },
    userFeedback: 0,
  }

  for (const candidate of input.candidates) {
    if (candidate.salaryText?.trim()) {
      coverage.pay.stated += 1
      const parsed = parseStoredSalary({ salaryText: candidate.salaryText })
      if (parsed && (parsed.min !== null || parsed.max !== null)) coverage.pay.parsed += 1
    } else {
      coverage.pay.unknown += 1
    }

    const fit = candidate.qualification.marketFit.fit
    if (fit === "UNKNOWN") coverage.regionalEligibility.unknown += 1
    else {
      coverage.regionalEligibility.known += 1
      if (fit === "RESTRICTED") coverage.regionalEligibility.restricted += 1
    }

    if (!candidate.postedAt) {
      coverage.freshness.undated += 1
    } else {
      const days = ageDays(candidate.postedAt, input.now)
      if (days === null) {
        coverage.freshness.undated += 1
      } else {
        coverage.freshness.dated += 1
        if (days <= FRESH_DAYS) coverage.freshness.fresh += 1
        else if (days > STALE_DAYS) coverage.freshness.stale += 1
      }
    }

    if (candidate.feedback) coverage.userFeedback += 1
  }

  return coverage
}
