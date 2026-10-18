// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  careerProfileFindUnique: vi.fn(),
  qualifyCandidate: vi.fn(),
}))

vi.mock("@/features/settings/services/api-token", () => ({
  verifyApiToken: mocks.verifyApiToken,
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { EXTENSION_QUALIFY: "extension:qualify" },
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
  consumeRateLimit: mocks.consumeRateLimit,
  recordAttempt: mocks.recordAttempt,
}))
// Only the one read exists on this mock: any write (Job, JobApplication, usage
// event) would throw on an undefined delegate, so a 200 proves nothing persisted.
vi.mock("@/shared/lib/prisma", () => ({
  prisma: { careerProfile: { findUnique: mocks.careerProfileFindUnique } },
}))

// The real pass, observed: the spy calls through so verdicts stay genuine, and
// lets a test see the exact posting the route built.
vi.mock("@/features/discovery/services/qualify.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/discovery/services/qualify.service")>()
  mocks.qualifyCandidate.mockImplementation(actual.qualifyCandidate)
  return { ...actual, qualifyCandidate: mocks.qualifyCandidate }
})

import {
  qualifyCandidate,
  toQualificationProfile,
} from "@/features/discovery/services/qualify.service"

import { OPTIONS, POST } from "../route"

const PROFILE_ROW = {
  locations: ["Berlin, Germany"],
  openToRelocation: false,
  workModes: ["REMOTE", "HYBRID"],
  requiresSponsorship: false,
  experienceLevel: null,
  targetRoles: [{ title: "Backend Engineer", active: true }],
  capabilities: [
    { name: "TypeScript", confirmed: true },
    { name: "PostgreSQL", confirmed: false },
  ],
}

const MATCHING = {
  key: "li:111",
  title: "Senior Backend Engineer",
  companyName: "Acme",
  location: "Berlin, Germany",
  workType: "HYBRID",
  description:
    "We build our platform in TypeScript on PostgreSQL. You will own backend services end to end.",
}

const UNRELATED = {
  key: "li:222",
  title: "Pastry Chef",
  companyName: "Bakery Co",
  location: "Lisbon, Portugal",
  workType: null,
  description: "Laminated doughs, early mornings, and a love of butter.",
}

function post(
  body: unknown,
  { token = "rspec_valid", origin }: { token?: string | null; origin?: string } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token !== null) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin

  return POST(
    new Request("http://localhost/api/extension/qualify", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyApiToken.mockResolvedValue("user_1")
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.careerProfileFindUnique.mockResolvedValue(PROFILE_ROW)
})

describe("authentication", () => {
  it("401s with no Authorization header, without hitting the database", async () => {
    const res = await post({ postings: [MATCHING] }, { token: null })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: "Invalid or missing API token",
      code: "UNAUTHORIZED",
    })
    expect(mocks.verifyApiToken).not.toHaveBeenCalled()
    expect(mocks.careerProfileFindUnique).not.toHaveBeenCalled()
  })

  it("401s when the token does not resolve to a user", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)

    const res = await post({ postings: [MATCHING] }, { token: "rspec_revoked" })

    expect(res.status).toBe(401)
    expect(mocks.careerProfileFindUnique).not.toHaveBeenCalled()
  })
})

describe("rate limiting", () => {
  it("429s on the token owner's id, on its own bucket of 60", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await post({ postings: [MATCHING] })

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("RATE_LIMITED")
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:qualify",
      "user_1",
      expect.objectContaining({ max: 60, windowMs: 10 * 60 * 1000 })
    )
    expect(mocks.careerProfileFindUnique).not.toHaveBeenCalled()
  })
})

describe("validation", () => {
  it("400s on a non-JSON body", async () => {
    const res = await post("not json")

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Body must be JSON", code: "VALIDATION" })
  })

  it.each([
    ["missing postings", {}],
    ["empty postings", { postings: [] }],
    ["a posting without a title", { postings: [{ key: "a" }] }],
    ["an empty key", { postings: [{ key: "", title: "Engineer" }] }],
    ["an unknown work type", { postings: [{ key: "a", title: "Engineer", workType: "ONSITE_ISH" }] }],
    ["a url that is not a URL", { postings: [{ key: "a", title: "Engineer", url: "not a url" }] }],
    ["a non-http(s) url", { postings: [{ key: "a", title: "Engineer", url: "javascript:alert(1)" }] }],
    ["an oversized description", { postings: [{ key: "a", title: "Engineer", description: "x".repeat(20001) }] }],
  ])("400s on %s, with the shared error shape", async (_label, body) => {
    const res = await post(body)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe("VALIDATION")
    expect(typeof json.error).toBe("string")
    expect(mocks.careerProfileFindUnique).not.toHaveBeenCalled()
  })

  it("accepts exactly 40 postings and rejects 41", async () => {
    const batch = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ key: `k${i}`, title: "Backend Engineer" }))

    const ok = await post({ postings: batch(40) })
    expect(ok.status).toBe(200)
    expect((await ok.json()).results).toHaveLength(40)

    const tooMany = await post({ postings: batch(41) })
    expect(tooMany.status).toBe(400)
    expect((await tooMany.json()).code).toBe("VALIDATION")
  })
})

describe("qualifying", () => {
  it("200s with one result per posting, keyed and ordered as sent", async () => {
    const res = await post({ postings: [MATCHING, UNRELATED] })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.profileComplete).toBe(true)
    expect(json.results.map((r: { key: string }) => r.key)).toEqual(["li:111", "li:222"])

    const [matching, unrelated] = json.results
    expect(matching.matched).toEqual(["TypeScript", "PostgreSQL"])
    expect(matching.confirmedCount).toBe(1)
    expect(unrelated.matched).toEqual([])
    expect(unrelated.confirmedCount).toBe(0)
    for (const result of json.results) {
      expect(["STRONG", "WORTH_A_LOOK", "WEAK", "BLOCKED"]).toContain(result.verdict)
      expect([null, "LOW", "MEDIUM", "HIGH"]).toContain(result.riskLevel)
      expect(Object.keys(result).sort()).toEqual(
        ["confirmedCount", "key", "marketFit", "matched", "riskLevel", "verdict"]
      )
    }
  })

  it("returns the same verdict the clip's qualification pass gives for the same posting", async () => {
    const res = await post({ postings: [MATCHING, UNRELATED] })
    const json = await res.json()

    const profile = toQualificationProfile(PROFILE_ROW as never)
    for (const [i, posting] of [MATCHING, UNRELATED].entries()) {
      const expected = qualifyCandidate(
        {
          title: posting.title,
          companyName: posting.companyName,
          url: "",
          location: posting.location,
          ...(posting.workType && { workType: posting.workType as never }),
          description: posting.description,
        },
        profile
      )
      expect(json.results[i]).toEqual({
        key: posting.key,
        verdict: expected.verdict,
        riskLevel: expected.risk.level,
        marketFit: expected.marketFit.fit,
        confirmedCount: expected.match.confirmedCount,
        matched: expected.match.matched,
      })
    }
  })

  it("forwards the posting url to the qualification pass, and sends \"\" when absent", async () => {
    const url = "https://www.linkedin.com/jobs/view/111/"
    const res = await post({ postings: [{ ...MATCHING, url }, UNRELATED] })

    expect(res.status).toBe(200)
    expect(mocks.qualifyCandidate).toHaveBeenCalledTimes(2)
    expect(mocks.qualifyCandidate.mock.calls[0][0]).toEqual(expect.objectContaining({ url }))
    expect(mocks.qualifyCandidate.mock.calls[1][0]).toEqual(expect.objectContaining({ url: "" }))
  })

  it("reads only the token owner's profile", async () => {
    await post({ postings: [MATCHING] })

    expect(mocks.careerProfileFindUnique).toHaveBeenCalledTimes(1)
    expect(mocks.careerProfileFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" } })
    )
  })

  it("200s with profileComplete:false and no results when the user has no profile", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(null)

    const res = await post({ postings: [MATCHING, UNRELATED] })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ profileComplete: false, results: [] })
  })

  it("500s when the profile read fails", async () => {
    mocks.careerProfileFindUnique.mockRejectedValue(new Error("connection lost"))

    const res = await post({ postings: [MATCHING] })

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("SERVER_ERROR")
  })
})

describe("CORS", () => {
  it("204s the preflight with the method and header allowances", async () => {
    const res = await OPTIONS(
      new Request("http://localhost/api/extension/qualify", {
        method: "OPTIONS",
        headers: { origin: "chrome-extension://abcdef" },
      })
    )

    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdef")
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS")
  })

  it("does not reflect a web origin", async () => {
    const res = await post({ postings: [MATCHING] }, { origin: "https://evil.example.com" })

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("carries the CORS headers on a 401 too", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)

    const res = await post({ postings: [MATCHING] }, { origin: "moz-extension://abcdef" })

    expect(res.status).toBe(401)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("moz-extension://abcdef")
  })
})
