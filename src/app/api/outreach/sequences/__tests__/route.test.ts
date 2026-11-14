// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  consumeRateLimit: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: () => mocks.auth() }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { OUTREACH_WRITE: "outreach:write" },
  consumeRateLimit: (...args: unknown[]) => mocks.consumeRateLimit(...args),
}))
vi.mock("@/features/jobs/services/outreach-sequence.service", () => ({
  OutreachSequenceError: class OutreachSequenceError extends Error {},
  createOutreachSequence: (...args: unknown[]) => mocks.create(...args),
  listOutreachSequences: (...args: unknown[]) => mocks.list(...args),
}))

import { GET, POST } from "../route"

const SEQUENCE = {
  id: "seq-1",
  name: "Acme recruiter plan",
  status: "DRAFT",
  contact: { id: "contact-1", name: "Maya Chen" },
  touches: [],
}

function request(body?: unknown, origin?: string) {
  return new Request("http://localhost/api/outreach/sequences", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(origin ? { origin } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } })
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.create.mockResolvedValue(SEQUENCE)
  mocks.list.mockResolvedValue([SEQUENCE])
})

describe("/api/outreach/sequences", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null)

    const res = await GET(request())

    expect(res.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("lists owned sequences with a private cache policy", async () => {
    const res = await GET(request())

    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await res.json()).toEqual({ sequences: [SEQUENCE] })
    expect(mocks.list).toHaveBeenCalledWith("user-1", { limit: 30 })
  })

  it("refuses a cross-origin create", async () => {
    const res = await POST(
      request(
        { name: "Acme recruiter plan", contact: { name: "Maya Chen" } },
        "https://evil.example"
      )
    )

    expect(res.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("rejects an invalid body", async () => {
    const res = await POST(request({ name: "" }))

    expect(res.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("creates a sequence with a contact", async () => {
    const res = await POST(
      request({
        name: "Acme recruiter plan",
        contact: { name: "Maya Chen", company: "Acme" },
        startOn: "2026-11-16",
      })
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ sequence: SEQUENCE })
    expect(mocks.create).toHaveBeenCalledWith("user-1", {
      name: "Acme recruiter plan",
      startOn: new Date("2026-11-16T00:00:00.000Z"),
      idempotencyKey: null,
      contact: { name: "Maya Chen", company: "Acme" },
    })
  })

  it("returns 429 when the write ceiling is spent", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await POST(
      request({ name: "Acme recruiter plan", contact: { name: "Maya Chen" } })
    )

    expect(res.status).toBe(429)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
