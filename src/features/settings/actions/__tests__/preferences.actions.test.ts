import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockRevalidatePath } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
  mockRevalidatePath: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))

import { updatePreferences } from "../preferences.actions"

const INPUT = {
  dailyApplicationGoal: 4,
  defaultAiInstructions: "be brief",
  emailNotifications: false,
  preferredCurrency: "USD" as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockPrisma.user.findUnique.mockResolvedValue({
    preferences: { atsWatchlist: { greenhouse: ["figma"], lever: ["ro"] } },
  })
  mockPrisma.user.update.mockResolvedValue({ id: "user-1" })
})

describe("updatePreferences", () => {
  it("refuses without a session", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await updatePreferences(INPUT)).toEqual({ error: "Unauthorized" })
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("rejects a daily goal outside the settings range", async () => {
    expect(
      await updatePreferences({ ...INPUT, dailyApplicationGoal: 0 })
    ).toEqual({ error: "Set a daily goal between 1 and 20" })
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("keeps the ATS watchlist the settings form never sends", async () => {
    expect(await updatePreferences(INPUT)).toEqual({ success: true })

    const data = mockPrisma.user.update.mock.calls[0][0].data
    expect(data.preferences).toEqual({
      dailyApplicationGoal: 4,
      defaultAiInstructions: "be brief",
      emailNotifications: false,
      preferredCurrency: "USD",
      atsWatchlist: { greenhouse: ["figma"], lever: ["ro"], ashby: [], bamboohr: [], freshteam: [], workday: [] },
      // The value policy is part of the same write now; a save must not drop it.
      opportunityValue: expect.objectContaining({
        preset: "BALANCED",
        minimumPayStrict: false,
        unknownPay: "FLAG",
      }),
    })
  })

  it("preserves a custom value policy when the caller omits it", async () => {
    const custom = {
      preset: "PAY_OVER_LOAD" as const,
      weights: null,
      minimumAnnualPay: "900000",
      minimumPayCurrency: "PHP" as const,
      minimumPayStrict: true,
      workloadPreference: "LIGHTER" as const,
      unknownPay: "REJECT" as const,
    }
    mockPrisma.user.findUnique.mockResolvedValue({
      preferences: { atsWatchlist: { greenhouse: [], lever: [] }, opportunityValue: custom },
    })

    expect(await updatePreferences(INPUT)).toEqual({ success: true })
    const data = mockPrisma.user.update.mock.calls[0][0].data
    expect(data.preferences.opportunityValue).toEqual(custom)
  })

  it("honours an explicitly submitted value policy", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ preferences: {} })
    const submitted = {
      preset: "PAY_OVER_LOAD" as const,
      weights: null,
      minimumAnnualPay: "100000",
      minimumPayCurrency: "USD" as const,
      minimumPayStrict: true,
      workloadPreference: "BALANCED" as const,
      unknownPay: "FLAG" as const,
    }

    expect(await updatePreferences({ ...INPUT, opportunityValue: submitted })).toEqual({
      success: true,
    })
    const data = mockPrisma.user.update.mock.calls[0][0].data
    expect(data.preferences.opportunityValue).toEqual(submitted)
  })
})
