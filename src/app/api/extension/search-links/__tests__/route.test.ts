// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  loadCareerProfile: vi.fn(),
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
vi.mock("@/features/career-profile/services/career-profile.service", () => ({
  loadCareerProfile: mocks.loadCareerProfile,
}))

import { OPTIONS, GET } from "../route"

/** A Philippines profile: two active roles, one inactive, mixed capabilities. */
const PH_PROFILE = {
  locations: ["Philippines"],
  workModes: ["HYBRID"],
  experienceLevel: "MID",
  targetRoles: [
    { title: "Data Analyst", priority: 0, active: true },
    { title: "Business Analyst", priority: 1, active: true },
    { title: "Project Manager", priority: 2, active: false },
  ],
  capabilities: [
    { name: "SQL", confirmed: true },
    { name: "Power BI", confirmed: true },
    { name: "Python", confirmed: false },
  ],
}

const EMPTY_PROFILE = {
  locations: [],
  workModes: [],
  experienceLevel: null,
  targetRoles: [],
  capabilities: [],
}

type Body = {
  groups: Array<{
    role: string
    links: Array<{ board: string; label: string; query: string; location: string | null; url: string }>
  }>
  activeTargetRoleCount: number
}

function get({ token = "rspec_valid", origin }: { token?: string | null; origin?: string } = {}) {
  const headers: Record<string, string> = {}
  if (token !== null) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin

  return GET(new Request("http://localhost/api/extension/search-links", { method: "GET", headers }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyApiToken.mockResolvedValue("user_1")
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.loadCareerProfile.mockResolvedValue(PH_PROFILE)
})

describe("authentication", () => {
  it("401s with no Authorization header, without loading the profile", async () => {
    const res = await get({ token: null })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: "Invalid or missing API token",
      code: "UNAUTHORIZED",
    })
    expect(mocks.verifyApiToken).not.toHaveBeenCalled()
    expect(mocks.loadCareerProfile).not.toHaveBeenCalled()
  })

  it("401s when the token does not resolve to a user", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)

    const res = await get({ token: "rspec_revoked" })

    expect(res.status).toBe(401)
    expect(mocks.verifyApiToken).toHaveBeenCalledWith("rspec_revoked")
    expect(mocks.loadCareerProfile).not.toHaveBeenCalled()
  })
})

describe("rate limiting", () => {
  it("429s on the token owner's id, on the extension resumes bucket", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await get()

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("RATE_LIMITED")
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:resumes",
      "user_1",
      expect.objectContaining({ max: 30 })
    )
    expect(mocks.loadCareerProfile).not.toHaveBeenCalled()
  })
})

describe("search links", () => {
  it("200s with one group per active role, in priority order, from the token user's profile", async () => {
    const res = await get()

    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(mocks.loadCareerProfile).toHaveBeenCalledWith("user_1")

    const body = (await res.json()) as Body
    expect(body.activeTargetRoleCount).toBe(2)
    expect(body.groups).toHaveLength(2)
    expect(body.groups.map((group) => group.role)).toEqual(["Data Analyst", "Business Analyst"])
    expect(body.groups.some((group) => group.role === "Project Manager")).toBe(false)

    for (const group of body.groups) {
      expect(group.links.map((link) => link.board)).toEqual(["LINKEDIN", "INDEED", "JOBSTREET"])

      const linkedIn = group.links[0]
      expect(new URL(linkedIn.url).searchParams.get("keywords")).toContain(`"${group.role}"`)
      // Confirmed capabilities only — the unconfirmed one never steers the query.
      expect(linkedIn.query).toContain("SQL")
      expect(linkedIn.query).not.toContain("Python")
      expect(linkedIn.location).toBe("Philippines")

      expect(group.links[1].label).toBe("Indeed (PH)")
      expect(group.links[2].label).toBe("JobStreet (PH)")
    }
  })

  it("200s with no groups for an empty profile", async () => {
    mocks.loadCareerProfile.mockResolvedValue(EMPTY_PROFILE)

    const res = await get()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ groups: [], activeTargetRoleCount: 0 })
  })

  it("500s when the profile read fails", async () => {
    mocks.loadCareerProfile.mockRejectedValue(new Error("connection lost"))

    const res = await get()

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("SERVER_ERROR")
  })
})

describe("CORS", () => {
  it("204s the preflight with the method and header allowances", async () => {
    const res = await OPTIONS(
      new Request("http://localhost/api/extension/search-links", {
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
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("carries the CORS headers on a 429 too", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await get({ origin: "chrome-extension://abcdef" })

    expect(res.status).toBe(429)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdef")
  })
})
