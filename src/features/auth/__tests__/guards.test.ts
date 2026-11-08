import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.fn()
const mockCurrentRequestPath = vi.fn()
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})

vi.mock("../config", () => ({
  auth: mockAuth,
  currentRequestPath: mockCurrentRequestPath,
  safeReturnPath: (value: string | null, fallback = "/dashboard") =>
    value && value.startsWith("/") ? value : fallback,
}))
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}))

describe("auth guards", () => {
  beforeEach(() => {
    mockAuth.mockReset()
    mockCurrentRequestPath.mockReset()
    mockRedirect.mockClear()
    mockCurrentRequestPath.mockResolvedValue("/dashboard")
  })

  it("redirects an unauthenticated request to the owner unlock gate", async () => {
    mockAuth.mockResolvedValue(null)
    const { requireUser } = await import("../guards")

    await expect(requireUser()).rejects.toThrow("REDIRECT:/unlock?next=%2Fdashboard")
    expect(mockRedirect).toHaveBeenCalledWith("/unlock?next=%2Fdashboard")
  })

  it("preserves the requested path for the return trip", async () => {
    mockAuth.mockResolvedValue(null)
    mockCurrentRequestPath.mockResolvedValue("/jobs/abc?tab=track")
    const { requireUser } = await import("../guards")

    await expect(requireUser()).rejects.toThrow(
      "REDIRECT:/unlock?next=%2Fjobs%2Fabc%3Ftab%3Dtrack"
    )
  })

  it("requireUser returns the owner session when access is allowed", async () => {
    const session = { user: { id: "u1", role: "ADMIN" } }
    mockAuth.mockResolvedValue(session)
    const { requireUser } = await import("../guards")

    await expect(requireUser()).resolves.toBe(session)
  })

  it("requireAdmin returns the owner session", async () => {
    const session = { user: { id: "u1", role: "ADMIN" } }
    mockAuth.mockResolvedValue(session)
    const { requireAdmin } = await import("../guards")

    await expect(requireAdmin()).resolves.toBe(session)
  })

  it("requireAdminElevated returns the owner session without a second prompt", async () => {
    const session = { user: { id: "u1", role: "ADMIN" } }
    mockAuth.mockResolvedValue(session)
    const { requireAdminElevated } = await import("../guards")

    await expect(requireAdminElevated()).resolves.toBe(session)
  })

  it("assertAdminElevated returns the owner session", async () => {
    const session = { user: { id: "u1", role: "ADMIN" } }
    mockAuth.mockResolvedValue(session)
    const { assertAdminElevated } = await import("../guards")

    await expect(assertAdminElevated()).resolves.toBe(session)
  })
})
