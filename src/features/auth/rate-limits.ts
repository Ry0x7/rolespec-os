import type { RateLimitOptions } from "@/shared/lib/rate-limit"

/**
 * Sliding windows for the credential endpoints. Shared by `signInAction` (which
 * checks them to produce the friendly message) and by the Credentials provider's
 * `authorize` (which enforces them on the raw `/api/auth/callback/credentials`
 * route). Both must use the same numbers or the two layers disagree.
 */
export const SIGN_IN_RATE_LIMIT: RateLimitOptions = { max: 10, windowMs: 15 * 60 * 1000 }

/** Looser, keyed on the client IP: caps spraying across many email addresses. */
export const SIGN_IN_IP_RATE_LIMIT: RateLimitOptions = { max: 30, windowMs: 15 * 60 * 1000 }

/**
 * Password reset requests, keyed on the submitted address. Tight, because each
 * one sends mail to a third party: an unthrottled endpoint is a way to flood
 * someone else's inbox from our domain, which costs sender reputation.
 */
export const PASSWORD_RESET_REQUEST_RATE_LIMIT: RateLimitOptions = {
  max: 3,
  windowMs: 60 * 60 * 1000,
}

/** Keyed on the client IP: caps walking a list of addresses. */
export const PASSWORD_RESET_REQUEST_IP_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 60 * 60 * 1000,
}
