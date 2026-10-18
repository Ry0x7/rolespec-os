/**
 * Where to land after a successful sign-in.
 *
 * `src/proxy.ts` appends the requested path as `?callbackUrl=...` when it bounces
 * an anonymous visitor, so a deep link (e.g. `/extension/connect?state=...`)
 * survives the detour through the sign-in form. That value is
 * attacker-controllable -- it arrives in a query string and is echoed into a
 * hidden form field -- so it is only ever used after passing
 * {@link safeCallbackUrl}.
 *
 * Anything that is not a same-origin path falls back to the dashboard rather than
 * erroring: a mangled callback should not block a valid sign-in.
 */

export const DEFAULT_SIGN_IN_REDIRECT = "/dashboard"

/**
 * Control characters, space and DEL. A leading tab or newline is stripped by URL
 * parsers, so `/\tjavascript:` style values must not survive the check.
 */
const UNSAFE_CHARS = /[\u0000-\u0020\u007f]/

/**
 * Narrows an untrusted callback value to a relative, same-origin path.
 *
 * Rejected: absolute URLs (`https://evil.com`), protocol-relative (`//evil.com`),
 * and the backslash variants browsers normalise to `//` (`/\evil.com`).
 */
export function safeCallbackUrl(
  value: unknown,
  fallback: string = DEFAULT_SIGN_IN_REDIRECT
): string {
  if (typeof value !== "string") return fallback
  if (value.length === 0 || value.length > 2000) return fallback
  if (!value.startsWith("/")) return fallback
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback
  if (UNSAFE_CHARS.test(value)) return fallback
  return value
}
