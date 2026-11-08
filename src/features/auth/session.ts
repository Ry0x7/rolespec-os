import { cache } from "react"
import { createHmac, timingSafeEqual } from "node:crypto"
import { cookies, headers } from "next/headers"

import { prisma } from "@/shared/lib/prisma"
import { logger } from "@/shared/lib/logger"

const log = logger("auth/owner")

/**
 * RoleSpec is a single-owner workspace. There are no user accounts, no
 * passwords and no OAuth providers: one local owner row owns every record.
 *
 * Passwordless entry is only safe while the server is private. Access therefore
 * has exactly two modes:
 *
 *  - `local`  — passwordless, and only while the request arrives on a loopback
 *               hostname. This is the default in development and is set
 *               explicitly by the desktop runtime and Docker compose, both of
 *               which bind their server to 127.0.0.1. A LAN address is not
 *               loopback and therefore needs the key gate.
 *  - `unlock` — a key gate for every non-loopback host. `ROLSPEC_ACCESS_KEY` is
 *               required; a correct key sets a signed, HttpOnly cookie. This is
 *               the production default, so a public deployment never serves the
 *               workspace unauthenticated by accident.
 *
 * There is no third "open" mode on purpose.
 *
 * The hostname is read from the `Host` header, not from a forwarding header: a
 * proxy that preserves the public host therefore cannot be tricked into making a
 * public request look local by a client-supplied `X-Forwarded-Host`. A public
 * deployment must use `unlock`.
 */
export type AccessMode = "local" | "unlock"
export type AccessState = "owner" | "unlock" | "blocked"

export const OWNER_EMAIL = "owner@rolespec.local"
export const OWNER_NAME = "RoleSpec OS Owner"
export const OWNER_COOKIE_NAME = "rolespec.owner"
export const OWNER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

const UNLOCK_KEY_MIN_LENGTH = 16

export interface OwnerSession {
  user: {
    id: string
    email: string
    name: string
    image: string | null
    role: string
  }
  expires: string
}

export function getAccessMode(): AccessMode {
  const configured = process.env.ROLSPEC_ACCESS_MODE?.trim().toLowerCase()
  if (configured === "local" || configured === "unlock") return configured
  return process.env.NODE_ENV === "production" ? "unlock" : "local"
}

/**
 * The configured remote key, or null when unset/too short to be a credible
 * secret. `unlock` mode without a usable key refuses access instead of falling
 * back to passwordless entry.
 */
export function getAccessKey(): string | null {
  const key = process.env.ROLSPEC_ACCESS_KEY?.trim() ?? ""
  return key.length >= UNLOCK_KEY_MIN_LENGTH ? key : null
}

function normalizeHostname(raw: string | null | undefined): string | null {
  if (!raw) return null
  let host = raw.split(",")[0]?.trim().toLowerCase() ?? ""
  if (!host) return null

  // Bracketed IPv6, with or without a port.
  if (host.startsWith("[")) {
    const end = host.indexOf("]")
    if (end > 0) host = host.slice(1, end)
  } else if ((host.match(/:/g)?.length ?? 0) === 1) {
    // A single colon is a host:port pair. Multiple colons are bare IPv6.
    host = host.slice(0, host.indexOf(":"))
  }

  return host.replace(/\.$/, "") || null
}

function isLoopbackIpv4(host: string): boolean {
  const octets = host.split(".").map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false
  }

  // 127.0.0.0/8 — the whole IPv4 loopback block, not just 127.0.0.1.
  return octets[0] === 127
}

function isLoopbackIpv6(host: string): boolean {
  return host === "::1" || host === "0:0:0:0:0:0:0:1"
}

/**
 * True only for loopback names and addresses. LAN names, private ranges and
 * tunnels are deliberately excluded: they are reachable by other machines and
 * must go through the key gate.
 */
export function isLoopbackHost(raw: string | null | undefined): boolean {
  const host = normalizeHostname(raw)
  if (!host) return false

  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host.includes(":") && isLoopbackIpv6(host)) return true
  return isLoopbackIpv4(host)
}

async function readRequestHost(): Promise<string | null> {
  try {
    const requestHeaders = await headers()
    const host = normalizeHostname(requestHeaders.get("host"))
    const forwarded = normalizeHostname(requestHeaders.get("x-forwarded-host"))

    // When both are present, the forwarding header wins only if it names a
    // different, non-loopback host: a proxy that terminates a public request
    // may keep an internal `localhost:3000` upstream Host, and that request
    // must not be treated as local. A forged `X-Forwarded-Host: localhost`
    // cannot downgrade a public Host header.
    if (forwarded && forwarded !== host && !isLoopbackHost(forwarded)) return forwarded
    return host ?? forwarded
  } catch {
    // No request scope (build-time render, script). Callers only reach this in
    // `local` mode, where the absence of a host means "internal process".
    return null
  }
}

export async function requestAccessState(): Promise<AccessState> {
  if (getAccessMode() === "local") {
    const host = await readRequestHost()
    // Unknown request scope (build-time render, internal job) is trusted; a
    // known non-loopback host is refused rather than treated as the owner.
    if (host && !isLoopbackHost(host)) return "blocked"
    return "owner"
  }

  if (!getAccessKey()) return "blocked"
  return (await hasOwnerUnlockCookie()) ? "owner" : "unlock"
}

function unlockSignature(expiry: string, key: string): string {
  return createHmac("sha256", key).update(`rolespec-owner:${expiry}`).digest("base64url")
}

export function createOwnerToken(key: string, now = Date.now()): string {
  const expiry = (now + OWNER_COOKIE_MAX_AGE_SECONDS * 1000).toString(36)
  return `v1.${expiry}.${unlockSignature(expiry, key)}`
}

export function verifyOwnerToken(
  token: string | null | undefined,
  key: string,
  now = Date.now()
): boolean {
  if (!token) return false
  const [version, expiry, signature] = token.split(".")
  if (version !== "v1" || !expiry || !signature) return false

  const expiresAt = Number.parseInt(expiry, 36)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false

  const expected = Buffer.from(unlockSignature(expiry, key))
  const provided = Buffer.from(signature)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

export async function hasOwnerUnlockCookie(): Promise<boolean> {
  const key = getAccessKey()
  if (!key) return false
  try {
    const store = await cookies()
    return verifyOwnerToken(store.get(OWNER_COOKIE_NAME)?.value, key)
  } catch {
    return false
  }
}

export async function setOwnerUnlockCookie(): Promise<boolean> {
  const key = getAccessKey()
  if (!key) return false
  try {
    const store = await cookies()
    store.set({
      name: OWNER_COOKIE_NAME,
      value: createOwnerToken(key),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: OWNER_COOKIE_MAX_AGE_SECONDS,
    })
    return true
  } catch (err) {
    log.error("Could not set the owner unlock cookie", { err })
    return false
  }
}

export async function clearOwnerUnlockCookie(): Promise<void> {
  try {
    const store = await cookies()
    store.delete(OWNER_COOKIE_NAME)
  } catch (err) {
    log.error("Could not clear the owner unlock cookie", { err })
  }
}

/** True when this deployment uses the remote key gate. */
export function isUnlockMode(): boolean {
  return getAccessMode() === "unlock"
}

/** True when a key-gated session can be explicitly locked from the header. */
export async function canLockWorkspace(): Promise<boolean> {
  return getAccessMode() === "unlock" && (await hasOwnerUnlockCookie())
}

/** Only same-origin absolute paths are accepted as post-unlock destinations. */
export function safeReturnPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback

  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return fallback
  }

  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) {
    return fallback
  }
  if (decoded === "/unlock" || decoded.startsWith("/unlock?") || decoded.startsWith("/unlock/")) {
    return fallback
  }
  // Header values must not smuggle control characters into a redirect.
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return fallback

  return decoded
}

/** The path+query the proxy attached to the current request, for post-unlock. */
export async function currentRequestPath(): Promise<string | null> {
  try {
    const requestHeaders = await headers()
    const value = requestHeaders.get("x-rolespec-path")
    return value ? safeReturnPath(value, "/dashboard") : null
  } catch {
    return null
  }
}

async function getOrCreateOwner() {
  // Preserve existing data: prefer the dedicated owner row, then any previous
  // admin, then the oldest account from a pre-single-owner database.
  const existing =
    (await prisma.user.findUnique({ where: { email: OWNER_EMAIL } })) ??
    (await prisma.user.findFirst({
      where: { role: "ADMIN" },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.user.findFirst({ orderBy: { createdAt: "asc" } }))

  if (existing) {
    if (existing.role !== "ADMIN" || existing.status !== "ACTIVE") {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN", status: "ACTIVE" },
      })
    }
    // Older databases may have an account without the profile row.
    await prisma.playerProfile.upsert({
      where: { userId: existing.id },
      update: {},
      create: { userId: existing.id },
    })
    return existing
  }

  return prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { role: "ADMIN", status: "ACTIVE" },
    create: {
      email: OWNER_EMAIL,
      name: OWNER_NAME,
      role: "ADMIN",
      status: "ACTIVE",
      profile: { create: {} },
    },
  })
}

/**
 * Per-request memoized owner session. Returns null when this request is not
 * allowed to reach the workspace — pages and actions then redirect to /unlock.
 */
export const auth = cache(async (): Promise<OwnerSession | null> => {
  const state = await requestAccessState()
  if (state !== "owner") return null

  try {
    const owner = await getOrCreateOwner()
    return {
      user: {
        id: owner.id,
        email: owner.email,
        name: owner.name ?? OWNER_NAME,
        image: owner.image,
        role: "ADMIN",
      },
      expires: new Date(Date.now() + OWNER_COOKIE_MAX_AGE_SECONDS * 1000).toISOString(),
    }
  } catch (err) {
    log.error("Could not resolve the local owner", { err })
    return null
  }
})
