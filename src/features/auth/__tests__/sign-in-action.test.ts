// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockPrisma, mockSignIn, mockIsRateLimited, mockClearAttempts, mockRecordAttempt } =
  vi.hoisted(() => ({
    mockPrisma: { user: { findUnique: vi.fn() } },
    mockSignIn: vi.fn(),
    mockIsRateLimited: vi.fn(),
    mockClearAttempts: vi.fn(),
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
    isRateLimited: mockIsRateLimited,
    clearAttempts: mockClearAttempts,
    recordAttempt: mockRecordAttempt,
  }
})

import { signInAction } from "../actions"
import { RATE_LIMIT_MESSAGE } from "@/shared/lib/rate-limit"

const EMAIL = "player@example.com"
const PASSWORD = "CorrectHorse1"

function form(email: string, password: string) {
  const data = new FormData()
  data.set("email", email)
  data.set("password", password)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsRateLimited.mockResolvedValue(false)
  mockSignIn.mockResolvedValue(undefined)
})

describe("signInAction", () => {
  it("signs an account in and defaults the destination to /dashboard", async () => {
    expect(await signInAction(form(EMAIL, PASSWORD))).toBeUndefined()
    expect(mockSignIn).toHaveBeenCalledWith("credentials", {
      email: EMAIL,
      password: PASSWORD,
      redirectTo: "/dashboard",
    })
  })

  it("rejects a malformed submission before touching signIn", async () => {
    expect(await signInAction(form("not-an-email", PASSWORD))).toEqual({
      error: "Invalid email or password",
    })
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it("returns the rate-limit message when the window is exhausted", async () => {
    mockIsRateLimited.mockResolvedValue(true)

    expect(await signInAction(form(EMAIL, PASSWORD))).toEqual({ error: RATE_LIMIT_MESSAGE })
    expect(mockSignIn).not.toHaveBeenCalled()
  })
})
