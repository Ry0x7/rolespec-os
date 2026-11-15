import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/ai-generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-generate")>()),
  generateObjectTracked: vi.fn(),
}))

import { generateObjectTracked } from "@/shared/lib/ai-generate"
import { analyzeJobMatchAI } from "../job-match.service"

const mockedGenerateObject = vi.mocked(generateObjectTracked)

const USER_ID = "user-1"

/**
 * Truncation is measured as the longest RUN of the filler character, not as its
 * total count: the prompt legitimately contains prose too, so counting every
 * occurrence broke the assertion whenever an unrelated prompt line gained one.
 */
function longestRunOf(text: string, char: string): number {
  const runs = text.match(new RegExp(`${char}+`, "g")) ?? []
  return runs.reduce((longest, run) => Math.max(longest, run.length), 0)
}

const job = {
  companyName: "Acme Corp",
  jobTitle: "Frontend Engineer",
  jobDescription: "We need strong React and TypeScript skills.",
  notes: "Referred by a friend",
}

const emptyResult = {
  matchScore: 0,
  summary: "",
  matchedKeywords: [],
  missingKeywords: [],
  suggestions: [],
}

describe("analyzeJobMatchAI", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the parsed match object", async () => {
    const mockResult = {
      matchScore: 72,
      summary: "Strong React overlap, missing backend depth.",
      matchedKeywords: ["react", "typescript"],
      missingKeywords: ["graphql"],
      suggestions: ["Add a GraphQL bullet to your most recent role."],
    }
    mockedGenerateObject.mockResolvedValue({ object: mockResult } as never)

    const result = await analyzeJobMatchAI({
      userId: USER_ID,
      resumeText: "resume text",
      job,
    })

    expect(result).toEqual(mockResult)
  })

  it("includes company, role, job description and notes in the prompt", async () => {
    mockedGenerateObject.mockResolvedValue({ object: emptyResult } as never)

    await analyzeJobMatchAI({
      userId: USER_ID,
      resumeText: "resume text",
      job,
    })

    const callArgs = mockedGenerateObject.mock.calls[0][0] as { prompt: string }
    expect(callArgs.prompt).toContain("Acme Corp")
    expect(callArgs.prompt).toContain("Frontend Engineer")
    expect(callArgs.prompt).toContain("We need strong React and TypeScript skills.")
    expect(callArgs.prompt).toContain("Referred by a friend")
  })

  it("omits the job description line when none is provided", async () => {
    mockedGenerateObject.mockResolvedValue({ object: emptyResult } as never)

    await analyzeJobMatchAI({
      userId: USER_ID,
      resumeText: "resume text",
      job: { ...job, jobDescription: null },
    })

    const callArgs = mockedGenerateObject.mock.calls[0][0] as { prompt: string }
    expect(callArgs.prompt).not.toContain("Job description:")
    expect(callArgs.prompt).toContain("Referred by a friend")
  })

  it("truncates resumeText and jobDescription to 4000 chars each", async () => {
    mockedGenerateObject.mockResolvedValue({ object: emptyResult } as never)

    await analyzeJobMatchAI({
      userId: USER_ID,
      resumeText: "x".repeat(5000),
      job: { ...job, jobDescription: "z".repeat(6000), notes: null },
    })

    const callArgs = mockedGenerateObject.mock.calls[0][0] as { prompt: string }
    expect(longestRunOf(callArgs.prompt, "x")).toBe(4000)
    expect(callArgs.prompt).toContain("z".repeat(4000))
    expect(callArgs.prompt).not.toContain("z".repeat(4001))
  })
})
