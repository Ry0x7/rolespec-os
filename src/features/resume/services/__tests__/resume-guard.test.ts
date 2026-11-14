import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { resume: { findFirst: vi.fn() } },
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import { requireLiveResume } from "../resume-guard"

describe("requireLiveResume", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("scopes the lookup to the owner and excludes archived rows", async () => {
    mockPrisma.resume.findFirst.mockResolvedValue({ id: "resume-1" })

    const result = await requireLiveResume("resume-1", "user-1")

    expect(result).toEqual({ id: "resume-1" })
    expect(mockPrisma.resume.findFirst).toHaveBeenCalledWith({
      where: { id: "resume-1", userId: "user-1", status: { not: "ARCHIVED" } },
      select: { id: true },
    })
  })

  it("returns null when nothing matches (missing, foreign, or archived)", async () => {
    mockPrisma.resume.findFirst.mockResolvedValue(null)

    expect(await requireLiveResume("resume-1", "user-1")).toBeNull()
  })
})
