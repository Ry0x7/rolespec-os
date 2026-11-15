/** Sliding window for the per-user ATS scan rate limit. */
export const ATS_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
export const ATS_RATE_LIMIT_MAX = 5

/**
 * Hard cap on a caller-supplied job description. Deliberately generous — the
 * prompt truncates far below this (see MAX_RESUME_TEXT_LENGTH in
 * services/ats-analyze.ts); this only stops abusive payloads.
 */
export const MAX_ATS_JOB_DESCRIPTION_LENGTH = 20_000
