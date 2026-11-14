import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const { mockPrune } = vi.hoisted(() => ({ mockPrune: vi.fn() }))

vi.mock("@/features/export/services/store-export", () => ({
  pruneExpiredExports: mockPrune,
}))

import { GET } from "../route"

const SECRET = "cron-secret-value"

const RESULT = {
  retentionDays: 90,
  cutoff: "2026-05-27T00:00:00.000Z",
  rows: 4,
  blobs: 12,
  batches: 3,
}

function get(authorization?: string) {
  return GET(
    new Request("http://localhost/api/cron/prune-exports", {
      headers: authorization ? { authorization } : {},
    })
  )
}

describe("GET /api/cron/prune-exports", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    mockPrune.mockReset().mockResolvedValue(RESULT)
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it("401s without an authorization header", async () => {
    const res = await get()

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" })
    expect(mockPrune).not.toHaveBeenCalled()
  })

  it("401s on a wrong bearer token", async () => {
    const res = await get("Bearer not-the-secret")

    expect(res.status).toBe(401)
    expect(mockPrune).not.toHaveBeenCalled()
  })

  it("401s on the right secret without the Bearer scheme", async () => {
    const res = await get(SECRET)

    expect(res.status).toBe(401)
    expect(mockPrune).not.toHaveBeenCalled()
  })

  it("401s when CRON_SECRET is unset, even for an empty bearer", async () => {
    delete process.env.CRON_SECRET

    expect((await get()).status).toBe(401)
    expect((await get("Bearer ")).status).toBe(401)
    expect((await get("Bearer undefined")).status).toBe(401)
    expect(mockPrune).not.toHaveBeenCalled()
  })

  it("401s when CRON_SECRET is set to an empty string", async () => {
    process.env.CRON_SECRET = ""

    const res = await get("Bearer ")

    expect(res.status).toBe(401)
    expect(mockPrune).not.toHaveBeenCalled()
  })

  it("prunes and returns the counts with a valid bearer token", async () => {
    const res = await get(`Bearer ${SECRET}`)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ pruned: RESULT })
    expect(mockPrune).toHaveBeenCalledTimes(1)
    expect(mockPrune).toHaveBeenCalledWith()
  })
})
