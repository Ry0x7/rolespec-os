// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "127.0.0.1:3100" })),
  cookies: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    playerProfile: { upsert: vi.fn() },
  },
}))
vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}))

import {
  createOwnerToken,
  getAccessMode,
  isLoopbackHost,
  safeReturnPath,
  verifyOwnerToken,
} from "../session"

const ORIGINAL_MODE = process.env.ROLSPEC_ACCESS_MODE
const ORIGINAL_NODE_ENV = process.env.NODE_ENV

afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.ROLSPEC_ACCESS_MODE
  else process.env.ROLSPEC_ACCESS_MODE = ORIGINAL_MODE
  ;(process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV
})

describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "localhost:3100",
    "app.localhost",
    "127.0.0.1",
    "127.0.0.1:3100",
    "127.8.9.10",
    "[::1]:3100",
  ])("treats %s as loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(true)
  })

  it.each([
    "rolespec.example.com",
    "8.8.8.8",
    "192.168.1.25",
    "10.0.0.4",
    "172.16.5.9",
    "100.101.102.103",
    "host.docker.internal",
    "rolespec.local",
    "0.0.0.0",
    "203.0.113.9",
    "evil-localhost.example.com",
  ])("treats %s as remote (key gate required)", (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })
})

describe("signed owner token", () => {
  const key = "a-very-long-owner-key-123"

  it("accepts a fresh token for the same key", () => {
    expect(verifyOwnerToken(createOwnerToken(key), key)).toBe(true)
  })

  it("rejects another key's token", () => {
    expect(verifyOwnerToken(createOwnerToken(key), "a-different-long-key-456")).toBe(false)
  })

  it("rejects a tampered expiry", () => {
    const token = createOwnerToken(key)
    const [version, expiry, signature] = token.split(".")
    expect(verifyOwnerToken(`${version}.${expiry}x.${signature}`, key)).toBe(false)
  })

  it("rejects an expired token", () => {
    const issuedLongAgo = Date.now() - 40 * 24 * 60 * 60 * 1000
    expect(verifyOwnerToken(createOwnerToken(key, issuedLongAgo), key)).toBe(false)
  })

  it("rejects malformed values", () => {
    expect(verifyOwnerToken("", key)).toBe(false)
    expect(verifyOwnerToken("v1.not-a-number.sig", key)).toBe(false)
    expect(verifyOwnerToken(null, key)).toBe(false)
  })
})

describe("access mode", () => {
  beforeEach(() => {
    delete process.env.ROLSPEC_ACCESS_MODE
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
  })

  it("defaults to the key gate in production", () => {
    expect(getAccessMode()).toBe("unlock")
  })

  it("defaults to local outside production", () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "development"
    expect(getAccessMode()).toBe("local")
  })

  it("honours an explicit local or unlock setting", () => {
    process.env.ROLSPEC_ACCESS_MODE = "local"
    expect(getAccessMode()).toBe("local")
    process.env.ROLSPEC_ACCESS_MODE = "unlock"
    expect(getAccessMode()).toBe("unlock")
  })

  it("ignores an unknown setting rather than opening access", () => {
    process.env.ROLSPEC_ACCESS_MODE = "open"
    expect(getAccessMode()).toBe("unlock")
  })
})

describe("safeReturnPath", () => {
  it("keeps absolute same-origin paths", () => {
    expect(safeReturnPath("/jobs/abc?tab=track")).toBe("/jobs/abc?tab=track")
    expect(safeReturnPath(encodeURIComponent("/jobs/abc"))).toBe("/jobs/abc")
  })

  it.each([
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/unlock",
    "/unlock?next=/dashboard",
    "/jobs\nSet-Cookie: x",
  ])("falls back for %o", (value) => {
    expect(safeReturnPath(value)).toBe("/dashboard")
  })
})
