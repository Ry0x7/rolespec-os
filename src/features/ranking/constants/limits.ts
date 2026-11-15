import type { RateLimitOptions } from "@/shared/lib/rate-limit"

/**
 * Ranking is a read over the user's own saved jobs. The optional AI rerank is
 * the only cost, so the limit is looser than discovery but still bounded.
 */
export const RANKING_RUN_RATE_LIMIT: RateLimitOptions = {
  max: 30,
  windowMs: 10 * 60 * 1000,
}
