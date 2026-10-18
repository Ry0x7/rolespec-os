// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { JWT } from "@auth/core/jwt"

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { user: { findUnique: vi.fn() } },
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import { syncTokenProfile, isProfileStale, PROFILE_TTL_MS } from "../jwt-profile"

function makeToken(overrides: Partial<JWT> = {}): JWT {
  return {
    id: "user-1",
    role: "USER",
    ...overrides,
  } as JWT
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.user.findUnique.mockResolvedValue({
    role: "ADMIN",
    status: "ACTIVE",
    passwordChangedAt: null,
    sessionVersion: 0,
  })
})

describe("isProfileStale", () => {
  it("treats a missing timestamp as stale", () => {
    expect(isProfileStale(makeToken())).toBe(true)
  })

  it("is fresh inside the TTL and stale past it", () => {
    const now = 1_000_000
    expect(isProfileStale(makeToken({ profileRefreshedAt: now - 1 }), now)).toBe(false)
    expect(isProfileStale(makeToken({ profileRefreshedAt: now - PROFILE_TTL_MS }), now)).toBe(false)
    expect(isProfileStale(makeToken({ profileRefreshedAt: now - PROFILE_TTL_MS - 1 }), now)).toBe(
      true
    )
  })
})

describe("syncTokenProfile", () => {
  it("reads the DB on sign-in and stamps the refresh time", async () => {
    const before = Date.now()
    const token = await syncTokenProfile({
      token: makeToken({ id: "" as unknown as string }),
      user: { id: "user-9" },
    })

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-9" },
      select: {
        role: true,
        status: true,
        passwordChangedAt: true,
        sessionVersion: true,
      },
    })
    expect(token).not.toBeNull()
    expect(token!.id).toBe("user-9")
    expect(token!.role).toBe("ADMIN")
    expect(token!.profileRefreshedAt).toBeGreaterThanOrEqual(before)
  })

  it("always reads the DB on trigger update, even when the snapshot is fresh", async () => {
    const token = await syncTokenProfile({
      token: makeToken({ profileRefreshedAt: Date.now() }),
      trigger: "update",
    })

    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1)
    expect(token!.role).toBe("ADMIN")
  })

  it("re-reads the DB when the snapshot is older than the TTL", async () => {
    const stale = Date.now() - PROFILE_TTL_MS - 1
    const token = await syncTokenProfile({ token: makeToken({ profileRefreshedAt: stale }) })

    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1)
    expect(token!.profileRefreshedAt).toBeGreaterThan(stale)
  })

  it("does not hit the DB when the snapshot is still fresh", async () => {
    const refreshedAt = Date.now()
    const token = await syncTokenProfile({ token: makeToken({ profileRefreshedAt: refreshedAt }) })

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(token!.profileRefreshedAt).toBe(refreshedAt)
  })

  it("does not hit the DB when the token has no user id", async () => {
    await syncTokenProfile({ token: makeToken({ id: "" as unknown as string }) })

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

})

describe("syncTokenProfile deleted account", () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
  })

  it("invalidates the session on refresh when the row is gone", async () => {
    const token = await syncTokenProfile({
      token: makeToken({ role: "ADMIN", profileRefreshedAt: Date.now() - PROFILE_TTL_MS - 1 }),
    })

    expect(token).toBeNull()
  })

  it("invalidates the session on trigger update when the row is gone", async () => {
    const token = await syncTokenProfile({
      token: makeToken({ role: "ADMIN", profileRefreshedAt: Date.now() }),
      trigger: "update",
    })

    expect(token).toBeNull()
  })

  it("refuses the sign-in path when the row is gone", async () => {
    const token = await syncTokenProfile({ token: makeToken(), user: { id: "user-1" } })

    expect(token).toBeNull()
  })

  it("does not re-stamp the snapshot, so the next refresh re-reads the DB", async () => {
    const staleToken = makeToken({ profileRefreshedAt: Date.now() - PROFILE_TTL_MS - 1 })

    expect(await syncTokenProfile({ token: staleToken })).toBeNull()
    expect(isProfileStale(staleToken)).toBe(true)
  })
})

describe("syncTokenProfile status invalidation", () => {
  it.each(["SUSPENDED", "DISABLED"])("returns null for a %s account on refresh", async (status) => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status,
      passwordChangedAt: null,
      sessionVersion: 0,
    })

    const token = await syncTokenProfile({
      token: makeToken({ profileRefreshedAt: Date.now() - PROFILE_TTL_MS - 1 }),
    })

    expect(token).toBeNull()
  })

  it.each(["SUSPENDED", "DISABLED"])("refuses a %s account on sign-in too", async (status) => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status,
      passwordChangedAt: null,
      sessionVersion: 0,
    })

    const token = await syncTokenProfile({ token: makeToken(), user: { id: "user-1" } })

    expect(token).toBeNull()
  })

  it("returns null for a suspended account on trigger update", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "SUSPENDED",
      passwordChangedAt: null,
      sessionVersion: 0,
    })

    const token = await syncTokenProfile({
      token: makeToken({ profileRefreshedAt: Date.now() }),
      trigger: "update",
    })

    expect(token).toBeNull()
  })

  it("keeps an ACTIVE account signed in", async () => {
    const token = await syncTokenProfile({ token: makeToken(), trigger: "update" })

    expect(token).not.toBeNull()
  })

  it("still kills a fresh-snapshot session via the sessionVersion bump the action makes", async () => {
    // Suspension writes status *and* increments sessionVersion, so a token that
    // is still inside the TTL fails on the version check at its next refresh.
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "SUSPENDED",
      passwordChangedAt: null,
      sessionVersion: 1,
    })

    const token = await syncTokenProfile({
      token: makeToken({ profileRefreshedAt: Date.now() - PROFILE_TTL_MS - 1, sessionVersion: 0 }),
    })

    expect(token).toBeNull()
  })
})

describe("syncTokenProfile password invalidation", () => {
  const changedAt = new Date(1_700_000_000_000)

  it("stamps passwordChangedAt into the token on sign-in", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: changedAt,
    })

    const token = await syncTokenProfile({ token: makeToken(), user: { id: "user-1" } })

    expect(token).not.toBeNull()
    expect(token!.passwordStampedAt).toBe(changedAt.getTime())
  })

  it("returns null when the DB stamp is newer than the token stamp", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: changedAt,
    })

    const token = await syncTokenProfile({
      token: makeToken({ passwordStampedAt: changedAt.getTime() - 1 }),
      trigger: "update",
    })

    expect(token).toBeNull()
  })

  it("returns null when the token was never stamped but the DB has a change", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: changedAt,
    })

    const token = await syncTokenProfile({
      token: makeToken({ profileRefreshedAt: Date.now() - PROFILE_TTL_MS - 1 }),
    })

    expect(token).toBeNull()
  })

  it("keeps the session when the stamps match", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
      passwordChangedAt: changedAt,
    })

    const token = await syncTokenProfile({
      token: makeToken({ passwordStampedAt: changedAt.getTime() }),
      trigger: "update",
    })

    expect(token).not.toBeNull()
    expect(token!.role).toBe("USER")
  })

  it("does not invalidate a session that is still inside the TTL (known 60s lag)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: changedAt,
    })

    const token = await syncTokenProfile({
      token: makeToken({ profileRefreshedAt: Date.now(), passwordStampedAt: 0 }),
    })

    expect(token).not.toBeNull()
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })
})

describe("syncTokenProfile sessionVersion invalidation", () => {
  it("stamps the DB sessionVersion into the token on sign-in", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: null,
      sessionVersion: 4,
    })

    const token = await syncTokenProfile({ token: makeToken(), user: { id: "user-1" } })

    expect(token).not.toBeNull()
    expect(token!.sessionVersion).toBe(4)
  })

  it("returns null when the DB sessionVersion is ahead of the token", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: null,
      sessionVersion: 3,
    })

    const token = await syncTokenProfile({
      token: makeToken({ sessionVersion: 2 }),
      trigger: "update",
    })

    expect(token).toBeNull()
  })

  it("returns null when the token was never stamped but the DB has been bumped", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: null,
      sessionVersion: 1,
    })

    const token = await syncTokenProfile({
      token: makeToken({ profileRefreshedAt: Date.now() - PROFILE_TTL_MS - 1 }),
    })

    expect(token).toBeNull()
  })

  it("returns null when the token version is somehow ahead of the DB", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: null,
      sessionVersion: 1,
    })

    const token = await syncTokenProfile({
      token: makeToken({ sessionVersion: 2 }),
      trigger: "update",
    })

    expect(token).toBeNull()
  })

  it("keeps the session and refreshes when the versions match", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
      passwordChangedAt: null,
      sessionVersion: 2,
    })

    const token = await syncTokenProfile({
      token: makeToken({ sessionVersion: 2 }),
      trigger: "update",
    })

    expect(token).not.toBeNull()
    expect(token!.sessionVersion).toBe(2)
  })

  it("treats a missing DB sessionVersion as 0 for an unstamped token", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: null,
    })

    const token = await syncTokenProfile({ token: makeToken(), trigger: "update" })

    expect(token).not.toBeNull()
    expect(token!.sessionVersion).toBe(0)
  })

  it("does not re-read the DB while the snapshot is fresh (same 60s lag)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
        passwordChangedAt: null,
      sessionVersion: 9,
    })

    const token = await syncTokenProfile({
      token: makeToken({ profileRefreshedAt: Date.now(), sessionVersion: 0 }),
    })

    expect(token).not.toBeNull()
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })
})
