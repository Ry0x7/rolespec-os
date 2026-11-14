/** Sliding window for the per-user, per-kind profile rating rate limit. */
export const PROFILE_RATING_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
export const PROFILE_RATING_RATE_LIMIT_MAX = 5

/** Same truncation budget the ATS analyzer uses before hitting the model. */
export const PROFILE_RATING_MAX_TEXT_LENGTH = 6000

/** Fallback copy when a run fails without a code the UI knows. */
export const GENERIC_ERROR = "Something went wrong. Please try again."

/** Codes worth a toast on top of the inline message. */
export function isNoisyCode(code: string | undefined): boolean {
  return code === "RATE_LIMITED"
}
