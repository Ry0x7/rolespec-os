/**
 * Turns a provider call failure into a message that is safe to show the user.
 *
 * The AI SDKs and local CLIs put a lot of provider-specific detail in their
 * errors (HTTP bodies, command output, file paths). Most of that must stay in
 * the server log. The few cases below are the ones a user can actually fix:
 * sign in, install the CLI, replace a rejected key, or wait out a rate limit.
 *
 * `null` means "nothing actionable known" — callers keep their generic error.
 */

const AUTH_HINTS = [
  "not logged in",
  "not signed in",
  "login required",
  "sign in",
  "unauthorized",
  "invalid api key",
  "incorrect api key",
  "api key not valid",
  "authentication",
  "no credentials",
]

const MISSING_HINTS = ["enoent", "command not found", "not installed", "no such file"]

const RATE_HINTS = ["rate limit", "too many requests", "429", "quota exceeded"]

export function describeAiFailure(err: unknown): string | null {
  const message = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase()
  if (!message) return null

  if (AUTH_HINTS.some((hint) => message.includes(hint))) {
    return "The AI provider is not signed in on this host. Sign in with its CLI, or update the API key in Settings → AI provider, then try again."
  }

  if (MISSING_HINTS.some((hint) => message.includes(hint))) {
    return "The configured AI provider is not installed on this host. Install it, or choose another provider in Settings → AI provider."
  }

  if (RATE_HINTS.some((hint) => message.includes(hint))) {
    return "The AI provider is rate limiting requests. Wait a moment and try again."
  }

  return null
}
