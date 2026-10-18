import type { RateLimitOptions } from "@/shared/lib/rate-limit"

/**
 * Discovery buckets that belong to this feature rather than to the shared
 * settings constants.
 *
 * `consumeRateLimit` takes a plain bucket string — the map in
 * `@/shared/lib/rate-limit` exists to keep spelling honest for buckets several
 * features share, and this one has exactly one caller.
 */

/** Company → board probe, keyed on the user id. */
export const DISCOVERY_PROBE_BOARDS_BUCKET = "discovery:probe-boards"

/**
 * One probe fans out to at most four candidate slugs × three ATS list
 * endpoints, so it is the widest third-party fan-out a single click can cause —
 * tighter than "Add by URL" for that reason, and loose enough to try a handful
 * of spellings of a company name in one sitting.
 */
export const DISCOVERY_PROBE_BOARDS_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 10 * 60 * 1000,
}
