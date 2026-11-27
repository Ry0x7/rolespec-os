"use server"

import { auth } from "@/features/auth/config"
import { canonicalizeUrl } from "@/features/discovery/services/normalize.service"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_MESSAGE, consumeRateLimit } from "@/shared/lib/rate-limit"
import type { RateLimitOptions } from "@/shared/lib/rate-limit"

import { customClientService, findClientService } from "../data/services"
import { buildClientSearchLinks, type ClientSearchLink } from "../lib/client-search-links"
import { clientLeadSearchSchema, type ClientLeadSearchInput } from "../schemas/client-search.schema"
import { searchClientLeads, type ClientLead, type ClientSourceReport } from "../services/client-leads.service"

const log = logger("clients")

/** Each search fans out to a few public sources; this keeps it polite. */
const CLIENT_LEAD_RUN_RATE_LIMIT: RateLimitOptions = { max: 10, windowMs: 10 * 60 * 1000 }

export interface SavedLeadRef {
  /** The tracked application this lead already became, so the row can link to it. */
  applicationId: string
}

export interface FindClientLeadsResult {
  serviceLabel: string
  leads: Array<ClientLead & { saved?: SavedLeadRef }>
  /** Relevant leads found; more than `leads.length` when the list was cut. */
  matchedCount: number
  unrelatedCount: number
  sources: ClientSourceReport[]
  links: ClientSearchLink[]
}

/**
 * Finds public client posts for one service. Nothing is written: a lead becomes
 * a tracked opportunity only when the user saves it.
 */
export async function findClientLeads(
  input: ClientLeadSearchInput
): Promise<FindClientLeadsResult | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  const userId = session.user.id

  const parsed = clientLeadSearchSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid search" }
  const { serviceId, customService, arrangement, location } = parsed.data

  const service =
    serviceId === "custom" ? customClientService(customService ?? "") : findClientService(serviceId)
  if (!service) return { error: "Choose a service to find clients for." }

  if (!(await consumeRateLimit(RATE_LIMIT_BUCKETS.CLIENT_LEAD_RUN, userId, CLIENT_LEAD_RUN_RATE_LIMIT))) {
    return { error: RATE_LIMIT_MESSAGE }
  }

  const links = buildClientSearchLinks({ service, arrangement, location })
  let result: Awaited<ReturnType<typeof searchClientLeads>>
  try {
    result = await searchClientLeads({ service, arrangement, location })
  } catch (err) {
    log.error("Client lead search failed", { err, userId })
    return { error: "Could not search for clients right now. The links below still work." }
  }

  // Mark leads the user already tracks, read against their own jobs only.
  const savedByUrl = new Map<string, string>()
  if (result.leads.length > 0) {
    try {
      const existing = await prisma.job.findMany({
        where: {
          userId,
          OR: [
            { canonicalUrl: { in: result.leads.map((lead) => lead.canonicalUrl).filter(Boolean) } },
            { url: { in: result.leads.map((lead) => lead.url) } },
          ],
        },
        select: {
          canonicalUrl: true,
          url: true,
          applications: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
        },
      })
      for (const job of existing) {
        const applicationId = job.applications[0]?.id
        if (!applicationId) continue
        if (job.canonicalUrl) savedByUrl.set(job.canonicalUrl, applicationId)
        if (job.url) savedByUrl.set(canonicalizeUrl(job.url) || job.url, applicationId)
      }
    } catch (err) {
      // Worst case a Save button shows on a saved lead; saving dedupes again.
      log.warn("Could not check for already-saved leads", { err, userId })
    }
  }

  return {
    serviceLabel: service.label,
    leads: result.leads.map((lead) => {
      const applicationId = savedByUrl.get(lead.canonicalUrl) ?? savedByUrl.get(lead.url)
      return applicationId ? { ...lead, saved: { applicationId } } : lead
    }),
    matchedCount: result.matchedCount,
    unrelatedCount: result.unrelatedCount,
    sources: result.sources,
    links,
  }
}
