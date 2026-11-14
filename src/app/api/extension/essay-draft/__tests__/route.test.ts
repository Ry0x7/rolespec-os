// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  extensionUserId: vi.fn(),
  consumeRateLimit: vi.fn(),
  prepareFindFirst: vi.fn(),
  applicationFindFirst: vi.fn(),
  resumeFindFirst: vi.fn(),
  loadCareerProfile: vi.fn(),
  generateEssayDraft: vi.fn(),
}))

vi.mock("@/features/ats/lib/extension-http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ats/lib/extension-http")>()),
  extensionUserId: (...args: unknown[]) => mocks.extensionUserId(...args),
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { EXTENSION_ESSAY_DRAFT: "extension:essay-draft" },
  consumeRateLimit: (...args: unknown[]) => mocks.consumeRateLimit(...args),
}))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    atsPreparation: { findFirst: (...args: unknown[]) => mocks.prepareFindFirst(...args) },
    jobApplication: {
      findFirst: (...args: unknown[]) => mocks.applicationFindFirst(...args),
    },
    resume: { findFirst: (...args: unknown[]) => mocks.resumeFindFirst(...args) },
  },
}))
vi.mock("@/features/career-profile/services/career-profile.service", () => ({
  loadCareerProfile: (...args: unknown[]) => mocks.loadCareerProfile(...args),
}))
vi.mock("@/features/jobs/services/essay-draft.service", () => ({
  generateEssayDraft: (...args: unknown[]) => mocks.generateEssayDraft(...args),
}))
vi.mock("@/features/resume/lib/serialize-sections", () => ({
  serializeSections: () => "Built React dashboards at Acme.",
}))

import { POST } from "../route"

const USER_ID = "user-1"

function request(body: unknown = { question: "Why do you want this role?" }) {
  return new Request("http://localhost/api/extension/essay-draft", {
    method: "POST",
    headers: {
      authorization: "Bearer rspec_test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

const PROFILE = {
  contactFullName: "Ada Lovelace",
  careerGoals: "Build accessible developer tools.",
  capabilities: [{ name: "TypeScript", confirmed: true }],
  evidence: [
    {
      kind: "EXPERIENCE",
      status: "CONFIRMED",
      title: "Frontend Engineer",
      organization: "Acme",
      details: "Built React dashboards.",
      outcome: "Improved load time.",
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.extensionUserId.mockResolvedValue(USER_ID)
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.prepareFindFirst.mockResolvedValue(null)
  mocks.applicationFindFirst.mockResolvedValue(null)
  mocks.resumeFindFirst.mockResolvedValue(null)
  mocks.loadCareerProfile.mockResolvedValue(PROFILE)
  mocks.generateEssayDraft.mockResolvedValue({
    draft: "I build accessible interfaces because details matter.",
    wordCount: 8,
    grounding: null,
    unsupportedNumbers: [],
    reviewRequired: true,
    autoFill: false,
  })
})

describe("POST /api/extension/essay-draft", () => {
  it("returns 401 without a token owner", async () => {
    mocks.extensionUserId.mockResolvedValue(null)

    const res = await POST(request())

    expect(res.status).toBe(401)
    expect(mocks.generateEssayDraft).not.toHaveBeenCalled()
  })

  it("returns 429 when the token owner exhausted the bucket", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await POST(request())

    expect(res.status).toBe(429)
    expect(mocks.generateEssayDraft).not.toHaveBeenCalled()
  })

  it("refuses a sensitive question before calling a provider", async () => {
    const res = await POST(request({ question: "What are your salary expectations?" }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "NOT_AN_ESSAY" })
    expect(mocks.generateEssayDraft).not.toHaveBeenCalled()
  })

  it("refuses a preparation owned by someone else", async () => {
    mocks.prepareFindFirst.mockResolvedValue(null)

    const res = await POST(
      request({
        question: "Describe a project you are proud of.",
        preparationId: "prep-other",
      })
    )

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("NOT_FOUND")
    expect(mocks.generateEssayDraft).not.toHaveBeenCalled()
  })

  it("refuses a selected resume owned by someone else", async () => {
    mocks.resumeFindFirst.mockResolvedValue(null)

    const res = await POST(
      request({
        question: "Describe a project you are proud of.",
        resumeId: "resume-other",
      })
    )

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("RESUME_NOT_FOUND")
    expect(mocks.generateEssayDraft).not.toHaveBeenCalled()
  })

  it("uses the preparation and resume context for the grounded draft", async () => {
    mocks.prepareFindFirst.mockResolvedValue({
      id: "prep-1",
      jobApplicationId: "app-1",
      jobTitle: "Frontend Engineer",
      companyName: "Acme",
      resumeId: "resume-1",
    })
    mocks.applicationFindFirst.mockResolvedValue({
      resumeId: "resume-1",
      job: {
        title: "Frontend Engineer",
        companyName: "Acme",
        description: "Requirements:\n- React",
      },
    })
    mocks.resumeFindFirst.mockResolvedValue({ id: "resume-1", sections: [] })

    const res = await POST(
      request({
        question: "Describe a project you are proud of.",
        preparationId: "prep-1",
        maxWords: 180,
      })
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(mocks.generateEssayDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        question: "Describe a project you are proud of.",
        jobTitle: "Frontend Engineer",
        companyName: "Acme",
        maxWords: 180,
      })
    )
    const call = mocks.generateEssayDraft.mock.calls[0][0] as {
      evidenceText: string
    }
    expect(call.evidenceText).toContain("Built React dashboards at Acme.")
    expect(call.evidenceText).toContain("TypeScript")
    expect(await res.json()).toMatchObject({
      draft: "I build accessible interfaces because details matter.",
      reviewRequired: true,
      autoFill: false,
    })
  })

  it("returns 500 when drafting fails", async () => {
    mocks.generateEssayDraft.mockRejectedValue(new Error("provider down"))

    const res = await POST(request())

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("ESSAY_DRAFT_FAILED")
  })
})
