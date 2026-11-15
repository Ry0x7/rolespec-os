import {
  mapGitHubToCareerFacts,
  scanGitHub,
  WebSourceError,
} from "@/features/career-profile/services/web-presence.service"
import { webFactsToDrafts, webScanWarnings } from "../lib/web-facts-patches"
import { IntakeAdapterError } from "../types"
import type { IntakeAdapter } from "../types"

function asMessage(error: unknown): IntakeAdapterError {
  if (error instanceof WebSourceError) {
    if (error.code === "RATE_LIMITED") {
      return new IntakeAdapterError(
        "SOURCE_UNAVAILABLE",
        "GitHub is rate limiting public requests. Try again later, or add projects manually."
      )
    }
    if (error.code === "INVALID_URL" || error.code === "NOT_FOUND" || error.code === "BLOCKED_HOST") {
      return new IntakeAdapterError("INVALID_INPUT", error.message)
    }
    return new IntakeAdapterError("SOURCE_UNAVAILABLE", error.message)
  }
  return new IntakeAdapterError(
    "SOURCE_UNAVAILABLE",
    "GitHub could not be read. Try again later, or add projects manually."
  )
}

/**
 * Reads only public data from GitHub's API. There is no token, no private
 * repository access and no attempt to get around a rate limit.
 */
export const githubIntakeAdapter: IntakeAdapter = {
  source: "GITHUB",
  label: "GitHub",
  async run({ input, signal, reportProgress }) {
    if (input.consent !== true) {
      throw new IntakeAdapterError(
        "INVALID_INPUT",
        "Reading GitHub requires explicit permission for this run."
      )
    }
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }
    const url = typeof input.url === "string" ? input.url.trim() : ""
    if (!url) throw new IntakeAdapterError("INVALID_INPUT", "Enter a GitHub profile URL.")

    await reportProgress(15, "Reading public GitHub profile")
    let scan
    try {
      scan = await scanGitHub(url)
    } catch (error) {
      throw asMessage(error)
    }
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }

    await reportProgress(65, "Matching repositories and languages")
    const fetchedAt = new Date().toISOString()
    const facts = mapGitHubToCareerFacts(scan, new Date(fetchedAt))
    const drafts = webFactsToDrafts(facts, {
      adapter: "github-public",
      sourceUrl: scan.profile.htmlUrl,
      fetchedAt,
      externalId: scan.profile.login,
      confidence: 70,
    })

    await reportProgress(100, "GitHub facts ready")
    return {
      patches: drafts,
      warnings: webScanWarnings(facts.evidence.length, facts.capabilities.length),
      meta: {
        login: scan.profile.login,
        repositoryCount: scan.repositories.length,
        publicRepos: scan.profile.publicRepos,
      },
    }
  },
}
