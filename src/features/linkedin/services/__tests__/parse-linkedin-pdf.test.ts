import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const getText = vi.fn()
const destroy = vi.fn()

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText() {
      return getText()
    }
    destroy() {
      destroy()
      return Promise.resolve()
    }
  },
}))

import { extractLinkedInPdfText } from "../parse-linkedin-pdf"

const buffer = new Uint8Array([1, 2, 3])

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("extractLinkedInPdfText", () => {
  it("normalises line endings and trims", async () => {
    getText.mockResolvedValue({ text: "  Ada\r\nLovelace  " })

    await expect(extractLinkedInPdfText(buffer)).resolves.toBe("Ada\nLovelace")
  })

  it("rejects when the parser has not answered within 30s", async () => {
    vi.useFakeTimers()
    getText.mockReturnValue(new Promise(() => {}))

    const promise = extractLinkedInPdfText(buffer)
    const assertion = expect(promise).rejects.toThrow(/timed out after 30000ms/)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it("caps the extracted text at 200k characters", async () => {
    getText.mockResolvedValue({ text: "a".repeat(250_000) })

    const text = await extractLinkedInPdfText(buffer)

    expect(text).toHaveLength(200_000)
  })

  it("releases the parser on success and on failure", async () => {
    getText.mockResolvedValue({ text: "Ada" })
    await extractLinkedInPdfText(buffer)
    expect(destroy).toHaveBeenCalledTimes(1)

    getText.mockRejectedValue(new Error("broken pdf"))
    await expect(extractLinkedInPdfText(buffer)).rejects.toThrow("broken pdf")
    expect(destroy).toHaveBeenCalledTimes(2)
  })
})
