// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  loadResumeTextForUser: vi.fn(),
  generateOutreachEmailAI: vi.fn(),
}))

vi.mock("@/features/settings/services/api-token", () => ({
  verifyApiToken: mocks.verifyApiToken,
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { EXTENSION_COLD_EMAIL: "extension:cold-email" },
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
  consumeRateLimit: mocks.consumeRateLimit,
  recordAttempt: mocks.recordAttempt,
}))
vi.mock("@/features/jobs/services/resume-text.service", () => ({
  loadResumeTextForUser: mocks.loadResumeTextForUser,
}))
vi.mock("@/features/jobs/services/outreach-email.service", () => ({
  generateOutreachEmailAI: mocks.generateOutreachEmailAI,
}))

import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { OPTIONS, POST } from "../route"

const VALID_BODY = { person: { name: "Dana Reed" } }

function post(
  body: unknown,
  { token = "rspec_valid", origin }: { token?: string | null; origin?: string } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token !== null) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin

  return POST(
    new Request("http://localhost/api/extension/cold-email", {
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
  mocks.loadResumeTextForUser.mockResolvedValue({ ok: true, resumeText: "## Summary\nresume" })
  mocks.generateOutreachEmailAI.mockResolvedValue({
    subject: "Quick question, Dana",
    body: "Hi Dana...",
  })
})

describe("authentication", () => {
  it("401s with no Authorization header, without generating", async () => {
    const res = await post(VALID_BODY, { token: null })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: "Invalid or missing API token",
      code: "UNAUTHORIZED",
    })
    expect(mocks.verifyApiToken).not.toHaveBeenCalled()
    expect(mocks.generateOutreachEmailAI).not.toHaveBeenCalled()
  })

  it("401s when the token does not resolve to a user", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)

    const res = await post(VALID_BODY, { token: "rspec_revoked" })

    expect(res.status).toBe(401)
    expect(mocks.generateOutreachEmailAI).not.toHaveBeenCalled()
  })
})

describe("rate limiting", () => {
  it("429s on the token owner's id", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await post(VALID_BODY)

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("RATE_LIMITED")
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:cold-email",
      "user_1",
      expect.objectContaining({ max: 10 })
    )
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
    expect(mocks.generateOutreachEmailAI).not.toHaveBeenCalled()
  })

  it("consumes one attempt when it lets the request through", async () => {
    await post(VALID_BODY)

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:cold-email",
      "user_1",
      expect.objectContaining({ max: 10 })
    )
    // The consume writes its own row; the separate record call is gone.
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
  })
})

describe("validation", () => {
  it.each([
    ["missing person", {}],
    ["missing name", { person: {} }],
    ["empty name", { person: { name: "" } }],
    ["oversized name", { person: { name: "x".repeat(201) } }],
    ["oversized about", { person: { name: "Dana", about: "x".repeat(5001) } }],
    ["oversized headline", { person: { name: "Dana", headline: "x".repeat(301) } }],
    ["bad profileUrl", { person: { name: "Dana", profileUrl: "not-a-url" } }],
    ["oversized instructions", { ...VALID_BODY, instructions: "x".repeat(1001) }],
    ["unknown messageType", { ...VALID_BODY, messageType: "carrier_pigeon" }],
    ["unknown tone", { ...VALID_BODY, tone: "sarcastic" }],
  ])("400s on %s", async (_label, body) => {
    const res = await post(body)

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("VALIDATION")
    expect(mocks.generateOutreachEmailAI).not.toHaveBeenCalled()
  })

  it("400s on a body that is not JSON", async () => {
    const res = await post("{not json")

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("VALIDATION")
  })

  it("returns the offending field in the message", async () => {
    const res = await post({ person: { name: "Dana" }, instructions: "x".repeat(1001) })

    expect((await res.json()).error).toContain("instructions")
  })
})

describe("resume lookup", () => {
  it("400s with actionable copy when the user has no resume", async () => {
    mocks.loadResumeTextForUser.mockResolvedValue({ ok: false, reason: "NO_RESUME" })

    const res = await post(VALID_BODY)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.code).toBe("VALIDATION")
    expect(json.error).toBe("No resume found. Create a resume in RoleSpec first.")
    expect(mocks.generateOutreachEmailAI).not.toHaveBeenCalled()
  })

  it("400s when the requested resumeId does not resolve", async () => {
    mocks.loadResumeTextForUser.mockResolvedValue({ ok: false, reason: "RESUME_NOT_FOUND" })

    const res = await post({ ...VALID_BODY, resumeId: "resume_9" })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("No resume found for that id")
    expect(mocks.loadResumeTextForUser).toHaveBeenCalledWith("user_1", "resume_9")
  })

  it("500s when the resume lookup throws", async () => {
    mocks.loadResumeTextForUser.mockRejectedValue(new Error("connection lost"))

    const res = await post(VALID_BODY)

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("SERVER_ERROR")
    expect(mocks.generateOutreachEmailAI).not.toHaveBeenCalled()
  })
})

describe("generation", () => {
  it("500s when generation throws", async () => {
    mocks.generateOutreachEmailAI.mockRejectedValue(new Error("model unavailable"))

    const res = await post(VALID_BODY)

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("SERVER_ERROR")
  })

  it("400s with AI_KEY_REQUIRED when the caller has no configured key", async () => {
    mocks.generateOutreachEmailAI.mockRejectedValue(new AiKeyRequiredError())

    const res = await post(VALID_BODY)

    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.code).toBe("AI_KEY_REQUIRED")
    expect(body.error).toBe("Add your API key in Settings → AI to use AI features.")
  })

  it("429s with AI_DAILY_LIMIT when the caller has spent their daily cap", async () => {
    mocks.generateOutreachEmailAI.mockRejectedValue(new AiDailyLimitError())

    const res = await post(VALID_BODY)

    expect(res.status).toBe(429)

    const body = await res.json()
    expect(body.code).toBe("AI_DAILY_LIMIT")
    expect(body.error).toBe("Daily AI request limit reached. Try again later.")
  })

  it("200s with the subject and body", async () => {
    const res = await post({
      person: {
        name: "Dana Reed",
        headline: "Head of Engineering",
        company: "Acme",
        about: "Building developer tools",
        profileUrl: "https://www.linkedin.com/in/dana",
      },
      instructions: "mention open-source work",
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      subject: "Quick question, Dana",
      body: "Hi Dana...",
    })
    expect(mocks.generateOutreachEmailAI).toHaveBeenCalledWith({
      userId: "user_1",
      resumeText: "## Summary\nresume",
      person: {
        name: "Dana Reed",
        headline: "Head of Engineering",
        company: "Acme",
        about: "Building developer tools",
        profileUrl: "https://www.linkedin.com/in/dana",
      },
      messageType: "cold_email",
      instructions: "mention open-source work",
    })
  })

  it("falls back to the newest resume when no resumeId is given", async () => {
    await post(VALID_BODY)

    expect(mocks.loadResumeTextForUser).toHaveBeenCalledWith("user_1", undefined)
  })
})

describe("message types", () => {
  it("defaults to cold_email when the field is absent", async () => {
    await post(VALID_BODY)

    expect(mocks.generateOutreachEmailAI).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "cold_email" })
    )
  })

  it("passes connection_note through and returns the empty subject", async () => {
    mocks.generateOutreachEmailAI.mockResolvedValue({
      subject: "",
      body: "Loved your work on developer tools — would enjoy connecting.",
    })

    const res = await post({ ...VALID_BODY, messageType: "connection_note" })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      subject: "",
      body: "Loved your work on developer tools — would enjoy connecting.",
    })
    expect(mocks.generateOutreachEmailAI).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "connection_note" })
    )
  })

  it("forwards the tone when one is given", async () => {
    const res = await post({ ...VALID_BODY, messageType: "linkedin_dm", tone: "direct" })

    expect(res.status).toBe(200)
    expect(mocks.generateOutreachEmailAI).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "linkedin_dm", tone: "direct" })
    )
  })

  it("still 200s for an older extension build that sends no tone", async () => {
    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(mocks.generateOutreachEmailAI).toHaveBeenCalledWith(
      expect.objectContaining({ tone: undefined })
    )
  })

  it("passes linkedin_dm through", async () => {
    const res = await post({ ...VALID_BODY, messageType: "linkedin_dm" })

    expect(res.status).toBe(200)
    expect(mocks.generateOutreachEmailAI).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "linkedin_dm" })
    )
  })
})

describe("CORS", () => {
  it("204s the preflight with the method and header allowances", async () => {
    const res = await OPTIONS(
      new Request("http://localhost/api/extension/cold-email", {
        method: "OPTIONS",
        headers: { origin: "chrome-extension://abcdef" },
      })
    )

    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdef")
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("authorization, content-type")
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS")
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400")
    expect(res.headers.get("Vary")).toBe("Origin")
  })

  it.each(["chrome-extension://abcdef", "moz-extension://abcdef"])(
    "reflects the extension origin %s",
    async (origin) => {
      const res = await post(VALID_BODY, { origin })

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
    const res = await post(VALID_BODY, { origin })

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS")
  })

  it("carries the CORS headers on a 400 too, so the extension can read the error", async () => {
    mocks.loadResumeTextForUser.mockResolvedValue({ ok: false, reason: "NO_RESUME" })

    const res = await post(VALID_BODY, { origin: "chrome-extension://abcdef" })

    expect(res.status).toBe(400)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdef")
  })

  it("omits the origin allowance when there is no Origin header", async () => {
    const res = await post(VALID_BODY)

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})

/**
 * The older-extension-build guarantee. A build that predates the name check must
 * never see a `signature` key, so the field is spread conditionally exactly like
 * `grounding` — and `missing_name` counts as nothing to report.
 */
describe("the signature check in the response envelope", () => {
  const WRONG_NAME = {
    issue: "wrong_name" as const,
    expectedName: "Marisol Reyes",
    signature: ["Best,", "Cebu General Hospital staff nurse"],
    offending: ["Cebu General Hospital staff nurse"],
  }
  const MISSING_NAME = {
    issue: "missing_name" as const,
    expectedName: "Marisol Reyes",
    signature: ["Best regards,"],
    offending: [],
  }

  it("omits the key entirely on a clean draft", async () => {
    const res = await post(VALID_BODY)
    const json = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect("signature" in json).toBe(false)
  })

  it("omits the key for a missing_name finding", async () => {
    mocks.generateOutreachEmailAI.mockResolvedValue({
      subject: "Quick question, Dana",
      body: "Hi Dana...",
      signature: MISSING_NAME,
    })

    const json = (await (await post(VALID_BODY)).json()) as Record<string, unknown>

    expect("signature" in json).toBe(false)
  })

  it("includes it for a wrong_name finding", async () => {
    mocks.generateOutreachEmailAI.mockResolvedValue({
      subject: "Quick question, Dana",
      body: "Hi Dana...",
      signature: WRONG_NAME,
    })

    const json = (await (await post(VALID_BODY)).json()) as Record<string, unknown>

    expect(json.signature).toEqual(WRONG_NAME)
  })
})
