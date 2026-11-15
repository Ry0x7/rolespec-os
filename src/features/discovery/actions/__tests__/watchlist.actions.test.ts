import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockRevalidatePath } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
  mockRevalidatePath: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))

import { updateAtsWatchlist } from "../watchlist.actions"

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})

  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockPrisma.user.findUnique.mockResolvedValue({
    preferences: {
      defaultAiInstructions: "be brief",
      emailNotifications: false,
      preferredCurrency: "USD",
      atsWatchlist: { greenhouse: ["gitlab"], lever: [] },
    },
  })
  mockPrisma.user.update.mockResolvedValue({ id: "user-1" })
})

describe("updateAtsWatchlist", () => {
  it("refuses without a session and never writes", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await updateAtsWatchlist({ greenhouse: [], lever: [], ashby: [] })).toEqual({
      error: "Unauthorized",
    })
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("rejects a slug a board id cannot be", async () => {
    const result = await updateAtsWatchlist({ greenhouse: ["not a slug"], lever: [], ashby: [] })

    expect(result).toHaveProperty("error")
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("stores the normalized, deduped list scoped to the caller", async () => {
    const result = await updateAtsWatchlist({
      greenhouse: [" Figma ", "FIGMA"],
      lever: ["spotify"],
      ashby: ["linear"],
    })

    expect(result).toEqual({ success: true })
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } })
    )
    const data = mockPrisma.user.update.mock.calls[0][0].data
    expect(data.preferences.atsWatchlist).toEqual({
      greenhouse: ["figma"],
      lever: ["spotify"],
      ashby: ["linear"],
      bamboohr: [], freshteam: [], workday: [],
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/jobs/discover")
  })

  it("does not clobber the preference keys the settings page owns", async () => {
    await updateAtsWatchlist({ greenhouse: ["figma"], lever: [], ashby: [] })

    const data = mockPrisma.user.update.mock.calls[0][0].data
    expect(data.preferences).toMatchObject({
      defaultAiInstructions: "be brief",
      emailNotifications: false,
      preferredCurrency: "USD",
    })
  })

  it("returns an error rather than throwing when the write fails", async () => {
    mockPrisma.user.update.mockRejectedValue(new Error("db down"))

    expect(await updateAtsWatchlist({ greenhouse: [], lever: [], ashby: [] })).toEqual({
      error: "Something went wrong. Please try again.",
    })
  })
})
