import { assessJobRiskHeuristics } from "@/features/jobs/services/job-risk.service"
import { freelancerAdapter } from "@/features/discovery/services/adapters/freelancer.adapter"
import { onlinejobsAdapter } from "@/features/discovery/services/adapters/onlinejobs.adapter"
import { remotiveAdapter } from "@/features/discovery/services/adapters/remotive.adapter"
import { ADAPTER_FETCH_BUDGET_MS } from "@/features/discovery/services/adapters/fetch-memo"
import { dedupeKey, normalizeBatch } from "@/features/discovery/services/normalize.service"
import type { NormalizedPosting, RawPosting, SourceAdapter } from "@/features/discovery/types"
import { logger } from "@/shared/lib/logger"

import type { ClientService } from "../data/services"
import { scoreClientLead, type ClientArrangement, type LeadScore } from "../lib/lead-score"

const log = logger("clients")

/** The whole search stops waiting after this, whatever the sources do. */
export const CLIENT_SEARCH_TIMEOUT_MS = 12_000

/** Most leads returned to the page, best first. */
export const MAX_CLIENT_LEADS = 40

/**
 * Sources that publish work a freelancer or remote worker can take on. The ATS
 * company boards are left out on purpose: they list employees, not clients.
 * Remotive and OnlineJobs.ph are remote-only, so an on-site search asks only
 * Freelancer.com, whose projects can be local.
 */
export function clientSourcesFor(arrangement: ClientArrangement): readonly SourceAdapter[] {
  return arrangement === "ONSITE" ? [freelancerAdapter] : [freelancerAdapter, remotiveAdapter, onlinejobsAdapter]
}

const NO_WATCHLIST = {
  atsWatchlist: { greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] },
}

export interface ClientLead extends Omit<NormalizedPosting, "postedAt"> {
  /** ISO string, so the lead can cross the server-action boundary. */
  postedAt?: string
  key: string
  fit: LeadScore
}

export interface ClientSourceReport {
  provider: string
  label: string
  count: number
  status: "ok" | "timeout" | "error"
}

export interface ClientLeadSearchResult {
  leads: ClientLead[]
  /** Posts the sources returned that never mention the service. */
  unrelatedCount: number
  sources: ClientSourceReport[]
}

/**
 * Asks each client source for each of the service's queries, normalizes and
 * dedupes the posts, and scores every one against the service. Never throws for
 * a source failure: a dead source reports itself and contributes nothing.
 */
export async function searchClientLeads(input: {
  service: ClientService
  arrangement: ClientArrangement
  location?: string
  now?: Date
}): Promise<ClientLeadSearchResult> {
  const adapters = clientSourcesFor(input.arrangement)
  const queries = input.service.queries.slice(0, 3).map((role) => ({ role }))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CLIENT_SEARCH_TIMEOUT_MS)
  const statuses = new Map<string, ClientSourceReport["status"]>()
  let raw: RawPosting[] = []

  try {
    // Every query of one search shares one signal, which is how OnlineJobs.ph
    // knows to answer only the first query and respect its crawl delay.
    const settled = await Promise.allSettled(
      adapters.flatMap((adapter) =>
        queries.map(async (query) => {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(ADAPTER_FETCH_BUDGET_MS)])
          try {
            const postings = await adapter.search(query, signal, NO_WATCHLIST)
            if (signal.aborted) statuses.set(adapter.id, "timeout")
            else if (!statuses.has(adapter.id)) statuses.set(adapter.id, "ok")
            return postings
          } catch (err) {
            statuses.set(adapter.id, "error")
            throw err
          }
        })
      )
    )
    for (const result of settled) {
      if (result.status === "fulfilled") raw = raw.concat(result.value)
      else log.warn("A client source rejected", { err: result.reason })
    }
  } finally {
    clearTimeout(timer)
  }

  const normalized = normalizeBatch(raw).postings
  const now = input.now ?? new Date()
  let unrelatedCount = 0
  const leads: ClientLead[] = []

  for (const posting of normalized) {
    let risk: ReturnType<typeof assessJobRiskHeuristics> = null
    try {
      risk = assessJobRiskHeuristics({
        jobTitle: posting.title,
        companyName: posting.companyName,
        jobDescription: posting.description,
        jobLink: posting.url,
        location: posting.location,
      })
    } catch (err) {
      log.warn("Lead risk check failed", { err })
    }
    const fit = scoreClientLead(posting, {
      service: input.service,
      arrangement: input.arrangement,
      location: input.location,
      risk,
      now,
    })
    if (!fit.relevant) {
      unrelatedCount += 1
      continue
    }
    // An on-site search must not fill up with remote posts it cannot use.
    if (input.arrangement === "ONSITE" && posting.workType === "REMOTE") {
      unrelatedCount += 1
      continue
    }
    leads.push({ ...posting, postedAt: posting.postedAt?.toISOString(), key: dedupeKey(posting), fit })
  }

  leads.sort(
    (a, b) =>
      b.fit.score - a.fit.score ||
      (b.postedAt ?? "").localeCompare(a.postedAt ?? "") ||
      a.title.localeCompare(b.title)
  )

  const counts = new Map<string, number>()
  for (const lead of leads) counts.set(lead.provider, (counts.get(lead.provider) ?? 0) + 1)

  return {
    leads: leads.slice(0, MAX_CLIENT_LEADS),
    unrelatedCount,
    sources: adapters.map((adapter) => ({
      provider: adapter.id,
      label: adapter.label,
      count: counts.get(adapter.id) ?? 0,
      status: statuses.get(adapter.id) ?? "ok",
    })),
  }
}
