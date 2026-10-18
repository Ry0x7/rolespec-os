// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  loadResumeTextForUser: vi.fn(),
  generateReplyEmailAI: vi.fn(),
}))

vi.mock("@/features/settings/services/api-token", () => ({
  verifyApiToken: mocks.verifyApiToken,
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { EXTENSION_EMAIL_REPLY: "extension:email-reply" },
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
  consumeRateLimit: mocks.consumeRateLimit,
  recordAttempt: mocks.recordAttempt,
}))
vi.mock("@/features/jobs/services/resume-text.service", () => ({
  loadResumeTextForUser: mocks.loadResumeTextForUser,
}))
vi.mock("@/features/jobs/services/reply-email.service", () => ({
  generateReplyEmailAI: mocks.generateReplyEmailAI,
}))

import { OPTIONS, POST } from "../route"

const VALID_BODY = { receivedEmail: "Thanks for applying — are you free this week?" }

function post(
  body: unknown,
  { token = "rspec_valid", origin }: { token?: string | null; origin?: string } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token !== null) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin

  return POST(
    new Request("http://localhost/api/extension/email-reply", {
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
  mocks.generateReplyEmailAI.mockResolvedValue({
    subject: "Re: Your application",
    body: "Hi Dana, thank you...",
  })
})

describe("authentication", () => {
  it("401s with no Authorization header, without charging or generating", async () => {
    const res = await post(VALID_BODY, { token: null })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: "Invalid or missing API token",
      code: "UNAUTHORIZED",
    })
    expect(mocks.verifyApiToken).not.toHaveBeenCalled()
    expect(mocks.generateReplyEmailAI).not.toHaveBeenCalled()
  })

  it("401s when the token does not resolve to a user", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)

    const res = await post(VALID_BODY, { token: "rspec_revoked" })

    expect(res.status).toBe(401)
    expect(mocks.generateReplyEmailAI).not.toHaveBeenCalled()
  })
})

describe("rate limiting", () => {
  it("429s on the token owner's id, on its own bucket", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await post(VALID_BODY)

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("RATE_LIMITED")
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:email-reply",
      "user_1",
      expect.objectContaining({ max: 10 })
    )
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
    expect(mocks.generateReplyEmailAI).not.toHaveBeenCalled()
  })

  it("consumes one attempt when it lets the request through", async () => {
    await post(VALID_BODY)

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:email-reply",
      "user_1",
      expect.objectContaining({ max: 10 })
    )
    // The consume writes its own row; the separate record call is gone.
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
  })
})

describe("validation", () => {
  it.each([
    ["missing receivedEmail", {}],
    ["empty receivedEmail", { receivedEmail: "" }],
    ["oversized receivedEmail", { receivedEmail: "x".repeat(8001) }],
    ["oversized instructions", { ...VALID_BODY, instructions: "x".repeat(1001) }],
    ["oversized companyName", { ...VALID_BODY, job: { companyName: "x".repeat(201) } }],
    ["oversized jobTitle", { ...VALID_BODY, job: { jobTitle: "x".repeat(201) } }],
    ["oversized jobDescription", { ...VALID_BODY, job: { jobDescription: "x".repeat(5001) } }],
    ["oversized priorThread", { ...VALID_BODY, priorThread: "x".repeat(6001) }],
    ["oversized previousDraft", { ...VALID_BODY, previousDraft: "x".repeat(4001) }],
    ["an unknown tone", { ...VALID_BODY, tone: "sarcastic" }],
    ["an unknown length", { ...VALID_BODY, length: "epic" }],
  ])("400s on %s", async (_label, body) => {
    const res = await post(body)

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("VALIDATION")
    expect(mocks.generateReplyEmailAI).not.toHaveBeenCalled()
  })

  it("400s on a body that is not JSON", async () => {
    const res = await post("{not json")

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("VALIDATION")
  })

  it("returns the offending field in the message", async () => {
    const res = await post({ receivedEmail: "x".repeat(8001) })

    expect((await res.json()).error).toContain("receivedEmail")
  })

  it("accepts a body with no job context at all", async () => {
    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(mocks.generateReplyEmailAI).toHaveBeenCalledWith(
      expect.objectContaining({ job: undefined })
    )
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
    expect(mocks.generateReplyEmailAI).not.toHaveBeenCalled()
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
    expect(mocks.generateReplyEmailAI).not.toHaveBeenCalled()
  })
})

describe("generation", () => {
  it("500s when generation throws", async () => {
    mocks.generateReplyEmailAI.mockRejectedValue(new Error("model unavailable"))

    const res = await post(VALID_BODY)

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("SERVER_ERROR")
  })

  it("200s with the subject and body", async () => {
    const res = await post({
      receivedEmail: "Thanks for applying — are you free this week?",
      job: {
        companyName: "Acme",
        jobTitle: "Platform Engineer",
        jobDescription: "Own the deploy pipeline",
      },
      instructions: "keep it short",
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      subject: "Re: Your application",
      body: "Hi Dana, thank you...",
    })
    expect(mocks.generateReplyEmailAI).toHaveBeenCalledWith({
      userId: "user_1",
      surface: "extension",
      resumeText: "## Summary\nresume",
      receivedEmail: "Thanks for applying — are you free this week?",
      job: {
        companyName: "Acme",
        jobTitle: "Platform Engineer",
        jobDescription: "Own the deploy pipeline",
      },
      instructions: "keep it short",
    })
  })

  it("forwards tone, length, priorThread and previousDraft", async () => {
    const res = await post({
      ...VALID_BODY,
      tone: "direct",
      length: "brief",
      priorThread: "Earlier: we received your application.",
      previousDraft: "Hi Dana, thanks so much...",
    })

    expect(res.status).toBe(200)
    expect(mocks.generateReplyEmailAI).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "direct",
        length: "brief",
        priorThread: "Earlier: we received your application.",
        previousDraft: "Hi Dana, thanks so much...",
      })
    )
  })

  it("still 200s for an older extension build that sends none of the new fields", async () => {
    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(mocks.generateReplyEmailAI).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: undefined,
        length: undefined,
        priorThread: undefined,
        previousDraft: undefined,
      })
    )
  })

  it("falls back to the newest resume when no resumeId is given", async () => {
    await post(VALID_BODY)

    expect(mocks.loadResumeTextForUser).toHaveBeenCalledWith("user_1", undefined)
  })
})

describe("CORS", () => {
  it("204s the preflight with the method and header allowances", async () => {
    const res = await OPTIONS(
      new Request("http://localhost/api/extension/email-reply", {
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

/** Same envelope rule as the cold-email route — see that test for the reasoning. */
describe("the signature check in the response envelope", () => {
  const UNEXPECTED_NAME = {
    issue: "unexpected_name" as const,
    expectedName: null,
    signature: ["Best,", "Alex"],
    offending: ["Alex"],
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
    mocks.generateReplyEmailAI.mockResolvedValue({
      subject: "Re: Your application",
      body: "Hi Dana, thank you...",
      signature: MISSING_NAME,
    })

    const json = (await (await post(VALID_BODY)).json()) as Record<string, unknown>

    expect("signature" in json).toBe(false)
  })

  it("includes it for an unexpected_name finding", async () => {
    mocks.generateReplyEmailAI.mockResolvedValue({
      subject: "Re: Your application",
      body: "Hi Dana, thank you...",
      signature: UNEXPECTED_NAME,
    })

    const json = (await (await post(VALID_BODY)).json()) as Record<string, unknown>

    expect(json.signature).toEqual(UNEXPECTED_NAME)
  })
})
