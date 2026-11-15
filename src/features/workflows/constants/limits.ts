import type { RateLimitOptions } from "@/shared/lib/rate-limit"

/** Creating a run writes the whole step set; keep it to deliberate attempts. */
export const WORKFLOW_CREATE_RATE_LIMIT: RateLimitOptions = {
  max: 20,
  windowMs: 10 * 60 * 1000,
}

/** Advance/pause/resume are cheap row updates, so the limit is looser. */
export const WORKFLOW_ADVANCE_RATE_LIMIT: RateLimitOptions = {
  max: 120,
  windowMs: 10 * 60 * 1000,
}
