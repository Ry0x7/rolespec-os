import type { WorkType } from "@/generated/prisma/enums"

/**
 * Job discovery contracts.
 *
 * The pipeline is `Career Profile → query → adapter → RawPosting → normalize →
 * dedupe → candidate → user decision`. Everything below the query is described
 * only by these types, so a source can be swapped without the pipeline knowing
 * which one it is talking to. External posting text is untrusted input: it is
 * never treated as evidence of the user's qualifications and is never executed
 * as instructions.
 */

/** One search a source adapter is asked to run. */
export interface DiscoveryQuery {
  /** The target role title the query is derived from, e.g. "Frontend Engineer". */
  role: string
  /** Optional extra terms an adapter may fold into its own search syntax. */
  keywords?: string[]
}

/**
 * A posting after an adapter has pulled the provider's field names apart, but
 * before any cleaning. Values are still untrusted, unbounded and possibly HTML.
 *
 * The split is deliberate: knowing that Remotive calls a company
 * `company_name` belongs in the adapter, while stripping HTML, capping length,
 * canonicalizing the URL and parsing dates is shared work that must behave
 * identically for every source. `raw` keeps the untouched payload so a future
 * enrichment step does not need the adapter to have guessed what it wants.
 */
export interface RawPosting {
  /** Adapter id that produced this posting, e.g. "remotive". */
  provider: string
  /** The provider's own posting id, as a string. */
  externalId: string
  title: string
  companyName: string
  url: string
  location?: string
  /** The provider's own remote/hybrid/onsite wording, if it has one. */
  workTypeHint?: string
  salaryText?: string
  /** May contain HTML; normalization strips and truncates it. */
  description?: string
  /** Whatever the provider calls a publication date, unparsed. */
  postedAt?: string
  /** The provider's payload, untouched. */
  raw: Record<string, unknown>
}

/** A posting mapped onto RoleSpec's job vocabulary. Still not persisted. */
export interface NormalizedPosting {
  provider: string
  externalId: string
  title: string
  companyName: string
  /** The posting URL as the provider gave it — this is what a user opens. */
  url: string
  /** Comparison key: lowercased host, no fragment, no tracking params. */
  canonicalUrl: string
  location?: string
  workType?: WorkType
  /** Free text; providers rarely give a parseable number. */
  salaryText?: string
  /** Plain text, HTML stripped, capped at the extension's 20k limit. */
  description?: string
  postedAt?: Date
}

/**
 * Per-run, per-user settings an adapter may need. The ATS adapters have no
 * cross-company search endpoint, so they need to be told which boards to scan;
 * every other adapter ignores this.
 */
export interface DiscoveryRunContext {
  atsWatchlist: {
    greenhouse: string[]
    lever: string[]
    ashby: string[]
    bamboohr: string[]
    freshteam: string[]
    /** Board URLs, not slugs: a Workday site needs a tenant, a data centre and a site id. */
    workday: string[]
  }
}

/**
 * A replaceable source. The pipeline depends on this interface only; adding a
 * provider means adding a file, not editing the pipeline.
 */
export interface SourceAdapter {
  /** Stable id stored on saved jobs as `sourceProvider`. */
  id: string
  /** Human label for the provider badge. */
  label: string
  /**
   * Whether this run has what the adapter needs to search at all. Only the ATS
   * adapters implement it: with an empty watchlist section they have no board
   * to ask, so returning nothing is "not set up", not "nothing matched". An
   * adapter without this is always considered configured.
   */
  isConfigured?(context: DiscoveryRunContext): boolean
  /**
   * Runs one search. Must resolve — a provider outage or an unrecognized
   * response shape returns an empty list rather than throwing at the pipeline.
   */
  search(
    query: DiscoveryQuery,
    signal: AbortSignal,
    context: DiscoveryRunContext
  ): Promise<RawPosting[]>
}
