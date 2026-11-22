import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/ai-generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-generate")>()),
  generateObjectTracked: vi.fn(),
}))

import { generateObjectTracked } from "@/shared/lib/ai-generate"
import { assessJobRiskAI } from "../job-risk-ai.service"

const mockedGenerateObject = vi.mocked(generateObjectTracked)

const USER_ID = "user-1"

const job = {
  companyName: "Acme Corp",
  jobTitle: "Frontend Engineer",
  jobDescription: "Build things with TypeScript.",
  // The posting's own pay line: a model judging "is this realistic?" needs the
  // currency and the period, which a bare number cannot carry.
  salaryText: "USD 120,000 per year",
  jobLink: "https://acme.example/jobs/1",
  contact: "talent@acme.example",
  location: "Remote",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("assessJobRiskAI", () => {
  it("returns the model's level and reasons", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { level: "MEDIUM", reasons: ["Pay is vague", "  No named team  "] },
    } as never)

    const result = await assessJobRiskAI({ userId: USER_ID, job })

    expect(result).toEqual({ level: "MEDIUM", reasons: ["Pay is vague", "No named team"] })
  })

  it("drops reasons on a NONE verdict", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { level: "NONE", reasons: ["stray"] },
    } as never)

    const result = await assessJobRiskAI({ userId: USER_ID, job })

    expect(result).toEqual({ level: "NONE", reasons: [] })
  })

  it("puts the posting's signals in the prompt and tracks the call as jobs.risk", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { level: "NONE", reasons: [] },
    } as never)

    await assessJobRiskAI({ userId: USER_ID, job })

    const call = mockedGenerateObject.mock.calls[0][0]
    expect(call.prompt).toContain("Acme Corp")
    expect(call.prompt).toContain("Frontend Engineer")
    expect(call.prompt).toContain("talent@acme.example")
    expect(call.prompt).toContain("https://acme.example/jobs/1")
    expect(call.prompt).toContain("USD 120,000 per year")
    expect(call.tracking).toEqual({
      feature: "jobs.risk",
      surface: "app",
      userId: USER_ID,
    })
    // Classification runs on the cheap model.
    expect(call.tier).toBe("light")
  })

  it("truncates a very long description", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { level: "NONE", reasons: [] },
    } as never)

    await assessJobRiskAI({
      userId: USER_ID,
      job: { ...job, jobDescription: "z".repeat(9000) },
    })

    const { prompt } = mockedGenerateObject.mock.calls[0][0]
    expect((prompt as string).match(/z+/)?.[0]).toHaveLength(6000)
  })

  it("omits optional fields that are absent", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { level: "NONE", reasons: [] },
    } as never)

    await assessJobRiskAI({
      userId: USER_ID,
      job: {
        companyName: "Acme Corp",
        jobTitle: "Frontend Engineer",
        jobDescription: "Build things.",
      },
    })

    const { prompt } = mockedGenerateObject.mock.calls[0][0]
    expect(prompt).not.toContain("Recruiter contact")
    expect(prompt).not.toContain("Advertised pay")
  })
})
