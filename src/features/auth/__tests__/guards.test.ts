import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.fn()
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})

vi.mock("../config", () => ({ auth: mockAuth }))
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}))

describe("auth guards", () => {
  beforeEach(() => {
    mockAuth.mockReset()
    mockRedirect.mockClear()
  })

  it("requireUser redirects to /sign-in without a session", async () => {
    mockAuth.mockResolvedValue(null)
    const { requireUser } = await import("../guards")

    await expect(requireUser()).rejects.toThrow("REDIRECT:/sign-in")
    expect(mockRedirect).toHaveBeenCalledWith("/sign-in")
  })

  it("requireUser returns the session when signed in", async () => {
    const session = { user: { id: "u1", role: "USER" } }
    mockAuth.mockResolvedValue(session)
    const { requireUser } = await import("../guards")

    await expect(requireUser()).resolves.toBe(session)
  })

  it("requireAdmin returns the user session in self-hosted mode", async () => {
    const session = { user: { id: "u1", role: "ADMIN" } }
    mockAuth.mockResolvedValue(session)
    const { requireAdmin } = await import("../guards")

    await expect(requireAdmin()).resolves.toBe(session)
  })

  it("requireAdminElevated returns the user session without extra elevation prompt", async () => {
    const session = { user: { id: "u1", role: "ADMIN" } }
    mockAuth.mockResolvedValue(session)
    const { requireAdminElevated } = await import("../guards")

    await expect(requireAdminElevated()).resolves.toBe(session)
  })

  it("assertAdminElevated returns the user session", async () => {
    const session = { user: { id: "u1", role: "ADMIN" } }
    mockAuth.mockResolvedValue(session)
    const { assertAdminElevated } = await import("../guards")

    await expect(assertAdminElevated()).resolves.toBe(session)
  })
})
