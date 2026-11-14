import { describe, it, expect, vi, beforeEach } from "vitest"

const extractLinkedInPdfText = vi.fn()
vi.mock("../parse-linkedin-pdf", () => ({
  extractLinkedInPdfText: (...args: unknown[]) => extractLinkedInPdfText(...args),
}))

import { readLinkedinPdfUpload } from "../linkedin-upload"
import { LINKEDIN_PDF_MIN_TEXT_LENGTH } from "../../constants/linkedin"

/** Minimal Request stand-in — only `formData()` is used by the helper. */
function requestWith(formData: FormData | null): Request {
  return {
    formData: async () => {
      if (!formData) throw new Error("bad body")
      return formData
    },
  } as unknown as Request
}

/** Leading bytes of a real PDF — the service sniffs them before parsing. */
const PDF_BYTES = new Uint8Array([...`%PDF-1.4\n`].map((c) => c.charCodeAt(0)))
/** Leading bytes of a zip container (e.g. a DOCX renamed to .pdf). */
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])

function pdf(
  name = "profile.pdf",
  size = 1000,
  type = "application/pdf",
  bytes: Uint8Array = PDF_BYTES
) {
  const file = new File(["x"], name, { type })
  Object.defineProperty(file, "size", { value: size })
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.slice().buffer,
  })
  return file
}

function withFile(file: File | string, extra?: Record<string, string>) {
  const formData = new FormData()
  formData.append("file", file as never)
  for (const [key, value] of Object.entries(extra ?? {})) {
    formData.append(key, value)
  }
  return requestWith(formData)
}

beforeEach(() => {
  vi.clearAllMocks()
  extractLinkedInPdfText.mockResolvedValue("a".repeat(LINKEDIN_PDF_MIN_TEXT_LENGTH))
})

describe("readLinkedinPdfUpload", () => {
  it("rejects an unreadable body", async () => {
    const result = await readLinkedinPdfUpload(requestWith(null))
    expect(result).toMatchObject({ ok: false, code: "INVALID_BODY", status: 400 })
  })

  it("rejects a missing file", async () => {
    const result = await readLinkedinPdfUpload(requestWith(new FormData()))
    expect(result).toMatchObject({ ok: false, code: "NO_FILE", status: 400 })
    expect(extractLinkedInPdfText).not.toHaveBeenCalled()
  })

  it("rejects a non-File field", async () => {
    const result = await readLinkedinPdfUpload(withFile("not-a-file"))
    expect(result).toMatchObject({ ok: false, code: "NO_FILE", status: 400 })
  })

  it("rejects a non-PDF type", async () => {
    const result = await readLinkedinPdfUpload(
      withFile(pdf("shot.png", 1000, "image/png"))
    )
    expect(result).toMatchObject({ ok: false, code: "INVALID_TYPE", status: 400 })
    expect(extractLinkedInPdfText).not.toHaveBeenCalled()
  })

  it("rejects a PDF-typed file whose name is not .pdf", async () => {
    const result = await readLinkedinPdfUpload(withFile(pdf("profile.png")))
    expect(result).toMatchObject({ ok: false, code: "INVALID_TYPE", status: 400 })
    expect(extractLinkedInPdfText).not.toHaveBeenCalled()
  })

  it("rejects a file that claims PDF but carries zip bytes", async () => {
    const result = await readLinkedinPdfUpload(
      withFile(pdf("profile.pdf", 1000, "application/pdf", ZIP_BYTES))
    )
    expect(result).toMatchObject({ ok: false, code: "INVALID_TYPE", status: 400 })
    expect(extractLinkedInPdfText).not.toHaveBeenCalled()
  })

  it("rejects a file over 5 MB", async () => {
    const result = await readLinkedinPdfUpload(
      withFile(pdf("big.pdf", 6 * 1024 * 1024))
    )
    expect(result).toMatchObject({ ok: false, code: "TOO_LARGE", status: 400 })
    expect(extractLinkedInPdfText).not.toHaveBeenCalled()
  })

  it("rejects a PDF with too little text", async () => {
    extractLinkedInPdfText.mockResolvedValue("short")
    const result = await readLinkedinPdfUpload(withFile(pdf()))
    expect(result).toMatchObject({ ok: false, code: "EMPTY_PDF", status: 400 })
  })

  it("reports a parse failure", async () => {
    extractLinkedInPdfText.mockRejectedValue(new Error("boom"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await readLinkedinPdfUpload(withFile(pdf()))
    expect(result).toMatchObject({ ok: false, code: "PARSE_FAILED", status: 400 })
  })

  it("returns the extracted text and file name on success", async () => {
    const result = await readLinkedinPdfUpload(withFile(pdf()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fileName).toBe("profile.pdf")
      expect(result.text.length).toBe(LINKEDIN_PDF_MIN_TEXT_LENGTH)
    }
  })

  it("returns the optional context field from the same parse", async () => {
    const result = await readLinkedinPdfUpload(
      withFile(pdf(), { resumeId: " resume-1 " })
    )
    expect(result.ok).toBe(true)
    // Trimmed but otherwise untouched.
    if (result.ok) expect(result.resumeId).toBe("resume-1")
  })

  it("treats absent and blank context fields as undefined", async () => {
    const missing = await readLinkedinPdfUpload(withFile(pdf()))
    expect(missing.ok).toBe(true)
    if (missing.ok) expect(missing.resumeId).toBeUndefined()

    const blank = await readLinkedinPdfUpload(withFile(pdf(), { resumeId: "   " }))
    expect(blank.ok).toBe(true)
    if (blank.ok) expect(blank.resumeId).toBeUndefined()
  })

  it("ignores a non-string context field", async () => {
    const formData = new FormData()
    formData.append("file", pdf())
    formData.append("resumeId", new File(["x"], "nope.txt", { type: "text/plain" }))
    const result = await readLinkedinPdfUpload(requestWith(formData))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.resumeId).toBeUndefined()
  })

  it("short-circuits with RATE_LIMITED before parsing", async () => {
    const result = await readLinkedinPdfUpload(withFile(pdf()), {
      isLimited: async () => true,
      error: "Slow down",
    })
    expect(result).toMatchObject({
      ok: false,
      code: "RATE_LIMITED",
      status: 429,
      error: "Slow down",
    })
    expect(extractLinkedInPdfText).not.toHaveBeenCalled()
  })

  it("checks the rate limit only after file validation", async () => {
    const isLimited = vi.fn(async () => true)
    const result = await readLinkedinPdfUpload(
      withFile(pdf("shot.png", 1000, "image/png")),
      { isLimited, error: "Slow down" }
    )
    expect(result).toMatchObject({ code: "INVALID_TYPE" })
    expect(isLimited).not.toHaveBeenCalled()
  })

  it("proceeds when the rate limit guard allows it", async () => {
    const result = await readLinkedinPdfUpload(withFile(pdf()), {
      isLimited: async () => false,
      error: "Slow down",
    })
    expect(result.ok).toBe(true)
  })
})
