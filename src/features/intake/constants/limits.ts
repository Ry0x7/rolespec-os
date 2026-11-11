import type { RateLimitOptions } from "@/shared/lib/rate-limit"

/** One run can read up to six sources; ten runs in ten minutes is generous. */
export const INTAKE_RUN_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 10 * 60 * 1000,
}

/** Uploads are CPU-bound extraction; the same ceiling as the old import path. */
export const INTAKE_UPLOAD_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 10 * 60 * 1000,
}

/** Chat/voice preview is deterministic by default and cheap; AI is opt-in. */
export const INTAKE_CHAT_RATE_LIMIT: RateLimitOptions = {
  max: 40,
  windowMs: 10 * 60 * 1000,
}
