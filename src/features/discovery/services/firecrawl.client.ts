/**
 * Minimal Firecrawl REST client for job discovery. No AI, no heavy SDK —
 * plain fetch against the Firecrawl v1 API.
 *
 * Two operations:
 * - `firecrawlSearch`: `/v1/search` for a role query → list of hits (url/title/description).
 * - `firecrawlScrape`: `/v1/scrape` for one posting URL → markdown/html of the page.
 *
 * Both return null when `FIRECRAWL_API_KEY` is missing so callers fall back to
 * the direct-fetch pipeline. Results are cached in-memory for 15 minutes and
 * failures are never cached.
 */

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const searchCache = new Map<string, CacheEntry<FirecrawlHit[]>>();
const scrapeCache = new Map<string, CacheEntry<string>>();

function apiKey(): string | null {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  return key ? key : null;
}

/** True when the Firecrawl path can run at all. */
export function isFirecrawlConfigured(): boolean {
  return apiKey() !== null;
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  // Small bound so one run cannot grow the map without limit.
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

/** Test seam — clears the in-memory caches between cases. */
export function clearFirecrawlCache(): void {
  searchCache.clear();
  scrapeCache.clear();
}

export interface FirecrawlHit {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function mapSearchBody(body: unknown): FirecrawlHit[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  const list = Array.isArray(data) ? data : (body as { results?: unknown }).results;
  if (!Array.isArray(list)) return [];
  const hits: FirecrawlHit[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const url = asString((item as Record<string, unknown>).url);
    if (!url) continue;
    hits.push({
      url,
      title: asString((item as Record<string, unknown>).title),
      description:
        asString((item as Record<string, unknown>).description) ??
        asString((item as Record<string, unknown>).snippet),
      markdown: asString((item as Record<string, unknown>).markdown),
    });
  }
  return hits;
}

/**
 * Search the web for postings matching `query`. Paginates up to two pages
 * (`limit` per page, Firecrawl `page` param) and concatenates. Returns null
 * when unconfigured; returns [] on any failure so a dead source costs an
 * empty list, never an error screen.
 */
export async function firecrawlSearch(
  query: string,
  limit: number,
  signal: AbortSignal
): Promise<FirecrawlHit[] | null> {
  const key = apiKey();
  if (!key) return null;
  const term = query.trim();
  if (!term) return [];

  const cacheKey = `search:${term.toLowerCase()}:${limit}`;
  const cached = getCached(searchCache, cacheKey);
  if (cached) return cached;

  const out: FirecrawlHit[] = [];
  try {
    for (let page = 1; page <= 2; page += 1) {
      const response = await fetch(`${FIRECRAWL_BASE}/search`, {
        method: "POST",
        signal,
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ query: term, limit, page }),
      });
      if (!response.ok) break;
      const body: unknown = await response.json().catch(() => null);
      const hits = mapSearchBody(body);
      if (hits.length === 0) break;
      out.push(...hits);
      if (hits.length < limit) break;
      if (out.length >= limit * 2) break;
    }
  } catch {
    return [];
  }

  const sliced = out.slice(0, limit * 2);
  setCached(searchCache, cacheKey, sliced);
  return sliced;
}

/**
 * Scrape one posting URL to markdown (preferred) or HTML. Returns null when
 * unconfigured or when the scrape produced nothing usable. Failures return
 * null so the caller falls back to the direct-fetch pipeline.
 */
export async function firecrawlScrape(
  url: string,
  signal: AbortSignal
): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;

  const cached = getCached(scrapeCache, url);
  if (cached) return cached;

  try {
    const response = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      signal,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ url, formats: ["markdown", "html"] }),
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as {
      data?: { markdown?: unknown; html?: unknown };
    } | null;
    const markdown = asString(body?.data?.markdown);
    const html = asString(body?.data?.html);
    const text = markdown ?? html ?? null;
    if (!text) return null;
    setCached(scrapeCache, url, text);
    return text;
  } catch {
    return null;
  }
}

/**
 * Tiny concurrency limiter (p-limit equivalent, no dependency). Runs at most
 * `concurrency` promises at once, keeps input order in the output.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        out[index] = await fn(items[index] as T, index);
      }
    }
  );
  await Promise.all(workers);
  return out;
}
