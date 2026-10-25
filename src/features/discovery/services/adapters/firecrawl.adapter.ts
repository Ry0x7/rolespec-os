import { logger } from "@/shared/lib/logger";
import { providerLabel } from "../../constants/providers";
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types";
import { firecrawlSearch, mapWithConcurrency } from "../firecrawl.client";

/**
 * Firecrawl web-search source adapter. No AI required.
 *
 * Each discovery query becomes one `firecrawlSearch` call (paginated inside
 * the client, capped at 2 pages). Hits are mapped straight to `RawPosting`
 * and normalized/deduped downstream like every other source.
 *
 * Graceful when `FIRECRAWL_API_KEY` is missing: `search` returns [] so the
 * run continues on the free adapters. Failures also return [], never throw.
 */

/** Stored on saved jobs as `sourceProvider`. */
export const FIRECRAWL_PROVIDER_ID = "firecrawl";

/** Per-query ceiling (client may return up to 2 pages of this). */
export const FIRECRAWL_RESULT_LIMIT = 15;

/** Keeps one run from hammering the API with parallel searches. */
export const FIRECRAWL_CONCURRENCY = 3;

const log = logger("discovery");

function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  return undefined;
}

function inferCompany(title: string | undefined, url: string): string {
  // Best-effort only: normalization still drops rows without a real company,
  // so a wrong guess here thins the list rather than misfiling a job.
  if (!title) return hostName(url);
  const atParts = title.split(/\s+at\s+/i);
  if (atParts.length >= 2) {
    const company = atParts[atParts.length - 1]?.trim().replace(/\s+[-–|].*$/, "").trim();
    if (company && company.length >= 2 && company.toLowerCase() !== title.toLowerCase()) {
      return company;
    }
  }
  return hostName(url);
}

function hostName(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

function cleanTitle(title: string | undefined, fallback: string): string {
  const cleaned = (title ?? "").replace(/\s+[—–|]\s+.*$/, "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

export function mapFirecrawlHit(
  hit: { url: string; title?: string; description?: string; markdown?: string },
  queryRole: string
): RawPosting | null {
  const url = asText(hit.url);
  if (!url) return null;
  const title = cleanTitle(hit.title, queryRole);
  if (!title) return null;
  const companyName = inferCompany(hit.title, url);
  if (!companyName) return null;
  const description = asText(hit.markdown) ?? asText(hit.description);
  return {
    provider: FIRECRAWL_PROVIDER_ID,
    externalId: url.slice(0, 200),
    title: title.slice(0, 200),
    companyName: companyName.slice(0, 200),
    url: url.slice(0, 2000),
    description,
    raw: { ...hit, queryRole },
  };
}

export const firecrawlAdapter: SourceAdapter = {
  id: FIRECRAWL_PROVIDER_ID,
  label: providerLabel(FIRECRAWL_PROVIDER_ID),

  async search(query, signal) {
    const term = [query.role, ...(query.keywords ?? []).slice(0, 3)]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    if (!term) return [];

    const hits = await firecrawlSearch(`${term} jobs hiring`, FIRECRAWL_RESULT_LIMIT, signal);
    // null = unconfigured → graceful fallback, run continues on free adapters.
    if (hits === null) return [];
    if (hits.length === 0) return [];

    // Cap the mapping work; normalization/dedupe downstream handles the rest.
    const slice = hits.slice(0, FIRECRAWL_RESULT_LIMIT * 2);
    const mapped = await mapWithConcurrency(slice, FIRECRAWL_CONCURRENCY, async (hit) =>
      mapFirecrawlHit(hit, query.role)
    );
    const postings: RawPosting[] = [];
    for (const posting of mapped) {
      if (posting) postings.push(posting);
    }
    if (postings.length === 0) {
      log.info("Firecrawl search produced no mappable postings", { term });
    }
    return postings;
  },
};
