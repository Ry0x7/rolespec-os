// @vitest-environment node
import { createHash } from "node:crypto"

import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma } = vi.hoisted(() => {
  const prisma = {
    apiToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    // Interactive transaction: the callback gets the same client, which is what
    // matters here — every write of a rotation must go through one `$transaction`.
    $transaction: vi.fn(),
  }
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma))
  return { mockPrisma: prisma }
})

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import {
  API_TOKEN_PREFIX,
  createApiToken,
  generateApiToken,
  hashApiToken,
  listApiTokens,
  revokeAllApiTokens,
  revokeApiToken,
  rotateApiToken,
  verifyApiToken,
} from "../api-token"

const SUMMARY = {
  id: "token_1",
  name: "Chrome",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  lastUsedAt: null,
  expiresAt: null,
}

const HOUR = 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.apiToken.create.mockResolvedValue(SUMMARY)
  mockPrisma.apiToken.update.mockResolvedValue({})
  mockPrisma.apiToken.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma)
  )
})

describe("token generation", () => {
  it("prefixes the raw token and produces a distinct value each time", () => {
    const a = generateApiToken()
    const b = generateApiToken()

    expect(a.startsWith(API_TOKEN_PREFIX)).toBe(true)
    expect(a.length).toBeGreaterThan(API_TOKEN_PREFIX.length + 32)
    expect(a).not.toBe(b)
  })

  it("hashes with SHA-256 hex", () => {
    expect(hashApiToken("rspec_abc")).toBe(
      createHash("sha256").update("rspec_abc").digest("hex")
    )
  })
})

describe("createApiToken", () => {
  it("stores only the hash, never the raw token", async () => {
    const { token } = await createApiToken("user_1", "Chrome")

    const data = mockPrisma.apiToken.create.mock.calls[0][0].data
    expect(data.tokenHash).toBe(hashApiToken(token))
    expect(JSON.stringify(data)).not.toContain(token)
    expect(data).toEqual({
      userId: "user_1",
      name: "Chrome",
      tokenHash: hashApiToken(token),
      expiresAt: null,
    })
  })

  it("defaults to no expiry and stores a supplied one verbatim", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * HOUR)
    await createApiToken("user_1", "Chrome", expiresAt)

    expect(mockPrisma.apiToken.create.mock.calls[0][0].data.expiresAt).toBe(expiresAt)
  })

  it("returns the raw token once, alongside a hash-free summary", async () => {
    const result = await createApiToken("user_1", "Chrome")

    expect(result.token.startsWith(API_TOKEN_PREFIX)).toBe(true)
    expect(result.summary).toEqual(SUMMARY)
    expect(result.summary).not.toHaveProperty("tokenHash")
  })
})

describe("verifyApiToken", () => {
  it("round-trips a freshly created token to its user id", async () => {
    const { token } = await createApiToken("user_1", "Chrome")
    const storedHash = mockPrisma.apiToken.create.mock.calls[0][0].data.tokenHash

    mockPrisma.apiToken.findUnique.mockImplementation(async (args: { where: { tokenHash: string } }) =>
      args.where.tokenHash === storedHash
        ? { id: "token_1", userId: "user_1", revokedAt: null, user: { status: "ACTIVE" } }
        : null
    )

    await expect(verifyApiToken(token)).resolves.toBe("user_1")
  })

  it("rejects a revoked token", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      revokedAt: new Date(),
    })

    await expect(verifyApiToken(generateApiToken())).resolves.toBeNull()
  })

  it.each(["SUSPENDED", "DISABLED"])(
    "rejects a live token whose owner is %s",
    async (status) => {
      mockPrisma.apiToken.findUnique.mockResolvedValue({
        id: "token_1",
        userId: "user_1",
        revokedAt: null,
        user: { status },
      })

      await expect(verifyApiToken(generateApiToken())).resolves.toBeNull()
      expect(mockPrisma.apiToken.update).not.toHaveBeenCalled()
    }
  )

  it("selects the owner status alongside the token row", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValue(null)

    await verifyApiToken(generateApiToken())

    expect(mockPrisma.apiToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          userId: true,
          revokedAt: true,
          expiresAt: true,
          user: { select: { status: true } },
        },
      })
    )
  })

  it("rejects an unknown token", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValue(null)

    await expect(verifyApiToken(generateApiToken())).resolves.toBeNull()
  })

  it.each(["", "abc123", "Bearer rspec_x", "rspec", "rspec_"])(
    "rejects %o without touching the database",
    async (raw) => {
      await expect(verifyApiToken(raw)).resolves.toBeNull()
      expect(mockPrisma.apiToken.findUnique).not.toHaveBeenCalled()
    }
  )

  it("stamps lastUsedAt for a valid token", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      revokedAt: null,
      user: { status: "ACTIVE" },
    })

    await verifyApiToken(generateApiToken())

    expect(mockPrisma.apiToken.update).toHaveBeenCalledWith({
      where: { id: "token_1" },
      data: { lastUsedAt: expect.any(Date) },
    })
  })

  it("rejects an expired token like a revoked one, and does not stamp it", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - HOUR),
      user: { status: "ACTIVE" },
    })

    await expect(verifyApiToken(generateApiToken())).resolves.toBeNull()
    expect(mockPrisma.apiToken.update).not.toHaveBeenCalled()
  })

  it("accepts a token whose expiry is still in the future", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + HOUR),
      user: { status: "ACTIVE" },
    })

    await expect(verifyApiToken(generateApiToken())).resolves.toBe("user_1")
  })

  it("still authenticates when the lastUsedAt write fails", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      revokedAt: null,
      user: { status: "ACTIVE" },
    })
    mockPrisma.apiToken.update.mockRejectedValue(new Error("connection lost"))

    await expect(verifyApiToken(generateApiToken())).resolves.toBe("user_1")
  })
})

describe("listApiTokens", () => {
  it("selects live tokens only and no hashes", async () => {
    mockPrisma.apiToken.findMany.mockResolvedValue([SUMMARY])

    await expect(listApiTokens("user_1")).resolves.toEqual([SUMMARY])
    expect(mockPrisma.apiToken.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1", revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    })
  })
})

describe("revokeApiToken", () => {
  it("scopes the update by user id as well as token id", async () => {
    await expect(revokeApiToken("user_1", "token_1")).resolves.toBe(true)

    expect(mockPrisma.apiToken.updateMany).toHaveBeenCalledWith({
      where: { id: "token_1", userId: "user_1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it("reports false when the token belongs to someone else", async () => {
    mockPrisma.apiToken.updateMany.mockResolvedValue({ count: 0 })

    await expect(revokeApiToken("user_2", "token_1")).resolves.toBe(false)
  })
})

describe("revokeAllApiTokens", () => {
  it("revokes every live token of that user and nobody else's", async () => {
    mockPrisma.apiToken.updateMany.mockResolvedValue({ count: 3 })

    await expect(revokeAllApiTokens("user_1")).resolves.toBe(3)

    expect(mockPrisma.apiToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it("reports zero when there was nothing live", async () => {
    mockPrisma.apiToken.updateMany.mockResolvedValue({ count: 0 })

    await expect(revokeAllApiTokens("user_1")).resolves.toBe(0)
  })
})

describe("rotateApiToken", () => {
  function existing(overrides: Record<string, unknown> = {}) {
    mockPrisma.apiToken.findFirst.mockResolvedValue({
      id: "token_1",
      name: "Chrome",
      expiresAt: null,
      ...overrides,
    })
  }

  it("revokes the old row and mints a replacement inside one transaction", async () => {
    existing()

    const result = await rotateApiToken("user_1", "token_1")

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.apiToken.updateMany).toHaveBeenCalledWith({
      where: { id: "token_1", userId: "user_1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(mockPrisma.apiToken.create).toHaveBeenCalledTimes(1)
    // Both writes were issued from inside the transaction callback.
    expect(mockPrisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.apiToken.updateMany.mock.invocationCallOrder[0]
    )
    expect(result?.token.startsWith(API_TOKEN_PREFIX)).toBe(true)
  })

  it("carries the name forward and stores only the new hash", async () => {
    existing({ name: "Laptop" })

    const result = await rotateApiToken("user_1", "token_1")
    const data = mockPrisma.apiToken.create.mock.calls[0][0].data

    expect(data.name).toBe("Laptop")
    expect(data.tokenHash).toBe(hashApiToken(result!.token))
    expect(JSON.stringify(data)).not.toContain(result!.token)
  })

  it("carries a future expiry forward", async () => {
    const expiresAt = new Date(Date.now() + 5 * HOUR)
    existing({ expiresAt })

    await rotateApiToken("user_1", "token_1")

    expect(mockPrisma.apiToken.create.mock.calls[0][0].data.expiresAt).toBe(expiresAt)
  })

  it("drops an expiry that has already passed rather than minting a dead token", async () => {
    existing({ expiresAt: new Date(Date.now() - HOUR) })

    await rotateApiToken("user_1", "token_1")

    expect(mockPrisma.apiToken.create.mock.calls[0][0].data.expiresAt).toBeNull()
  })

  it("rotates nothing when the id belongs to another user", async () => {
    mockPrisma.apiToken.findFirst.mockResolvedValue(null)

    await expect(rotateApiToken("user_2", "token_1")).resolves.toBeNull()
    expect(mockPrisma.apiToken.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.apiToken.create).not.toHaveBeenCalled()
    expect(mockPrisma.apiToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "token_1", userId: "user_2", revokedAt: null },
      })
    )
  })

  it("mints nothing when the revoke raced to zero rows", async () => {
    existing()
    mockPrisma.apiToken.updateMany.mockResolvedValue({ count: 0 })

    await expect(rotateApiToken("user_1", "token_1")).resolves.toBeNull()
    expect(mockPrisma.apiToken.create).not.toHaveBeenCalled()
  })
})

describe("audit events", () => {
  it("logs the expiry rejection without the raw token", async () => {
    const raw = generateApiToken()
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    mockPrisma.apiToken.findUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - HOUR),
      user: { status: "ACTIVE" },
    })

    await verifyApiToken(raw)

    const lines = spy.mock.calls.map((call) => String(call[0]))
    spy.mockRestore()

    expect(lines.some((line) => line.includes("api_token.expired_rejected"))).toBe(true)
    expect(lines.some((line) => line.includes(raw))).toBe(false)
  })

  it("logs create, rotate and revoke-all without any secret material", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    mockPrisma.apiToken.findFirst.mockResolvedValue({
      id: "token_1",
      name: "Chrome",
      expiresAt: null,
    })

    const created = await createApiToken("user_1", "Chrome")
    const rotated = await rotateApiToken("user_1", "token_1")
    await revokeAllApiTokens("user_1")

    const lines = spy.mock.calls.map((call) => String(call[0]))
    spy.mockRestore()

    for (const event of ["api_token.create", "api_token.rotate", "api_token.revoke_all"]) {
      expect(lines.some((line) => line.includes(event))).toBe(true)
    }
    for (const secret of [created.token, rotated!.token, hashApiToken(created.token)]) {
      expect(lines.some((line) => line.includes(secret))).toBe(false)
    }
  })
})
