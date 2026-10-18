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

  it("keeps the ATS watchlist the settings form never sends", async () => {
    expect(await updatePreferences(INPUT)).toEqual({ success: true })

    const data = mockPrisma.user.update.mock.calls[0][0].data
    expect(data.preferences).toEqual({
      defaultAiInstructions: "be brief",
      emailNotifications: false,
      preferredCurrency: "USD",
      atsWatchlist: { greenhouse: ["figma"], lever: ["ro"], ashby: [], bamboohr: [], freshteam: [], workday: [] },
    })
  })
})
