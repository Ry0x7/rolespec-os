// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findApplication: vi.fn(),
  findResume: vi.fn(),
  findProfile: vi.fn(),
  createRun: vi.fn(),
  updateRun: vi.fn(),
  createResume: vi.fn(),
  createSnapshot: vi.fn(),
  createValidation: vi.fn(),
  createEditEvent: vi.fn(),
  transaction: vi.fn(),
  generate: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    jobApplication: { findFirst: mocks.findApplication },
    resume: { findFirst: mocks.findResume },
    careerProfile: { findFirst: mocks.findProfile },
    resumeTailoringRun: { create: mocks.createRun, update: mocks.updateRun },
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/features/resume/services/tailor-resume", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/resume/services/tailor-resume")>()
  return { ...actual, generateJobTailorSuggestions: mocks.generate }
})

import { tailorResumeForApplication } from "../tailoring.service"

const APPLICATION = {
  id: "app-1",
  resumeId: "resume-1",
  job: {
    title: "Senior Backend Engineer",
    companyName: "Acme",
    description: "Build TypeScript APIs for payments.",
  },
}

const SOURCE = {
  id: "resume-1",
  version: 2,
  title: "Backend resume",
  template: "MINIMAL",
  targetRole: "Backend Engineer",
  targetCompany: null,
  careerProfileId: null,
  roleFamilyId: null,
  sections: [
    {
      id: "section-1",
      type: "SUMMARY",
      title: "Summary",
      order: 0,
      visible: true,
      items: [
        {
          id: "item-1",
          content: { text: "Backend engineer working with TypeScript APIs." },
          metadata: null,
          order: 0,
        },
      ],
    },
    {
      id: "section-2",
      type: "EXPERIENCE",
      title: "Experience",
      order: 1,
      visible: true,
      items: [
        {
          id: "item-2",
          content: {
            role: "Backend Engineer",
            company: "Acme",
            bullets: ["Built TypeScript APIs."],
          },
          metadata: null,
          order: 0,
        },
      ],
    },
  ],
}

const FABRICATED = {
  suggestions: [
    {
      targetId: "s1::i0::b0",
      action: "rewrite" as const,
      suggested: "Built TypeScript APIs used by 40% of customers.",
      reason: "Adds scale.",
    },
  ],
  generatedSummary: null,
}

const ESCALATED = {
  suggestions: [
    {
      targetId: "s1::i0::b0",
      action: "rewrite" as const,
      suggested: "Led TypeScript API development.",
      reason: "Shows ownership.",
    },
  ],
  generatedSummary: null,
}

const GROUNDED = {
  suggestions: [
    {
      targetId: "s1::i0::b0",
      action: "rewrite" as const,
      suggested: "Built and maintained TypeScript APIs.",
      reason: "Matches the posting domain.",
    },
  ],
  generatedSummary: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findApplication.mockResolvedValue(APPLICATION)
  mocks.findResume.mockResolvedValue(SOURCE)
  mocks.findProfile.mockResolvedValue(null)
  mocks.createRun.mockResolvedValue({ id: "tailor-run-1" })
  mocks.updateRun.mockResolvedValue({ id: "tailor-run-1" })
  mocks.createResume.mockResolvedValue({ id: "draft-1", version: 1 })
  mocks.createSnapshot.mockResolvedValue({ id: "snapshot-1" })
  mocks.createValidation.mockResolvedValue({ id: "validation-1" })
  mocks.createEditEvent.mockResolvedValue({ id: "edit-1" })
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      resume: { create: mocks.createResume },
      resumeSnapshot: { create: mocks.createSnapshot },
      resumeValidation: { create: mocks.createValidation },
      resumeEditEvent: { create: mocks.createEditEvent },
      resumeTailoringRun: { update: mocks.updateRun },
    })
  )
  mocks.generate.mockResolvedValue(GROUNDED)
})

describe("tailorResumeForApplication", () => {
  it("repairs a fabricated metric with a bounded second generation, then saves a DRAFT", async () => {
    mocks.generate
      .mockResolvedValueOnce(FABRICATED)
      .mockResolvedValueOnce(GROUNDED)

    const outcome = await tailorResumeForApplication({
      userId: "user-1",
      jobApplicationId: "app-1",
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.attempts).toBe(2)
    expect(outcome.result.validation.status).toBe("PASS")
    expect(outcome.result.resumeId).toBe("draft-1")
    expect(mocks.generate).toHaveBeenCalledTimes(2)
    expect(mocks.generate.mock.calls[1][0].repair).toMatchObject({ attempt: 1 })
    expect(mocks.generate.mock.calls[1][0].repair.issues.join(" ")).toContain("40")

    expect(mocks.createResume).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "DRAFT",
        variant: "JOB_TAILORED",
        sourceResumeId: "resume-1",
        jobApplicationId: "app-1",
        title: "Senior Backend Engineer — Backend resume",
      }),
      select: { id: true, version: true },
    })
    expect(mocks.createSnapshot).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resumeId: "draft-1",
        sourceResumeId: "resume-1",
        sourceVersion: 2,
        hash: outcome.result.snapshotHash,
      }),
      select: { id: true },
    })
    expect(mocks.createValidation).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resumeId: "draft-1",
        tailoringRunId: "tailor-run-1",
        status: "PASS",
      }),
      select: { id: true },
    })
    expect(mocks.createEditEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resumeId: "draft-1",
        kind: "TAILORING_APPLIED",
      }),
    })
    // The draft is reviewable, not silently chosen for the application.
    expect(mocks.findApplication).toHaveBeenCalled()
    expect(outcome.result.validation.claims[0].evidenceRefs.length).toBeGreaterThan(0)
    expect(outcome.result.validation.claims[0].requirementIds.length).toBeGreaterThan(0)
  })

  it("stops after three bounded generations and saves no invalid resume", async () => {
    mocks.generate.mockResolvedValue(ESCALATED)

    const outcome = await tailorResumeForApplication({
      userId: "user-1",
      jobApplicationId: "app-1",
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe("VALIDATION_FAILED")
    expect(outcome.message).toContain("3 bounded attempts")
    expect(outcome.message).toContain("IMPLIED_SENIORITY")
    expect(mocks.generate).toHaveBeenCalledTimes(3)
    expect(mocks.createResume).not.toHaveBeenCalled()
    expect(mocks.createSnapshot).not.toHaveBeenCalled()
    expect(mocks.updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "NEEDS_REVIEW", attempts: 3 }),
      })
    )
  })

  it("records a run with the immutable source snapshot even when generation fails", async () => {
    mocks.generate.mockRejectedValue(new Error("provider exploded"))

    const outcome = await tailorResumeForApplication({
      userId: "user-1",
      jobApplicationId: "app-1",
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe("PROVIDER_FAILURE")
    expect(mocks.createResume).not.toHaveBeenCalled()
    expect(mocks.createRun).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "RUNNING",
        sourceResumeId: "resume-1",
        sourceVersion: 2,
        snapshot: expect.objectContaining({
          sourceResumeId: "resume-1",
          sourceVersion: 2,
        }),
      }),
      select: { id: true },
    })
    expect(mocks.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    )
  })

  it("surfaces a logged-out local CLI as a configuration problem", async () => {
    mocks.generate.mockRejectedValue(new Error("Not logged in · Please run /login"))

    const outcome = await tailorResumeForApplication({
      userId: "user-1",
      jobApplicationId: "app-1",
    })

    expect(outcome).toMatchObject({
      ok: false,
      reason: "PROVIDER_CONFIGURATION",
      retryable: false,
    })
    if (!outcome.ok) {
      expect(outcome.message).toContain("AI provider is not ready")
      expect(outcome.message).toContain("Not logged in")
    }
    expect(mocks.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          lastError: "Not logged in · Please run /login",
        }),
      })
    )
    expect(mocks.createResume).not.toHaveBeenCalled()
  })

  it("refuses a foreign or missing application before reading a resume", async () => {
    mocks.findApplication.mockResolvedValue(null)

    const outcome = await tailorResumeForApplication({
      userId: "user-1",
      jobApplicationId: "app-2",
    })

    expect(outcome).toMatchObject({ ok: false, reason: "NO_APPLICATION" })
    expect(mocks.findResume).not.toHaveBeenCalled()
    expect(mocks.createRun).not.toHaveBeenCalled()
  })

  it("does no provider work or persistence after the step signal aborts", async () => {
    const controller = new AbortController()
    controller.abort()

    const outcome = await tailorResumeForApplication({
      userId: "user-1",
      jobApplicationId: "app-1",
      signal: controller.signal,
    })

    expect(outcome).toMatchObject({ ok: false, reason: "PROVIDER_FAILURE", retryable: false })
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(mocks.createResume).not.toHaveBeenCalled()
  })
})
