/**
 * Client-IP extraction from proxy headers. Kept pure and header-shape agnostic so
 * it works with a `Request`'s `Headers`, Next's `headers()` store, or any
 * `{ get(name) }` lookalike — and so it is unit testable without a request.
 */

/** Used as the rate-limit key when no forwarding header is present. */
export const UNKNOWN_CLIENT_IP = "unknown"

/** Minimal shape shared by `Headers` and Next's read-only headers store. */
export interface HeaderLike {
  get(name: string): string | null | undefined
}

/**
 * Best-effort client IP: `x-vercel-forwarded-for`, then the first hop of
 * `x-forwarded-for`, then `x-real-ip`, then `UNKNOWN_CLIENT_IP`. Never throws.
 *
 * Order matters. `x-vercel-forwarded-for` is written by Vercel's edge from the
 * real connection and cannot be set by the caller, so it is preferred wherever it
 * exists. `x-forwarded-for` is only as trustworthy as the proxy in front of the
 * app: a request that arrives with a hand-written `x-forwarded-for: 1.2.3.4`
 * takes that value verbatim unless a proxy overwrites the header. The result
 * gates the per-IP sign-in limit, so **a self-hosted deployment must terminate
 * through a proxy that overwrites `x-forwarded-for`** (nginx
 * `proxy_set_header X-Forwarded-For $remote_addr`, Caddy and Traefik do it by
 * default) — exposing the container port directly makes it bypassable by
 * rotating the header. Never treat the result as an identity.
 */
export function extractClientIp(headers: HeaderLike): string {
  // Platform-set and not forgeable: Vercel strips any inbound copy.
  const vercelForwardedFor = headers.get("x-vercel-forwarded-for")?.trim()
  if (vercelForwardedFor) {
    const first = vercelForwardedFor.split(",")[0]?.trim()
    if (first) return first
  }

  const forwardedFor = headers.get("x-forwarded-for")
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim()
    if (first) return first
  }

  const realIp = headers.get("x-real-ip")?.trim()
  if (realIp) return realIp

  return UNKNOWN_CLIENT_IP
}
