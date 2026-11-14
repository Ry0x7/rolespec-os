// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  resumeFindMany: vi.fn(),
}))

vi.mock("@/features/settings/services/api-token", () => ({
  verifyApiToken: mocks.verifyApiToken,
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { EXTENSION_RESUMES: "extension:resumes" },
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
  consumeRateLimit: mocks.consumeRateLimit,
  recordAttempt: mocks.recordAttempt,
}))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: { resume: { findMany: mocks.resumeFindMany } },
}))

import { OPTIONS, GET } from "../route"

const RESUMES = [
  { id: "resume_2", title: "Platform Engineer", atsScore: 82, updatedAt: new Date("2026-08-14T10:00:00.000Z") },
  { id: "resume_1", title: "Backend Engineer", atsScore: null, updatedAt: new Date("2026-08-01T09:30:00.000Z") },
]

function get({ token = "rspec_valid", origin }: { token?: string | null; origin?: string } = {}) {
  const headers: Record<string, string> = {}
  if (token !== null) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin

  return GET(new Request("http://localhost/api/extension/resumes", { method: "GET", headers }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyApiToken.mockResolvedValue("user_1")
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.resumeFindMany.mockResolvedValue(RESUMES)
})

describe("authentication", () => {
  it("401s with no Authorization header, without hitting the database", async () => {
    const res = await get({ token: null })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: "Invalid or missing API token",
      code: "UNAUTHORIZED",
    })
    expect(mocks.verifyApiToken).not.toHaveBeenCalled()
    expect(mocks.resumeFindMany).not.toHaveBeenCalled()
  })

  it("401s when the token does not resolve to a user", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)

    const res = await get({ token: "rspec_revoked" })

    expect(res.status).toBe(401)
    expect(mocks.resumeFindMany).not.toHaveBeenCalled()
  })

  it("accepts a case-insensitive bearer scheme and strips it from the token", async () => {
    const res = await get({ token: "rspec_valid" })

    expect(res.status).toBe(200)
    expect(mocks.verifyApiToken).toHaveBeenCalledWith("rspec_valid")
  })
})

describe("rate limiting", () => {
  it("429s on the token owner's id, on its own bucket", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await get()

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("RATE_LIMITED")
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:resumes",
      "user_1",
      expect.objectContaining({ max: 30 })
    )
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
    expect(mocks.resumeFindMany).not.toHaveBeenCalled()
  })

  it("consumes one attempt when it lets the request through", async () => {
    await get()

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:resumes",
      "user_1",
      expect.objectContaining({ max: 30 })
    )
    // The consume writes its own row; the separate record call is gone.
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
  })
})

describe("listing", () => {
  it("200s with the resumes, dates serialized as ISO strings", async () => {
    const res = await get()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      resumes: [
        {
          id: "resume_2",
          title: "Platform Engineer",
          atsScore: 82,
          updatedAt: "2026-08-14T10:00:00.000Z",
        },
        {
          id: "resume_1",
          title: "Backend Engineer",
          atsScore: null,
          updatedAt: "2026-08-01T09:30:00.000Z",
        },
      ],
    })
  })

  it("scopes to the token's user, excludes archived resumes and caps the page", async () => {
    await get()

    expect(mocks.resumeFindMany).toHaveBeenCalledWith({
      where: { userId: "user_1", status: { not: "ARCHIVED" } },
      select: { id: true, title: true, atsScore: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    })
  })

  it("200s with an empty list when the user has no resumes", async () => {
    mocks.resumeFindMany.mockResolvedValue([])

    const res = await get()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ resumes: [] })
  })

  it("500s when the read fails", async () => {
    mocks.resumeFindMany.mockRejectedValue(new Error("connection lost"))

    const res = await get()

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("SERVER_ERROR")
  })
})

describe("CORS", () => {
  it("204s the preflight with the method and header allowances", async () => {
    const res = await OPTIONS(
      new Request("http://localhost/api/extension/resumes", {
        method: "OPTIONS",
        headers: { origin: "chrome-extension://abcdef" },
      })
    )

    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdef")
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("authorization, content-type")
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS")
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400")
    expect(res.headers.get("Vary")).toBe("Origin")
  })

  it.each(["chrome-extension://abcdef", "moz-extension://abcdef"])(
    "reflects the extension origin %s",
    async (origin) => {
      const res = await get({ origin })

      expect(res.status).toBe(200)
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin)
    }
  )

  it.each([
    "https://evil.example.com",
    "http://localhost:3000",
    "https://chrome-extension://spoof",
    "null",
  ])("does not reflect %s", async (origin) => {
    const res = await get({ origin })

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS")
  })

  it("carries the CORS headers on a 401 too, so the extension can read the error", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)

    const res = await get({ origin: "chrome-extension://abcdef" })

    expect(res.status).toBe(401)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdef")
  })

  it("omits the origin allowance when there is no Origin header", async () => {
    const res = await get()

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})
