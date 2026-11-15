/**
 * The plumbing test for the deterministic name checks.
 *
 * The services already produce `signature` (and, on the application email only,
 * `subjectName`); this asserts the actions carry them out to the client — and
 * that `missing_name` does NOT get out. That suppression is a product decision
 * with one home, `signature-visibility.ts`, and it is asserted at every layer
 * that could route around it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  mockAuth,
  mockPrisma,
  mockConsumeRateLimit,
  mockLoadResumeText,
  mockApplicationAI,
  mockColdAI,
  mockReplyAI,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: { jobApplication: { findUnique: vi.fn() } },
  mockConsumeRateLimit: vi.fn(),
  mockLoadResumeText: vi.fn(),
  mockApplicationAI: vi.fn(),
  mockColdAI: vi.fn(),
  mockReplyAI: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_JOB_EMAIL: "ai:job-email" },
  consumeRateLimit: mockConsumeRateLimit,
}))
vi.mock("../../services/resume-text.service", () => ({
  loadResumeTextForUser: mockLoadResumeText,
}))
vi.mock("../../services/application-email.service", () => ({
  generateApplicationEmailAI: mockApplicationAI,
}))
vi.mock("../../services/cold-email.service", () => ({
  generateColdEmailAI: mockColdAI,
}))
vi.mock("../../services/reply-email.service", () => ({
  generateReplyEmailAI: mockReplyAI,
}))

import { generateApplicationEmail } from "../application-email.actions"
import { generateColdEmail } from "../cold-email.actions"
import { generateReplyEmail } from "../reply-email.actions"

const WRONG_NAME = {
  issue: "wrong_name" as const,
  expectedName: "Marisol Reyes",
  signature: ["Best,", "Cebu General Hospital staff nurse"],
  offending: ["Cebu General Hospital staff nurse"],
}

const MISSING_NAME = {
  issue: "missing_name" as const,
  expectedName: "Marisol Reyes",
  signature: ["Best regards,"],
  offending: [],
}

const UNEXPECTED_NAME = {
  issue: "unexpected_name" as const,
  expectedName: null,
  signature: ["Best,", "Alex"],
  offending: ["Alex"],
}

const SUBJECT_WRONG = {
  issue: "wrong_name" as const,
  expectedName: "Marisol Reyes",
  offending: "Platform Team",
}

function form(extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("jobApplicationId", "job-1")
  for (const [key, value] of Object.entries(extra)) fd.set(key, value)
  return fd
}

const replyForm = () => form({ receivedEmail: "Thanks for applying." })

/** What every service mock returns unless a test overrides `signature`. */
function draft(extra: Record<string, unknown>) {
  return { subject: "Application for Nurse — Marisol Reyes", body: "Hi.", grounding: null, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockConsumeRateLimit.mockResolvedValue(true)
  // Posting fields are read off the `job` relation now.
  mockPrisma.jobApplication.findUnique.mockResolvedValue({
    job: { companyName: "Acme", title: "Nurse" },
  })
  mockLoadResumeText.mockResolvedValue({
    ok: true,
    resumeText: "## Summary\nresume",
    candidateName: "Marisol Reyes",
  })
  mockApplicationAI.mockResolvedValue(draft({ signature: null, subjectName: null }))
  mockColdAI.mockResolvedValue(draft({ signature: null }))
  mockReplyAI.mockResolvedValue(draft({ signature: null }))
})

describe("generateApplicationEmail", () => {
  it("passes a wrong_name signature through to the client", async () => {
    mockApplicationAI.mockResolvedValue(draft({ signature: WRONG_NAME, subjectName: null }))

    const result = await generateApplicationEmail(form())

    expect("error" in result).toBe(false)
    expect(result).toMatchObject({ signature: WRONG_NAME })
  })

  it("strips a missing_name signature before it leaves the action", async () => {
    mockApplicationAI.mockResolvedValue(draft({ signature: MISSING_NAME, subjectName: null }))

    const result = await generateApplicationEmail(form())

    expect(result).toMatchObject({ signature: null })
  })

  it("passes the subject-name finding through", async () => {
    mockApplicationAI.mockResolvedValue(
      draft({ signature: MISSING_NAME, subjectName: SUBJECT_WRONG })
    )

    const result = await generateApplicationEmail(form())

    // The suppressed sign-off finding must not take the subject one with it.
    expect(result).toMatchObject({ signature: null, subjectName: SUBJECT_WRONG })
  })

  it("reports a clean draft as null on both fields", async () => {
    const result = await generateApplicationEmail(form())
    expect(result).toMatchObject({ signature: null, subjectName: null })
  })
})

describe("generateColdEmail", () => {
  it("passes an unexpected_name signature through", async () => {
    mockColdAI.mockResolvedValue(draft({ signature: UNEXPECTED_NAME }))

    const result = await generateColdEmail(form())

    expect(result).toMatchObject({ signature: UNEXPECTED_NAME })
  })

  it("strips a missing_name signature", async () => {
    mockColdAI.mockResolvedValue(draft({ signature: MISSING_NAME }))

    const result = await generateColdEmail(form())

    expect(result).toMatchObject({ signature: null })
  })

  it("has no subjectName field — that check is application-email only", async () => {
    const result = await generateColdEmail(form())
    expect("subjectName" in result).toBe(false)
  })
})

describe("generateReplyEmail", () => {
  it("passes a wrong_name signature through", async () => {
    mockReplyAI.mockResolvedValue(draft({ signature: WRONG_NAME }))

    const result = await generateReplyEmail(replyForm())

    expect(result).toMatchObject({ signature: WRONG_NAME })
  })

  it("strips a missing_name signature", async () => {
    mockReplyAI.mockResolvedValue(draft({ signature: MISSING_NAME }))

    const result = await generateReplyEmail(replyForm())

    expect(result).toMatchObject({ signature: null })
  })
})
