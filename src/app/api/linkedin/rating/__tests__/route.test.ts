// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const auth = vi.fn()
const readLinkedinPdfUpload = vi.fn()
const analyzeLinkedIn = vi.fn()
const isProfileRatingRateLimited = vi.fn()
const persistProfileRating = vi.fn()
const resumeFindFirst = vi.fn()
const consumeAiRateLimit = vi.fn()

vi.mock("@/features/auth/config", () => ({ auth: () => auth() }))
vi.mock("@/features/linkedin/services/rate-linkedin", () => ({
  analyzeLinkedIn: (...args: unknown[]) => analyzeLinkedIn(...args),
}))
vi.mock("@/features/linkedin/services/linkedin-upload", () => ({
  readLinkedinPdfUpload: (...args: unknown[]) => readLinkedinPdfUpload(...args),
}))
vi.mock("@/features/resume/lib/serialize-sections", () => ({
  serializeSections: () => "resume text",
}))
vi.mock("@/shared/lib/rating/rating.service", () => ({
  isProfileRatingRateLimited: (...args: unknown[]) =>
    isProfileRatingRateLimited(...args),
  persistProfileRating: (...args: unknown[]) => persistProfileRating(...args),
}))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    resume: { findFirst: (...args: unknown[]) => resumeFindFirst(...args) },
  },
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_LINKEDIN: "ai:linkedin" },
  consumeRateLimit: (...args: unknown[]) => consumeAiRateLimit(...args),
}))

import { POST } from "../route"

const USER_ID = "user-1"

const rating = {
  overallScore: 72,
  scores: {
    headline: 60,
    about: 70,
    experienceImpact: 75,
    skillsKeywords: 80,
    completeness: 82,
  },
  issues: [],
  suggestions: { items: ["Add a metric to the latest role"] },
  benchmark: {
    role: "Senior Engineer",
    percentile: 55,
    summary: "Solid profile.",
    benchmarkScores: {
      headline: 80,
      about: 80,
      experienceImpact: 80,
      skillsKeywords: 80,
      completeness: 80,
    },
    advantages: [],
    gaps: [],
  },
}

const request = new Request("http://localhost/api/linkedin/rating", {
  method: "POST",
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  auth.mockResolvedValue({ user: { id: USER_ID } })
  readLinkedinPdfUpload.mockResolvedValue({
    ok: true,
    text: "profile text",
    fileName: "profile.pdf",
  })
  analyzeLinkedIn.mockResolvedValue(rating)
  isProfileRatingRateLimited.mockResolvedValue(false)
  resumeFindFirst.mockResolvedValue(null)
  consumeAiRateLimit.mockResolvedValue(true)
  persistProfileRating.mockResolvedValue({
    id: "rating-1",
    kind: "LINKEDIN",
    sourceUrl: null,
    ...rating,
    createdAt: "2026-07-30T12:00:00.000Z",
  })
})

describe("POST /api/linkedin/rating", () => {
  it("returns 401 before reading an upload when unauthenticated", async () => {
    auth.mockResolvedValue(null)

    const res = await POST(request)

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    })
    expect(readLinkedinPdfUpload).not.toHaveBeenCalled()
  })

  it("refuses a cross-origin request before reading an upload", async () => {
    const res = await POST(
      new Request("http://localhost/api/linkedin/rating", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      })
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "Forbidden", code: "FORBIDDEN" })
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
    expect((await res.json()).code).toBe("INVALID_TYPE")
    expect(analyzeLinkedIn).not.toHaveBeenCalled()
  })

  it("uses the per-kind rating window as the upload guard", async () => {
    await POST(request)

    const guard = readLinkedinPdfUpload.mock.calls[0][1] as {
      isLimited: () => Promise<boolean>
      error: string
    }
    await expect(guard.isLimited()).resolves.toBe(false)
    expect(isProfileRatingRateLimited).toHaveBeenCalledWith(USER_ID, "LINKEDIN")
    expect(guard.error).toContain("Too many LinkedIn ratings")
  })

  it("returns 429 without charging when the shared AI bucket is full", async () => {
    consumeAiRateLimit.mockResolvedValue(false)

    const res = await POST(request)

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("RATE_LIMITED")
    expect(analyzeLinkedIn).not.toHaveBeenCalled()
  })

  it("rejects a resume the caller does not own", async () => {
    readLinkedinPdfUpload.mockResolvedValue({
      ok: true,
      text: "profile text",
      fileName: "profile.pdf",
      resumeId: "resume-1",
    })

    const res = await POST(request)

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("INVALID_RESUME")
    expect(analyzeLinkedIn).not.toHaveBeenCalled()
  })

  it("forwards the selected owned resume as rating context", async () => {
    readLinkedinPdfUpload.mockResolvedValue({
      ok: true,
      text: "profile text",
      fileName: "profile.pdf",
      resumeId: "resume-1",
    })
    resumeFindFirst.mockResolvedValue({
      id: "resume-1",
      sections: [],
    })

    const res = await POST(request)

    expect(res.status).toBe(201)
    expect(resumeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "resume-1",
          userId: USER_ID,
          status: { not: "ARCHIVED" },
        },
      })
    )
    expect(analyzeLinkedIn).toHaveBeenCalledWith("profile text", USER_ID, {
      resumeText: "resume text",
    })
    expect((await res.json()).contextUsed).toEqual({ resume: true })
  })

  it("omits resume context when no resume was selected", async () => {
    await POST(request)

    expect(analyzeLinkedIn).toHaveBeenCalledWith(
      "profile text",
      USER_ID,
      undefined
    )
    expect(persistProfileRating).toHaveBeenCalledWith({
      userId: USER_ID,
      kind: "LINKEDIN",
      result: rating,
    })
  })

  it("returns 500 when the rating throws", async () => {
    analyzeLinkedIn.mockRejectedValue(new Error("model down"))

    const res = await POST(request)

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: "The rating failed. Please try again.",
      code: "RATING_FAILED",
    })
    expect(persistProfileRating).not.toHaveBeenCalled()
  })

  it("returns 500 when persisting the rating throws", async () => {
    persistProfileRating.mockRejectedValue(new Error("db down"))

    const res = await POST(request)

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("RATING_FAILED")
  })

  it("returns the persisted rating with 201", async () => {
    const res = await POST(request)

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      data: expect.objectContaining({ id: "rating-1", overallScore: 72 }),
      contextUsed: { resume: false },
    })
  })
})
