// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const auth = vi.fn()
const consumeRateLimit = vi.fn()
const recordAttempt = vi.fn()
const parseResumeFile = vi.fn()
const analyzeResumeATS = vi.fn()

const resumeCreate = vi.fn()
const resumeFindUnique = vi.fn()
const atsAnalysisCount = vi.fn()
const atsAnalysisCreate = vi.fn()

vi.mock("@/features/auth/config", () => ({ auth: () => auth() }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    $transaction: async (arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (tx: unknown) => unknown)({
            resume: { create: (...args: unknown[]) => resumeCreate(...args) },
            resumeSection: { create: async () => ({ id: "section-1" }) },
            resumeSectionItem: { createMany: async () => ({ count: 0 }) },
          }),
    resume: {
      findUnique: (...args: unknown[]) => resumeFindUnique(...args),
      update: async () => ({}),
    },
    aTSAnalysis: {
      count: (...args: unknown[]) => atsAnalysisCount(...args),
      create: (...args: unknown[]) => atsAnalysisCreate(...args),
    },
  },
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { RESUME_PARSE: "resume:parse" },
  consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args),
  recordAttempt: (...args: unknown[]) => recordAttempt(...args),
}))
vi.mock("@/features/resume/services/parse-resume", () => ({
  parseResumeFile: (...args: unknown[]) => parseResumeFile(...args),
}))
vi.mock("@/features/resume/services/ats-analyze", () => ({
  analyzeResumeATS: (...args: unknown[]) => analyzeResumeATS(...args),
}))

import { POST } from "../route"

const USER_ID = "user-1"

/** The route only reaches `req.formData()` once the limit check has passed. */
const formData = vi.fn()

function requestWith(headers: Record<string, string> = {}): Request {
  return {
    formData: (...args: unknown[]) => formData(...args),
    headers: new Headers(headers),
  } as unknown as Request
}

const request = requestWith()

const PDF_TYPE = "application/pdf"
const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

const PDF_BYTES = new Uint8Array([...`%PDF-1.4\n`].map((c) => c.charCodeAt(0)))
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])

function uint16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff]
}

function uint32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

/**
 * A one-entry zip whose central directory declares a 4 GB uncompressed file —
 * the shape `checkZipSanity` is there to refuse.
 */
function zipBombBytes(): Uint8Array {
  const central = [
    ...uint32(0x02014b50),
    ...uint16(20),
    ...uint16(20),
    ...uint16(0),
    ...uint16(0),
    ...uint16(0),
    ...uint16(0),
    ...uint32(0),
    ...uint32(0),
    ...uint32(4_000_000_000),
    ...uint16(1), // name length
    ...uint16(0),
    ...uint16(0),
    ...uint16(0),
    ...uint16(0),
    ...uint32(0),
    ...uint32(0),
    "a".charCodeAt(0),
  ]
  const prefix = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]
  const directoryOffset = prefix.length
  const eocd = [
    ...uint32(0x06054b50),
    ...uint16(0),
    ...uint16(0),
    ...uint16(1),
    ...uint16(1),
    ...uint32(central.length),
    ...uint32(directoryOffset),
    ...uint16(0),
  ]
  return new Uint8Array([...prefix, ...central, ...eocd])
}

/** A File whose declared type/name and actual bytes can be set independently. */
function upload(
  name: string,
  type: string,
  bytes: Uint8Array = PDF_BYTES,
  size = 1000
): File {
  const file = new File(["x"], name, { type })
  Object.defineProperty(file, "size", { value: size })
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.slice().buffer,
  })
  return file
}

function bodyWith(file: File): FormData {
  const body = new FormData()
  body.append("file", file)
  return body
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: USER_ID } })
  consumeRateLimit.mockResolvedValue(true)
  formData.mockRejectedValue(new Error("body not read in these tests"))
  resumeCreate.mockResolvedValue({ id: "resume-1" })
  resumeFindUnique.mockResolvedValue({ id: "resume-1", sections: [] })
  atsAnalysisCount.mockResolvedValue(0)
  atsAnalysisCreate.mockResolvedValue({})
})

describe("POST /api/resume/parse rate limit", () => {
  it("returns 429 without touching the body when limited", async () => {
    consumeRateLimit.mockResolvedValue(false)

    const res = await POST(request)

    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({
      error: "Too many resume uploads. Please wait a few minutes and try again.",
      code: "RATE_LIMITED",
    })
    expect(parseResumeFile).not.toHaveBeenCalled()
    expect(analyzeResumeATS).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(formData).not.toHaveBeenCalled()
  })

  it("checks the resume:parse bucket for the caller with a 10 per 10 min window", async () => {
    consumeRateLimit.mockResolvedValue(false)

    await POST(request)

    expect(consumeRateLimit).toHaveBeenCalledWith("resume:parse", USER_ID, {
      max: 10,
      windowMs: 10 * 60 * 1000,
    })
  })

  it("does not check the limit when unauthenticated", async () => {
    auth.mockResolvedValue(null)

    const res = await POST(request)

    expect(res.status).toBe(401)
    expect(consumeRateLimit).not.toHaveBeenCalled()
    expect(parseResumeFile).not.toHaveBeenCalled()
  })

  it("consumes the attempt before parsing an accepted request", async () => {
    const order: string[] = []
    consumeRateLimit.mockImplementation(async () => {
      order.push("record")
      return true
    })
    parseResumeFile.mockImplementation(async () => {
      order.push("parse")
      throw new Error("model down")
    })
    vi.spyOn(console, "error").mockImplementation(() => {})

    formData.mockResolvedValue(bodyWith(upload("resume.pdf", PDF_TYPE)))

    const res = await POST(request)

    // Stops at the parse failure — enough to prove the attempt is recorded first.
    expect(res.status).toBe(500)
    expect(order).toEqual(["record", "parse"])
    // The consume writes its own row; the separate record call is gone.
    expect(recordAttempt).not.toHaveBeenCalled()
  })
})

describe("POST /api/resume/parse upload validation", () => {
  it("rejects a legacy .doc upload — the parser cannot read it", async () => {
    formData.mockResolvedValue(
      bodyWith(upload("resume.doc", "application/msword"))
    )

    const res = await POST(request)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "Only PDF and DOCX files are supported",
    })
    expect(parseResumeFile).not.toHaveBeenCalled()
  })

  it("rejects an allowed MIME type carried by a disallowed extension", async () => {
    formData.mockResolvedValue(bodyWith(upload("resume.exe", PDF_TYPE)))

    const res = await POST(request)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "Only PDF and DOCX files are supported",
    })
    expect(parseResumeFile).not.toHaveBeenCalled()
  })

  it("rejects a file whose bytes do not match its declared type", async () => {
    formData.mockResolvedValue(
      bodyWith(upload("resume.pdf", PDF_TYPE, ZIP_BYTES))
    )

    const res = await POST(request)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "File content does not match its type",
    })
    expect(parseResumeFile).not.toHaveBeenCalled()
  })

  it("rejects a DOCX-typed file with no zip header", async () => {
    formData.mockResolvedValue(
      bodyWith(upload("resume.docx", DOCX_TYPE, PDF_BYTES))
    )

    const res = await POST(request)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "File content does not match its type",
    })
  })

  it("rejects a DOCX declaring an implausible uncompressed size", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    formData.mockResolvedValue(
      bodyWith(upload("resume.docx", DOCX_TYPE, zipBombBytes()))
    )

    const res = await POST(request)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Invalid DOCX file" })
    expect(parseResumeFile).not.toHaveBeenCalled()
  })

  it("refuses an oversized body from the Content-Length header alone", async () => {
    const res = await POST(
      requestWith({ "content-length": String(20 * 1024 * 1024) })
    )

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "File size must be 5 MB or less" })
    expect(formData).not.toHaveBeenCalled()
  })

  it("reads the body when Content-Length is within the cap", async () => {
    formData.mockResolvedValue(bodyWith(upload("resume.pdf", PDF_TYPE)))
    parseResumeFile.mockRejectedValue(new Error("model down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(requestWith({ "content-length": "2048" }))

    expect(res.status).toBe(500)
    expect(formData).toHaveBeenCalled()
  })

  it("sanitizes the file name used as the resume title fallback", async () => {
    const messyName = `a\u0000very${" ".repeat(4)}long${"x".repeat(200)}.pdf`
    formData.mockResolvedValue(bodyWith(upload(messyName, PDF_TYPE)))
    // No title from the model, so the file name is the fallback.
    parseResumeFile.mockResolvedValue({ title: null, contact: {} })

    const res = await POST(request)

    expect(res.status).toBe(201)
    const title = resumeCreate.mock.calls[0][0].data.title as string
    expect(title).toHaveLength(120)
    expect(title.startsWith("a very long")).toBe(true)
    expect(/[\u0000-\u001f\u007f]/.test(title)).toBe(false)
  })
})

describe("POST /api/resume/parse automatic ATS analysis", () => {
  function bodyWithJobDescription(): FormData {
    const body = bodyWith(upload("resume.pdf", PDF_TYPE))
    body.append("jobDescription", "Senior engineer, TypeScript, Postgres")
    return body
  }

  beforeEach(() => {
    parseResumeFile.mockResolvedValue({ title: "Resume", contact: {} })
    analyzeResumeATS.mockResolvedValue({
      overallScore: 70,
      scores: {},
      issues: [],
      suggestions: [],
      missingKeywords: [],
    })
  })

  it("consults the 5-per-10-minutes ATS scan window for the caller", async () => {
    formData.mockResolvedValue(bodyWithJobDescription())
    const before = Date.now()

    const res = await POST(request)
    const after = Date.now()

    expect(res.status).toBe(201)
    expect(atsAnalysisCount).toHaveBeenCalledTimes(1)
    const where = atsAnalysisCount.mock.calls[0][0].where
    expect(where.userId).toBe(USER_ID)
    const since = (where.createdAt.gte as Date).getTime()
    // The window start is taken during the request, between before and after.
    expect(since).toBeGreaterThanOrEqual(before - 10 * 60 * 1000)
    expect(since).toBeLessThanOrEqual(after - 10 * 60 * 1000)
    expect(analyzeResumeATS).toHaveBeenCalledTimes(1)
    expect(await res.json()).toEqual({ resumeId: "resume-1" })
  })

  it("skips the analysis but still creates the resume when the window is full", async () => {
    atsAnalysisCount.mockResolvedValue(5)
    formData.mockResolvedValue(bodyWithJobDescription())

    const res = await POST(request)

    expect(res.status).toBe(201)
    expect(analyzeResumeATS).not.toHaveBeenCalled()
    expect(atsAnalysisCreate).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.resumeId).toBe("resume-1")
    expect(body.ats).toEqual({
      error: "Too many ATS scans. Please wait a few minutes and try again.",
      code: "RATE_LIMITED",
    })
  })

  it("does not consult the ATS window when no job description was supplied", async () => {
    formData.mockResolvedValue(bodyWith(upload("resume.pdf", PDF_TYPE)))

    const res = await POST(request)

    expect(res.status).toBe(201)
    expect(atsAnalysisCount).not.toHaveBeenCalled()
    expect(analyzeResumeATS).not.toHaveBeenCalled()
  })
})
