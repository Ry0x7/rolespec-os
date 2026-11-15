import {
  mapPortfolioToCareerFacts,
  scanPortfolio,
  WebSourceError,
} from "@/features/career-profile/services/web-presence.service"
import { webFactsToDrafts, webScanWarnings } from "../lib/web-facts-patches"
import { IntakeAdapterError } from "../types"
import type { IntakeAdapter } from "../types"

function asMessage(error: unknown): IntakeAdapterError {
  if (error instanceof WebSourceError) {
    if (error.code === "BLOCKED_HOST") {
      return new IntakeAdapterError(
        "RESTRICTED",
        "That address is not public. Only a public portfolio or professional site can be read."
      )
    }
    if (error.code === "INVALID_URL" || error.code === "NOT_FOUND") {
      return new IntakeAdapterError("INVALID_INPUT", error.message)
    }
    return new IntakeAdapterError("SOURCE_UNAVAILABLE", error.message)
  }
  return new IntakeAdapterError(
    "SOURCE_UNAVAILABLE",
    "That site could not be read. Try again later, or add the facts manually."
  )
}

/**
 * Fetches one public page through the existing DNS-pinned, redirect-revalidating
 * fetcher. Private addresses, credentials in URLs and non-HTML responses are
 * rejected before any content is read.
 */
export const webIntakeAdapter: IntakeAdapter = {
  source: "WEB",
  label: "Portfolio / website",
  async run({ input, signal, reportProgress }) {
    if (input.consent !== true) {
      throw new IntakeAdapterError(
        "INVALID_INPUT",
        "Reading a website requires explicit permission for this run."
      )
    }
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }
    const url = typeof input.url === "string" ? input.url.trim() : ""
    if (!url) throw new IntakeAdapterError("INVALID_INPUT", "Enter a website URL.")

    await reportProgress(15, "Fetching public page")
    let scan
    try {
      scan = await scanPortfolio(url)
    } catch (error) {
      throw asMessage(error)
    }
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }

    await reportProgress(65, "Reading projects and technologies")
    const fetchedAt = new Date().toISOString()
    const facts = mapPortfolioToCareerFacts(scan, new Date(fetchedAt))
    const drafts = webFactsToDrafts(facts, {
      adapter: "web-portfolio",
      sourceUrl: scan.url,
      fetchedAt,
      externalId: scan.host,
      confidence: 60,
    })

    await reportProgress(100, "Website facts ready")
    return {
      patches: drafts,
      warnings: webScanWarnings(facts.evidence.length, facts.capabilities.length),
      meta: {
        host: scan.host,
        projectCount: scan.projects.length,
        pageTitle: scan.title,
      },
    }
  },
}
