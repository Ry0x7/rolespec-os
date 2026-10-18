import type { RateLimitOptions } from "@/shared/lib/rate-limit"

/**
 * A full export fans out across every user-owned table, so it is the most
 * expensive read a single user can trigger. Generous enough that a failed
 * download can be retried, tight enough that it cannot be used as an
 * amplification lever.
 */
export const DATA_EXPORT_RATE_LIMIT: RateLimitOptions = { max: 5, windowMs: 15 * 60 * 1000 }

/**
 * Account deletion is irreversible, so the confirmation is deliberately
 * effortful: the user types this word exactly. Kept here so the server action and
 * the form cannot drift apart.
 */
export const DELETE_CONFIRMATION_PHRASE = "DELETE"

/**
 * Minting an API token is cheap, but each one is a long-lived credential. The
 * limit is about stopping a stuck client (or a bored user) from filling the
 * table, not about brute force — the cap on live tokens does that.
 */
export const API_TOKEN_CREATE_RATE_LIMIT: RateLimitOptions = { max: 5, windowMs: 15 * 60 * 1000 }

/**
 * Activation is a signature check, so a wrong key costs nothing to reject — but
 * the endpoint is reachable by any signed-in user, and without a ceiling it
 * would be a free oracle for grinding at forged keys.
 */
export const LICENSE_ACTIVATE_RATE_LIMIT: RateLimitOptions = { max: 10, windowMs: 60 * 60 * 1000 }

/**
 * `POST /api/extension/jobs` writes one row per call, keyed on the token owner.
 * Loose enough for a burst of tabs saved in one sitting, tight enough that a
 * leaked token cannot be used to flood a user's board.
 */
export const EXTENSION_JOBS_RATE_LIMIT: RateLimitOptions = { max: 30, windowMs: 10 * 60 * 1000 }

/**
 * `GET /api/extension/resumes` is a single indexed read with no AI and no write,
 * so it gets the same ceiling as the job write: enough for the picker to refresh
 * freely, low enough that a leaked token cannot poll it in a loop.
 */
export const EXTENSION_RESUMES_RATE_LIMIT: RateLimitOptions = { max: 30, windowMs: 10 * 60 * 1000 }

/**
 * `POST /api/extension/qualify` is a deterministic, AI-free read with no write,
 * batched up to 40 postings per call. A job board page draws badges for every
 * listing it shows, so it is looser than the job write; still per token owner so
 * a leaked token cannot poll it in a loop.
 */
export const EXTENSION_QUALIFY_RATE_LIMIT: RateLimitOptions = { max: 60, windowMs: 10 * 60 * 1000 }

/**
 * `POST /api/extension/cold-email` blocks on an AI call, so it is far tighter
 * than the job write. This exists so a stuck
 * client cannot burn a balance (or a provider quota) in a loop.
 */
export const EXTENSION_COLD_EMAIL_RATE_LIMIT: RateLimitOptions = { max: 10, windowMs: 10 * 60 * 1000 }

/**
 * `POST /api/extension/email-reply` has the same cost-and-AI profile as the
 * outreach route, so it gets the same ceiling on its own bucket.
 */
export const EXTENSION_EMAIL_REPLY_RATE_LIMIT: RateLimitOptions = { max: 10, windowMs: 10 * 60 * 1000 }

/**
 * One discovery run fans out to a request per target role against a free
 * third-party source. The ceiling is about being a good citizen of that source
 * — a user has no reason to re-run a profile-derived search more than a handful
 * of times in ten minutes.
 */
export const DISCOVERY_RUN_RATE_LIMIT: RateLimitOptions = { max: 10, windowMs: 10 * 60 * 1000 }

/**
 * "Add by URL" fetches one page the user pasted, so it gets its own, looser
 * ceiling than a full run — pasting several links in a row is normal use, while
 * anything past this is someone using RoleSpec as a page fetcher.
 */
export const DISCOVERY_ADD_URL_RATE_LIMIT: RateLimitOptions = { max: 20, windowMs: 10 * 60 * 1000 }

/**
 * `POST /api/career-profile/import-linkedin` parses a PDF and then blocks on one
 * extraction call, so it is capped tightly: re-importing the same export more
 * than a handful of times in ten minutes only burns the user's own AI budget.
 */
export const CAREER_IMPORT_RATE_LIMIT: RateLimitOptions = { max: 5, windowMs: 10 * 60 * 1000 }

/**
 * How many live API tokens one user may hold — enough for a few browsers without
 * turning the list into a place where a forgotten credential hides. Lives here
 * rather than in the service so the client form can quote it without pulling the
 * Prisma client into the browser bundle.
 */
export const MAX_ACTIVE_API_TOKENS = 5

/**
 * The expiry options the token form offers. The client sends the key, never a
 * date — the action maps it to a `Date` server-side, so a tampered form cannot
 * mint a token that outlives its stated lifetime.
 *
 * `never` is the default, which is what every token minted before expiry existed
 * already is.
 */
export const API_TOKEN_EXPIRY_CHOICES = {
  "30d": { label: "30 days", days: 30 },
  "90d": { label: "90 days", days: 90 },
  never: { label: "Never", days: null },
} as const

export type ApiTokenExpiryChoice = keyof typeof API_TOKEN_EXPIRY_CHOICES

/**
 * The token name owned by the `/extension/connect` flow. Connecting revokes any
 * live token with this exact name before minting the replacement, so repeated
 * reconnects cannot eat through `MAX_ACTIVE_API_TOKENS`. Lives here rather than
 * in the action because a `"use server"` file may only export async functions.
 */
export const EXTENSION_TOKEN_NAME = "Chrome extension"
