// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
  sendEmail: vi.fn(),
  createPasswordResetToken: vi.fn(),
  consumePasswordResetToken: vi.fn(),
  revokeUserSessions: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("@/shared/lib/email", () => ({ sendEmail: mocks.sendEmail }))
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "1.2.3.4" }) }))
vi.mock("../session-revocation", () => ({ revokeUserSessions: mocks.revokeUserSessions }))
vi.mock("@/shared/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/rate-limit")>()
  return {
    ...actual,
    consumeRateLimit: mocks.consumeRateLimit,
    recordAttempt: mocks.recordAttempt,
  }
})
vi.mock("../password-reset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../password-reset")>()
  return {
    ...actual,
    createPasswordResetToken: mocks.createPasswordResetToken,
    consumePasswordResetToken: mocks.consumePasswordResetToken,
  }
})

import { requestPasswordResetAction, resetPasswordAction } from "../password-reset.actions"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const ACCOUNT = {
  id: "user_1",
  email: "real@example.com",
  password: "$2a$12$hash",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.recordAttempt.mockResolvedValue(undefined)
  mocks.sendEmail.mockResolvedValue({ ok: true, transport: "log" })
  mocks.createPasswordResetToken.mockResolvedValue("raw-token-value-000000000000000000")
  mocks.prisma.user.update.mockResolvedValue({})
  mocks.revokeUserSessions.mockResolvedValue(undefined)
})

describe("requestPasswordResetAction — enumeration resistance", () => {
  it("returns an identical reply for a real account and an unknown one", async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce(ACCOUNT)
    const real = await requestPasswordResetAction(form({ email: ACCOUNT.email }))

    mocks.prisma.user.findUnique.mockResolvedValueOnce(null)
    const unknown = await requestPasswordResetAction(form({ email: "nobody@example.com" }))

    expect(real).toEqual(unknown)
    expect(real.ok).toBe(true)
  })

  it("returns the same reply for a malformed address, without querying", async () => {
    const result = await requestPasswordResetAction(form({ email: "not-an-email" }))

    expect(result.ok).toBe(true)
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("returns the same reply when rate limited", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const result = await requestPasswordResetAction(form({ email: ACCOUNT.email }))

    expect(result.ok).toBe(true)
    // Being throttled must not be observable, and must not send mail.
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(mocks.createPasswordResetToken).not.toHaveBeenCalled()
  })

  it("returns the same reply when the email fails to send", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(ACCOUNT)
    mocks.sendEmail.mockResolvedValue({ ok: false, transport: "resend", error: "boom" })

    const result = await requestPasswordResetAction(form({ email: ACCOUNT.email }))

    expect(result.ok).toBe(true)
    expect(result).not.toHaveProperty("error")
  })
})

describe("requestPasswordResetAction — who gets a link", () => {
  it("sends to an account with a password", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(ACCOUNT)

    await requestPasswordResetAction(form({ email: ACCOUNT.email }))

    expect(mocks.createPasswordResetToken).toHaveBeenCalledWith("user_1")
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    const message = mocks.sendEmail.mock.calls[0][0]
    expect(message.to).toBe(ACCOUNT.email)
    expect(message.text).toContain("/reset-password?token=")
  })

  it("does not send to an OAuth-only account", async () => {
    // Minting a password here would let it bypass the provider they signed up with.
    mocks.prisma.user.findUnique.mockResolvedValue({ ...ACCOUNT, password: null })

    await requestPasswordResetAction(form({ email: ACCOUNT.email }))

    expect(mocks.createPasswordResetToken).not.toHaveBeenCalled()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("consumes an attempt on both the address and the IP window", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(ACCOUNT)

    await requestPasswordResetAction(form({ email: "MiXeD@Example.com" }))

    const keys = mocks.consumeRateLimit.mock.calls.map((call) => call[1])
    // The address key is lowercased so casing cannot multiply the allowance.
    expect(keys).toContain("mixed@example.com")
    expect(keys).toContain("1.2.3.4")
    // The consume writes its own row; the separate record call is gone.
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
  })
})

describe("resetPasswordAction", () => {
  it("sets a new password and invalidates existing sessions", async () => {
    mocks.consumePasswordResetToken.mockResolvedValue({ ok: true, userId: "user_1" })

    const result = await resetPasswordAction(
      form({ token: "t".repeat(43), password: "NewPassw0rd" })
    )

    expect(result).toEqual({ ok: true })

    const update = mocks.prisma.user.update.mock.calls[0][0]
    expect(update.where).toEqual({ id: "user_1" })
    // passwordChangedAt is what makes a stolen session cookie useless afterwards.
    expect(update.data.passwordChangedAt).toBeInstanceOf(Date)
    expect(update.data.password).not.toBe("NewPassw0rd")
    expect(mocks.revokeUserSessions).toHaveBeenCalledWith("user_1")
  })

  it("burns the token before writing the password", async () => {
    mocks.consumePasswordResetToken.mockResolvedValue({ ok: true, userId: "user_1" })

    await resetPasswordAction(form({ token: "t".repeat(43), password: "NewPassw0rd" }))

    expect(mocks.consumePasswordResetToken.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.user.update.mock.invocationCallOrder[0]
    )
  })

  it("reports an expired link distinctly so the form can offer a new one", async () => {
    mocks.consumePasswordResetToken.mockResolvedValue({ ok: false, reason: "expired" })

    const result = await resetPasswordAction(
      form({ token: "t".repeat(43), password: "NewPassw0rd" })
    )

    expect(result).toMatchObject({ ok: false, expired: true })
    expect(mocks.prisma.user.update).not.toHaveBeenCalled()
  })

  it("rejects an invalid token", async () => {
    mocks.consumePasswordResetToken.mockResolvedValue({ ok: false, reason: "invalid" })

    const result = await resetPasswordAction(
      form({ token: "t".repeat(43), password: "NewPassw0rd" })
    )

    expect(result.ok).toBe(false)
    expect(mocks.prisma.user.update).not.toHaveBeenCalled()
  })

  it.each([
    ["too short", "Ab1"],
    ["no uppercase", "newpassw0rd"],
    ["no digit", "NewPassword"],
  ])("enforces the sign-up password rules (%s)", async (_label, password) => {
    const result = await resetPasswordAction(form({ token: "t".repeat(43), password }))

    expect(result.ok).toBe(false)
    // Rejected before the token is spent, so a weak first attempt does not cost
    // the user their link.
    expect(mocks.consumePasswordResetToken).not.toHaveBeenCalled()
  })

  it("rejects a missing token without consuming anything", async () => {
    const result = await resetPasswordAction(form({ password: "NewPassw0rd" }))

    expect(result.ok).toBe(false)
    expect(mocks.consumePasswordResetToken).not.toHaveBeenCalled()
  })
})
