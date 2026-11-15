// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  countActiveApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  revokeAllApiTokens: vi.fn(),
  rotateApiToken: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { API_TOKEN_CREATE: "api_token_create" },
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
  consumeRateLimit: mocks.consumeRateLimit,
  recordAttempt: mocks.recordAttempt,
}))
vi.mock("../../services/api-token", () => ({
  countActiveApiTokens: mocks.countActiveApiTokens,
  createApiToken: mocks.createApiToken,
  revokeApiToken: mocks.revokeApiToken,
  revokeAllApiTokens: mocks.revokeAllApiTokens,
  rotateApiToken: mocks.rotateApiToken,
}))

import {
  createApiTokenAction,
  revokeAllApiTokensAction,
  rotateApiTokenAction,
} from "../api-token.actions"

const DAY_MS = 24 * 60 * 60 * 1000

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.countActiveApiTokens.mockResolvedValue(0)
  mocks.createApiToken.mockResolvedValue({
    token: "rspec_fresh",
    summary: { id: "t1", name: "Chrome", createdAt: new Date(), lastUsedAt: null, expiresAt: null },
  })
  mocks.rotateApiToken.mockResolvedValue({
    token: "rspec_rotated",
    summary: { id: "t2", name: "Chrome", createdAt: new Date(), lastUsedAt: null, expiresAt: null },
  })
  mocks.revokeAllApiTokens.mockResolvedValue(2)
})

describe("createApiTokenAction expiry", () => {
  it("defaults to no expiry when the field is absent", async () => {
    await createApiTokenAction(form({ name: "Chrome" }))

    expect(mocks.createApiToken).toHaveBeenCalledWith("user_1", "Chrome", null)
  })

  it("treats an explicit \"never\" the same way", async () => {
    await createApiTokenAction(form({ name: "Chrome", expiry: "never" }))

    expect(mocks.createApiToken).toHaveBeenCalledWith("user_1", "Chrome", null)
  })

  it.each([
    ["30d", 30],
    ["90d", 90],
  ])("computes %s server-side", async (choice, days) => {
    const before = Date.now()

    await createApiTokenAction(form({ name: "Chrome", expiry: choice }))

    const expiresAt = mocks.createApiToken.mock.calls[0][2] as Date
    expect(expiresAt).toBeInstanceOf(Date)
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + days * DAY_MS)
    expect(expiresAt.getTime()).toBeLessThan(before + days * DAY_MS + 60_000)
  })

  it.each(["forever", "1d", "9999-01-01T00:00:00Z", "-1"])(
    "refuses a client-supplied %o without minting",
    async (raw) => {
      const result = await createApiTokenAction(form({ name: "Chrome", expiry: raw }))

      expect(result).toEqual({ error: "Choose a valid expiry." })
      expect(mocks.createApiToken).not.toHaveBeenCalled()
    }
  )
})

describe("rotateApiTokenAction", () => {
  it("returns the fresh token once and refreshes /settings", async () => {
    const result = await rotateApiTokenAction("t1")

    expect(result).toEqual({ token: "rspec_rotated", name: "Chrome" })
    expect(mocks.rotateApiToken).toHaveBeenCalledWith("user_1", "t1")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings")
  })

  it("refuses when nobody is signed in", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(rotateApiTokenAction("t1")).resolves.toEqual({ error: "You are not signed in." })
    expect(mocks.rotateApiToken).not.toHaveBeenCalled()
  })

  it("consumes the create rate-limit bucket and stops when it is exhausted", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const result = await rotateApiTokenAction("t1")

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "api_token_create",
      "user_1",
      expect.objectContaining({ max: expect.any(Number) })
    )
    expect(result).toEqual({ error: "Too many attempts. Please try again later." })
    expect(mocks.rotateApiToken).not.toHaveBeenCalled()
  })

  it("reports a miss when the service found nothing to rotate", async () => {
    mocks.rotateApiToken.mockResolvedValue(null)

    await expect(rotateApiTokenAction("t1")).resolves.toEqual({
      error: "That token no longer exists.",
    })
  })

  it("rejects an empty id before touching the service", async () => {
    await expect(rotateApiTokenAction("")).resolves.toEqual({
      error: "Could not read which token to rotate.",
    })
    expect(mocks.rotateApiToken).not.toHaveBeenCalled()
  })
})

describe("revokeAllApiTokensAction", () => {
  it("revokes for the signed-in user only and reports the count", async () => {
    const result = await revokeAllApiTokensAction()

    expect(result).toEqual({ ok: true, count: 2 })
    expect(mocks.revokeAllApiTokens).toHaveBeenCalledWith("user_1")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings")
  })

  it("refuses when nobody is signed in", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(revokeAllApiTokensAction()).resolves.toEqual({ error: "You are not signed in." })
    expect(mocks.revokeAllApiTokens).not.toHaveBeenCalled()
  })

  it("surfaces a write failure rather than throwing", async () => {
    mocks.revokeAllApiTokens.mockRejectedValue(new Error("connection lost"))

    await expect(revokeAllApiTokensAction()).resolves.toEqual({
      error: "Could not revoke your tokens. Please try again.",
    })
  })
})
