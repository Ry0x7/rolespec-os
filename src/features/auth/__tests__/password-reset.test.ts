// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    verificationToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import {
  PASSWORD_RESET_TTL_MS,
  consumePasswordResetToken,
  createPasswordResetToken,
  generateResetToken,
  hashResetToken,
  hashesMatch,
  isPasswordResetIdentifier,
  passwordResetIdentifier,
  pruneExpiredPasswordResetTokens,
  userIdFromIdentifier,
} from "../password-reset"

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.verificationToken.create.mockResolvedValue({})
})

describe("identifier namespacing", () => {
  it("round-trips a user id", () => {
    const identifier = passwordResetIdentifier("user_123")
    expect(identifier).toBe("pwreset:user_123")
    expect(userIdFromIdentifier(identifier)).toBe("user_123")
  })

  it("does not claim identifiers belonging to other flows", () => {
    // The table is shared with Auth.js and with email verification.
    expect(isPasswordResetIdentifier("email-verify:user_123")).toBe(false)
    expect(isPasswordResetIdentifier("someone@example.com")).toBe(false)
    expect(userIdFromIdentifier("email-verify:user_123")).toBeNull()
  })

  it("rejects a prefix with no user id", () => {
    expect(userIdFromIdentifier("pwreset:")).toBeNull()
  })
})

describe("token generation and hashing", () => {
  it("generates URL-safe tokens that need no encoding", () => {
    for (let i = 0; i < 20; i++) {
      const token = generateResetToken()
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(encodeURIComponent(token)).toBe(token)
    }
  })

  it("generates at least 32 bytes of entropy", () => {
    expect(Buffer.from(generateResetToken(), "base64url")).toHaveLength(32)
  })

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateResetToken))
    expect(tokens.size).toBe(50)
  })

  it("hashes deterministically to sha256 hex", () => {
    expect(hashResetToken("abc")).toBe(hashResetToken("abc"))
    expect(hashResetToken("abc")).toMatch(/^[0-9a-f]{64}$/)
    expect(hashResetToken("abc")).not.toBe(hashResetToken("abd"))
  })

  it("compares hashes without throwing on a length mismatch", () => {
    const hash = hashResetToken("abc")
    expect(hashesMatch(hash, hash)).toBe(true)
    expect(hashesMatch(hash, hashResetToken("abd"))).toBe(false)
    // timingSafeEqual throws on unequal lengths — the guard must catch it first.
    expect(() => hashesMatch(hash, "deadbeef")).not.toThrow()
    expect(hashesMatch(hash, "deadbeef")).toBe(false)
  })
})

describe("createPasswordResetToken", () => {
  it("stores only the hash, never the raw token", async () => {
    const raw = await createPasswordResetToken("user_1")

    const created = mockPrisma.verificationToken.create.mock.calls[0][0].data
    expect(created.token).toBe(hashResetToken(raw))
    expect(created.token).not.toBe(raw)
    expect(JSON.stringify(created)).not.toContain(raw)
  })

  it("invalidates any outstanding token for the same user first", async () => {
    await createPasswordResetToken("user_1")

    expect(mockPrisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "pwreset:user_1" },
    })
    // Delete must precede create, or the new row is the one removed.
    const deleteOrder = mockPrisma.verificationToken.deleteMany.mock.invocationCallOrder[0]
    const createOrder = mockPrisma.verificationToken.create.mock.invocationCallOrder[0]
    expect(deleteOrder).toBeLessThan(createOrder)
  })

  it("sets an expiry in the future, bounded by the TTL", async () => {
    const before = Date.now()
    await createPasswordResetToken("user_1")

    const { expires } = mockPrisma.verificationToken.create.mock.calls[0][0].data
    expect(expires.getTime()).toBeGreaterThan(before)
    expect(expires.getTime()).toBeLessThanOrEqual(before + PASSWORD_RESET_TTL_MS + 1000)
  })

  it("keeps the reset window short", () => {
    // A reset link is a bearer credential; hours would be too generous.
    expect(PASSWORD_RESET_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000)
  })
})

describe("consumePasswordResetToken", () => {
  function rowFor(userId: string, expiresInMs: number) {
    return {
      identifier: passwordResetIdentifier(userId),
      expires: new Date(Date.now() + expiresInMs),
    }
  }

  it("accepts a live token and returns its user", async () => {
    mockPrisma.verificationToken.findUnique.mockResolvedValue(rowFor("user_1", 60_000))

    await expect(consumePasswordResetToken("a".repeat(43))).resolves.toEqual({
      ok: true,
      userId: "user_1",
    })
  })

  it("looks the token up by hash, not by raw value", async () => {
    mockPrisma.verificationToken.findUnique.mockResolvedValue(rowFor("user_1", 60_000))
    const raw = "b".repeat(43)

    await consumePasswordResetToken(raw)

    expect(mockPrisma.verificationToken.findUnique).toHaveBeenCalledWith({
      where: { token: hashResetToken(raw) },
      select: { identifier: true, expires: true },
    })
  })

  it("burns the token even when it turns out to be expired", async () => {
    mockPrisma.verificationToken.findUnique.mockResolvedValue(rowFor("user_1", -1000))

    await expect(consumePasswordResetToken("c".repeat(43))).resolves.toEqual({
      ok: false,
      reason: "expired",
    })
    expect(mockPrisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "pwreset:user_1" },
    })
  })

  it("burns the token before reporting success, so it cannot be replayed", async () => {
    mockPrisma.verificationToken.findUnique.mockResolvedValue(rowFor("user_1", 60_000))

    await consumePasswordResetToken("d".repeat(43))

    expect(mockPrisma.verificationToken.deleteMany).toHaveBeenCalledTimes(1)
  })

  it("rejects an unknown token", async () => {
    mockPrisma.verificationToken.findUnique.mockResolvedValue(null)

    await expect(consumePasswordResetToken("e".repeat(43))).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  it("refuses a token row belonging to another flow", async () => {
    // An Auth.js email-verification row must not be usable as a password reset.
    mockPrisma.verificationToken.findUnique.mockResolvedValue({
      identifier: "someone@example.com",
      expires: new Date(Date.now() + 60_000),
    })

    await expect(consumePasswordResetToken("f".repeat(43))).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(mockPrisma.verificationToken.deleteMany).not.toHaveBeenCalled()
  })

  it.each(["", "short"])("rejects %o without hitting the database", async (token) => {
    await expect(consumePasswordResetToken(token)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(mockPrisma.verificationToken.findUnique).not.toHaveBeenCalled()
  })
})

describe("pruneExpiredPasswordResetTokens", () => {
  it("only deletes expired rows in this namespace", async () => {
    mockPrisma.verificationToken.deleteMany.mockResolvedValue({ count: 4 })

    await expect(pruneExpiredPasswordResetTokens()).resolves.toBe(4)

    const where = mockPrisma.verificationToken.deleteMany.mock.calls[0][0].where
    expect(where.identifier).toEqual({ startsWith: "pwreset:" })
    expect(where.expires.lt).toBeInstanceOf(Date)
  })
})
