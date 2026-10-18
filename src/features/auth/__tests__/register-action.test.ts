// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

const { mockPrisma, mockSignIn, mockConsumeRateLimit, mockRecordAttempt } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    playerProfile: { upsert: vi.fn() },
  },
  mockSignIn: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockRecordAttempt: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("../config", () => ({ signIn: mockSignIn, signOut: vi.fn() }))
vi.mock("../guards", () => ({ requireAdmin: vi.fn() }))
vi.mock("../admin-elevation", () => ({
  clearElevationCookie: vi.fn(),
  issueElevationCookie: vi.fn(),
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("@/features/admin/services/audit.service", () => ({ logAdminAction: vi.fn() }))
vi.mock("@/shared/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/rate-limit")>()
  return {
    ...actual,
    consumeRateLimit: mockConsumeRateLimit,
    clearAttempts: vi.fn(),
    recordAttempt: mockRecordAttempt,
  }
})

import { registerAction } from "../actions"
import { RATE_LIMIT_MESSAGE } from "@/shared/lib/rate-limit"

const NAME = "Player One"
const EMAIL = "newplayer@example.com"
const PASSWORD = "CorrectHorse1"

function form(fields: Record<string, string> = {}) {
  const data = new FormData()
  data.set("name", NAME)
  data.set("email", EMAIL)
  data.set("password", PASSWORD)
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

/** Signup completed = the account was created and the user was signed in. */
function expectRegistered() {
  expect(mockPrisma.user.create).toHaveBeenCalledTimes(1)
  expect(mockSignIn).toHaveBeenCalledWith("credentials", {
    email: EMAIL,
    password: PASSWORD,
    redirectTo: "/onboarding",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConsumeRateLimit.mockResolvedValue(true)
  mockPrisma.user.findUnique.mockResolvedValue(null)
  mockPrisma.user.create.mockResolvedValue({ id: "user-1" })
  mockPrisma.playerProfile.upsert.mockResolvedValue({})
  mockSignIn.mockResolvedValue(undefined)
})

describe("registerAction", () => {
  it("registers an account and signs the new user in", async () => {
    expect(await registerAction(form())).toBeUndefined()
    expectRegistered()
  })

  // Gate off (SIGNUP_INVITE_CODE unset): a leftover field from a stale client
  // must not change the outcome.
  it("ignores a stray inviteCode field when the gate is off", async () => {
    expect(await registerAction(form({ inviteCode: "whatever" }))).toBeUndefined()
    expectRegistered()
  })

  it("refuses to register when the signup window is exhausted", async () => {
    mockConsumeRateLimit.mockResolvedValue(false)

    expect(await registerAction(form())).toEqual({ error: RATE_LIMIT_MESSAGE })
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it("refuses an email that is already registered", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "existing" })

    expect(await registerAction(form())).toEqual({ error: "Email already registered" })
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  describe("with SIGNUP_INVITE_CODE set", () => {
    beforeEach(() => {
      vi.stubEnv("SIGNUP_INVITE_CODE", "Beta-2026")
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it("registers when the code matches exactly", async () => {
      expect(await registerAction(form({ inviteCode: "Beta-2026" }))).toBeUndefined()
      expectRegistered()
    })

    it("accepts a code with surrounding whitespace", async () => {
      expect(await registerAction(form({ inviteCode: "  Beta-2026  " }))).toBeUndefined()
      expectRegistered()
    })

    it("rejects a wrong code", async () => {
      expect(await registerAction(form({ inviteCode: "nope" }))).toEqual({
        error: "Invalid invite code.",
      })
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
      expect(mockSignIn).not.toHaveBeenCalled()
    })

    it("rejects a code that differs only in case", async () => {
      expect(await registerAction(form({ inviteCode: "beta-2026" }))).toEqual({
        error: "Invalid invite code.",
      })
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it("rejects a submission with no code at all", async () => {
      expect(await registerAction(form())).toEqual({ error: "Invalid invite code." })
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it("still enforces the signup rate limit on a rejected code", async () => {
      await registerAction(form({ inviteCode: "nope" }))
      expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1)
      // The consume writes its own row; the separate record call is gone.
      expect(mockRecordAttempt).not.toHaveBeenCalled()
    })
  })
})
