import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const getText = vi.fn()
const destroy = vi.fn()

vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/ai-generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-generate")>()),
  generateObjectTracked: vi.fn(),
}))
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

import { generateObjectTracked } from "@/shared/lib/ai-generate"
import { parseResumeFile } from "../parse-resume"

const mockedGenerateObject = vi.mocked(generateObjectTracked)

const PDF = "application/pdf"
const buffer = new Uint8Array([1, 2, 3])
const USER_ID = "user-1"

/** Smallest response the parser accepts — no bullets, so no second AI call. */
const minimalObject = {
  title: "Resume",
  contact: {
    fullName: null,
    jobTitle: null,
    email: null,
    phone: null,
    location: null,
    linkedin: null,
    github: null,
    website: null,
  },
  summary: { text: null },
  experience: [],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedGenerateObject.mockResolvedValue({ object: minimalObject } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("parseResumeFile parser bounds", () => {
  it("rejects when the PDF parser has not answered within 30s", async () => {
    vi.useFakeTimers()
    // Never settles: stands in for a document that pins the parser.
    getText.mockReturnValue(new Promise(() => {}))

    const promise = parseResumeFile(buffer, PDF, USER_ID)
    const assertion = expect(promise).rejects.toThrow(/timed out after 30000ms/)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion

    expect(mockedGenerateObject).not.toHaveBeenCalled()
  })

  it("does not time out a parse that finishes in time", async () => {
    vi.useFakeTimers()
    getText.mockResolvedValue({ text: "Ada Lovelace" })

    const promise = parseResumeFile(buffer, PDF, USER_ID)
    await vi.advanceTimersByTimeAsync(31_000)

    await expect(promise).resolves.toMatchObject({ title: "Resume" })
  })

  it("releases the parser after use", async () => {
    getText.mockResolvedValue({ text: "Ada Lovelace" })

    await parseResumeFile(buffer, PDF, USER_ID)

    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it("releases the parser even when extraction fails", async () => {
    getText.mockRejectedValue(new Error("broken pdf"))

    await expect(parseResumeFile(buffer, PDF, USER_ID)).rejects.toThrow("broken pdf")
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it("caps the extracted text at 200k characters before the prompt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    getText.mockResolvedValue({ text: "a".repeat(250_000) })

    await parseResumeFile(buffer, PDF, USER_ID)

    const { prompt } = mockedGenerateObject.mock.calls[0][0] as unknown as {
      prompt: string
    }
    expect(prompt).toContain("a".repeat(200_000))
    expect(prompt).not.toContain("a".repeat(200_001))
  })
})
