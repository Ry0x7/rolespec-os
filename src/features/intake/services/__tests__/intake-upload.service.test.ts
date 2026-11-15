// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  extractResumeText: vi.fn(),
}))

vi.mock("@/features/resume/services/parse-resume", () => ({
  extractResumeText: mocks.extractResumeText,
}))

import { readIntakeUpload } from "../intake-upload.service"

function requestWith(formData: FormData, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/intake/upload", {
    method: "POST",
    body: formData,
    headers,
  })
}

function file(name: string, bytes: Uint8Array, type = "application/pdf") {
  // Copy into a plain ArrayBuffer so the test compiles under TS's stricter
  // ArrayBuffer/SharedArrayBuffer split; production code passes File directly.
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return new File([copy], name, { type })
}

const PDF = new TextEncoder().encode("%PDF-1.7\nAda Lovelace\nada@example.com\n")

beforeEach(() => {
  vi.clearAllMocks()
  mocks.extractResumeText.mockResolvedValue(
    "Ada Lovelace\nada@example.com\nEXPERIENCE\nBackend Engineer at Acme"
  )
})

describe("readIntakeUpload", () => {
  it("reports a missing file without parsing anything", async () => {
    const result = await readIntakeUpload(requestWith(new FormData()), "RESUME")
    expect(result).toMatchObject({ ok: false, code: "NO_FILE", status: 400 })
    expect(mocks.extractResumeText).not.toHaveBeenCalled()
  })

  it("rejects content that is not a PDF or DOCX even if the name says .pdf", async () => {
    const formData = new FormData()
    formData.append(
      "file",
      file("resume.pdf", new TextEncoder().encode("just plain text"))
    )

    const result = await readIntakeUpload(requestWith(formData), "RESUME")
    expect(result).toMatchObject({ ok: false, code: "INVALID_TYPE" })
    expect(mocks.extractResumeText).not.toHaveBeenCalled()
  })

  it("rejects a DOCX for the LinkedIn export path", async () => {
    const formData = new FormData()
    formData.append("file", file("export.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04])))

    const result = await readIntakeUpload(requestWith(formData), "LINKEDIN")
    expect(result).toMatchObject({ ok: false, code: "INVALID_TYPE" })
  })

  it("rejects an oversized declared body before buffering it", async () => {
    const request = new Request("http://localhost/api/intake/upload", {
      method: "POST",
      headers: { "content-length": String(20 * 1024 * 1024) },
      body: "x",
    })

    const result = await readIntakeUpload(request, "RESUME")
    expect(result).toMatchObject({ ok: false, code: "TOO_LARGE", status: 413 })
    expect(mocks.extractResumeText).not.toHaveBeenCalled()
  })

  it("extracts text from a valid PDF and returns the original file name", async () => {
    const formData = new FormData()
    formData.append("file", file("ada.pdf", PDF))

    const result = await readIntakeUpload(requestWith(formData), "RESUME")
    expect(result).toEqual({
      ok: true,
      fileName: "ada.pdf",
      text: "Ada Lovelace\nada@example.com\nEXPERIENCE\nBackend Engineer at Acme",
    })
    expect(mocks.extractResumeText).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "application/pdf"
    )
  })
})
