// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

/** Records the order of the money/AI/persist steps across mocks. */
const order: string[] = []

const auth = vi.fn()
const readLinkedinPdfUpload = vi.fn()
const generateLinkedinSuggestions = vi.fn()
const suggestionCount = vi.fn()
const suggestionCreate = vi.fn()
const ratingFindFirst = vi.fn()

vi.mock("@/features/auth/config", () => ({ auth: () => auth() }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    linkedinSuggestion: {
      count: (...args: unknown[]) => suggestionCount(...args),
      create: (...args: unknown[]) => suggestionCreate(...args),
    },
    profileRating: {
      findFirst: (...args: unknown[]) => ratingFindFirst(...args),
    },
  },
}))
vi.mock("@/features/linkedin/services/linkedin-assist", () => ({
  generateLinkedinSuggestions: (...args: unknown[]) =>
    generateLinkedinSuggestions(...args),
}))
vi.mock("@/features/linkedin/services/linkedin-upload", () => ({
  readLinkedinPdfUpload: (...args: unknown[]) => readLinkedinPdfUpload(...args),
}))

/** The shared AI_LINKEDIN bucket, which covers this route and /rating. */
const consumeAiRateLimit = vi.fn()
const recordAiAttempt = vi.fn()
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_LINKEDIN: "ai:linkedin" },
  consumeRateLimit: (...args: unknown[]) => consumeAiRateLimit(...args),
  recordAttempt: (...args: unknown[]) => recordAiAttempt(...args),
}))

import { POST } from "../route"

const USER_ID = "user-1"

const suggestions = {
  headline: { current: "Engineer", suggested: "Backend Engineer", rationale: "why" },
  about: { suggested: "I build things.", rationale: "why" },
  experience: [
    { position: "Engineer — Acme", suggestedBullets: ["Shipped it"], rationale: "why" },
  ],
  skillsToAdd: ["PostgreSQL"],
  quickWins: ["Set a custom URL"],
}

/** The route only forwards the Request to the (mocked) upload helper. */
const request = {} as Request

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  vi.spyOn(console, "error").mockImplementation(() => {})

  auth.mockResolvedValue({ user: { id: USER_ID } })
  readLinkedinPdfUpload.mockResolvedValue({
    ok: true,
    text: "profile text",
    fileName: "profile.pdf",
  })
  suggestionCount.mockResolvedValue(0)
  ratingFindFirst.mockResolvedValue(null)
  consumeAiRateLimit.mockResolvedValue(true)
  generateLinkedinSuggestions.mockImplementation(async () => {
    order.push("generate")
    return suggestions
  })
  suggestionCreate.mockImplementation(async () => {
    order.push("create")
    return {
      id: "sug-1",
      suggestions,
      createdAt: new Date("2026-07-30T12:00:00.000Z"),
    }
  })
})

describe("POST /api/linkedin/assist", () => {
  it("returns 401 without charging when unauthenticated", async () => {
    auth.mockResolvedValue(null)

    const res = await POST(request)

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" })
    expect(readLinkedinPdfUpload).not.toHaveBeenCalled()
  })

  it("passes an upload failure through without charging", async () => {
    readLinkedinPdfUpload.mockResolvedValue({
      ok: false,
      error: "Only PDF files are supported",
      code: "INVALID_TYPE",
      status: 400,
    })

    const res = await POST(request)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "Only PDF files are supported",
      code: "INVALID_TYPE",
    })
    expect(generateLinkedinSuggestions).not.toHaveBeenCalled()
  })

  it("passes a rate-limit failure through without charging", async () => {
    readLinkedinPdfUpload.mockResolvedValue({
      ok: false,
      error: "Too many suggestion runs. Please wait a few minutes and try again.",
      code: "RATE_LIMITED",
      status: 429,
    })

    const res = await POST(request)

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("RATE_LIMITED")
    expect(generateLinkedinSuggestions).not.toHaveBeenCalled()
  })

  it("returns 429 without charging when the shared AI bucket is full", async () => {
    consumeAiRateLimit.mockResolvedValue(false)

    const res = await POST(request)

    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({
      error: "Too many LinkedIn AI runs. Please wait a few minutes and try again.",
      code: "RATE_LIMITED",
    })
    expect(generateLinkedinSuggestions).not.toHaveBeenCalled()
    expect(recordAiAttempt).not.toHaveBeenCalled()
  })

  it("consumes one attempt in the shared AI bucket per allowed run", async () => {
    await POST(request)

    expect(consumeAiRateLimit).toHaveBeenCalledWith("ai:linkedin", USER_ID, {
      max: 10,
      windowMs: 10 * 60 * 1000,
    })
    // The consume writes its own row; the separate record call is gone.
    expect(recordAiAttempt).not.toHaveBeenCalled()
  })

  it("returns 500 when generation throws", async () => {
    generateLinkedinSuggestions.mockRejectedValue(new Error("model down"))

    const res = await POST(request)

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: "Generating suggestions failed. Please try again.",
      code: "ASSIST_FAILED",
    })
    expect(suggestionCreate).not.toHaveBeenCalled()
  })

  it("returns 500 when persisting throws", async () => {
    suggestionCreate.mockRejectedValue(new Error("db down"))

    const res = await POST(request)

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("ASSIST_FAILED")
  })

  it("generates, persists and returns 201", async () => {
    const res = await POST(request)

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      data: {
        id: "sug-1",
        suggestions,
        createdAt: "2026-07-30T12:00:00.000Z",
      },
    })

    // The model runs before the row is written.
    expect(order).toEqual(["generate", "create"])

    expect(generateLinkedinSuggestions).toHaveBeenCalledWith(
      "profile text",
      USER_ID,
      undefined,
    )
    expect(suggestionCreate).toHaveBeenCalledWith({
      data: { userId: USER_ID, suggestions },
    })
  })

  it("checks the assist rate limit for the caller through the upload helper", async () => {
    suggestionCount.mockResolvedValue(5)

    await POST(request)

    const guard = readLinkedinPdfUpload.mock.calls[0][1] as {
      isLimited: () => Promise<boolean>
      error: string
    }
    await expect(guard.isLimited()).resolves.toBe(true)
    expect(suggestionCount.mock.calls[0][0]).toMatchObject({
      where: { userId: USER_ID },
    })
    expect(guard.error).toContain("Too many suggestion runs")
  })

  it("forwards the latest LinkedIn rating as assist context", async () => {
    const scores = {
      headline: 40,
      about: 55,
      experienceImpact: 60,
      skillsKeywords: 70,
      completeness: 80,
    }
    const issues = [
      { severity: "critical", message: "Headline is a bare job title", category: "Headline" },
    ]
    ratingFindFirst.mockResolvedValue({
      id: "rating-1",
      kind: "LINKEDIN",
      sourceUrl: null,
      overallScore: 61,
      scores,
      issues,
      suggestions: { items: ["Rewrite the headline"] },
      benchmark: null,
      createdAt: new Date("2026-07-29T12:00:00.000Z"),
    })

    const res = await POST(request)

    expect(res.status).toBe(201)
    expect(ratingFindFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, kind: "LINKEDIN" },
      orderBy: { createdAt: "desc" },
    })
    expect(generateLinkedinSuggestions).toHaveBeenCalledWith("profile text", USER_ID, {
      overallScore: 61,
      scores,
      issues,
    })
  })

  it("still generates when the rating lookup fails", async () => {
    ratingFindFirst.mockRejectedValue(new Error("db down"))

    const res = await POST(request)

    expect(res.status).toBe(201)
    expect(generateLinkedinSuggestions).toHaveBeenCalledWith(
      "profile text",
      USER_ID,
      undefined,
    )
  })
})
