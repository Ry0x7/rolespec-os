// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findApplication: vi.fn(),
  findStep: vi.fn(),
  findTailoringRun: vi.fn(),
  findResume: vi.fn(),
  createValidation: vi.fn(),
  tailor: vi.fn(),
  countEvidenceReferences: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    jobApplication: { findFirst: mocks.findApplication },
    workflowStep: { findFirst: mocks.findStep },
    resumeTailoringRun: { findFirst: mocks.findTailoringRun },
    resume: { findFirst: mocks.findResume },
    resumeValidation: { create: mocks.createValidation },
  },
}))

vi.mock("@/features/resume/tailoring/tailoring.service", () => ({
  tailorResumeForApplication: mocks.tailor,
  countEvidenceReferences: mocks.countEvidenceReferences,
}))

import { tailorExecutor } from "../tailor.executor"
import { validateExecutor } from "../validate.executor"
import type { WorkflowExecutionContext } from "../../types"

const CONTEXT: WorkflowExecutionContext = {
  runId: "run-1",
  stepId: "step-1",
  userId: "user-1",
  jobApplicationId: "app-1",
  input: { targetRole: "Backend Engineer" },
  stepName: "TAILOR",
  attempt: 1,
  signal: new AbortController().signal,
  now: new Date("2026-11-11T00:00:00.000Z"),
}

const APPLICATION = {
  id: "app-1",
  userId: "user-1",
  status: "INTERESTED",
  dateApplied: null,
  followUpAt: null,
  lastFollowedUpAt: null,
  resumeId: "resume-1",
  job: {
    id: "job-1",
    title: "Senior Backend Engineer",
    companyName: "Acme",
    description: "We build TypeScript APIs with PostgreSQL.",
    location: "Remote - Philippines",
    workType: "REMOTE",
    url: "https://acme.example/jobs/1",
    salary: null,
    salaryPeriod: null,
    salaryCurrency: "USD",
    postedAt: null,
    requirementFlags: [],
  },
}

const PASS_REPORT = {
  status: "PASS" as const,
  sourceHash: "hash-source",
  issues: [],
  claims: [
    {
      claimId: "claim-1",
      sectionType: "EXPERIENCE",
      itemRef: "section:EXPERIENCE:1/item:0",
      field: "bullets.0",
      change: "rewritten" as const,
      sourceText: "Built TypeScript APIs.",
      tailoredText: "Built TypeScript APIs for payments.",
      evidenceRefs: [
        {
          ref: "section:EXPERIENCE:1/item:0:bullets.0",
          label: "Experience — bullets.0",
          quote: "Built TypeScript APIs.",
          origin: "resume" as const,
          requirementIds: ["req-1"],
        },
      ],
      requirementIds: ["req-1"],
    },
  ],
  requirementCoverage: { supported: 2, partial: 1, unsupported: 1, total: 4 },
  checkedAt: "2026-11-11T00:00:00.000Z",
}

const SUCCESS_RESULT = {
  status: "COMPLETED" as const,
  runId: "tailor-run-1",
  resumeId: "draft-1",
  sourceResumeId: "resume-1",
  sourceVersion: 3,
  snapshotHash: "hash-source",
  validation: PASS_REPORT,
  requirements: [],
  attempts: 1,
  rejected: [],
  review: null,
}

const SOURCE_SNAPSHOT = {
  sourceResumeId: "resume-1",
  sourceVersion: 3,
  capturedAt: "2026-11-11T00:00:00.000Z",
  title: "Backend resume",
  template: "MINIMAL",
  targetRole: "Backend Engineer",
  targetCompany: "Acme",
  sections: [
    {
      id: "section-1",
      type: "EXPERIENCE",
      title: "Experience",
      order: 0,
      visible: true,
      items: [
        {
          id: "item-1",
          content: {
            role: "Backend Engineer",
            company: "Acme",
            bullets: ["Built TypeScript APIs."],
          },
          order: 0,
        },
      ],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findApplication.mockResolvedValue(APPLICATION)
  mocks.tailor.mockResolvedValue({ ok: true, result: SUCCESS_RESULT })
  mocks.countEvidenceReferences.mockReturnValue(1)
  mocks.findStep.mockResolvedValue({
    status: "COMPLETED",
    output: {
      resumeId: "draft-1",
      tailoringRunId: "tailor-run-1",
      validationStatus: "PASS",
      suggestionCount: 1,
      issueCount: 0,
      needsReview: false,
    },
  })
  mocks.findTailoringRun.mockResolvedValue({
    id: "tailor-run-1",
    snapshot: SOURCE_SNAPSHOT,
    requirementMap: [],
    snapshotHash: "hash-source",
  })
  mocks.findResume.mockResolvedValue({
    id: "draft-1",
    sections: [
      {
        id: "draft-section-1",
        type: "EXPERIENCE",
        title: "Experience",
        order: 0,
        visible: true,
        items: [
          {
            id: "draft-item-1",
            content: {
              role: "Backend Engineer",
              company: "Acme",
              bullets: ["Built TypeScript APIs for payments."],
            },
            metadata: null,
            order: 0,
          },
        ],
      },
    ],
  })
  mocks.createValidation.mockResolvedValue({ id: "validation-1" })
})

describe("tailorExecutor", () => {
  it("asks for a resume instead of failing when none exists", async () => {
    mocks.tailor.mockResolvedValue({
      ok: false,
      reason: "NO_RESUME",
      message: "No resume is selected.",
    })

    const outcome = await tailorExecutor(CONTEXT)

    expect(outcome.status).toBe("WAITING_FOR_USER")
    if (outcome.status === "WAITING_FOR_USER") {
      expect(outcome.review.kind).toBe("MISSING_PROFILE_FACT")
      expect(outcome.review.fallback).toContain("Choose a resume")
    }
  })

  it("fails actionably when no AI provider is configured", async () => {
    mocks.tailor.mockResolvedValue({
      ok: false,
      reason: "PROVIDER_CONFIGURATION",
      message: "AI key required.",
      retryable: false,
    })

    const outcome = await tailorExecutor(CONTEXT)

    expect(outcome.status).toBe("FAILED")
    if (outcome.status === "FAILED") {
      expect(outcome.retryable).toBe(false)
      expect(outcome.fallback).toContain("Settings")
    }
  })

  it("pauses for a human when every bounded generation failed validation", async () => {
    mocks.tailor.mockResolvedValue({
      ok: false,
      reason: "VALIDATION_FAILED",
      message: "Three attempts produced an unsupported claim.",
      runId: "tailor-run-1",
      validation: {
        ...PASS_REPORT,
        status: "FAIL",
        issues: [
          {
            code: "FABRICATED_METRIC",
            severity: "error",
            message: "40% was not in the source.",
          },
        ],
      },
    })

    const outcome = await tailorExecutor(CONTEXT)

    expect(outcome.status).toBe("WAITING_FOR_USER")
    if (outcome.status === "WAITING_FOR_USER") {
      expect(outcome.review.kind).toBe("AMBIGUOUS_TAILORING")
      expect(outcome.review.reason).toContain("FABRICATED_METRIC")
      expect(outcome.review.fallback).toContain("No invalid draft was saved")
    }
  })

  it("records the persisted draft and validation, never submitting anything", async () => {
    const outcome = await tailorExecutor(CONTEXT)

    expect(outcome.status).toBe("COMPLETED")
    if (outcome.status === "COMPLETED") {
      expect(outcome.output).toMatchObject({
        resumeId: "draft-1",
        tailoringRunId: "tailor-run-1",
        validationStatus: "PASS",
        claimCount: 1,
        evidenceReferenceCount: 1,
        needsReview: false,
      })
      expect(outcome.output).not.toHaveProperty("submitted")
    }
    expect(mocks.tailor).toHaveBeenCalledWith({
      userId: "user-1",
      jobApplicationId: "app-1",
      sourceResumeId: "resume-1",
      mode: "WORKFLOW",
    })
  })
})

describe("validateExecutor", () => {
  it("skips when tailoring was skipped", async () => {
    mocks.findStep.mockResolvedValue({ status: "SKIPPED", output: null })

    const outcome = await validateExecutor({ ...CONTEXT, stepName: "VALIDATE" })

    expect(outcome.status).toBe("SKIPPED")
  })

  it("re-validates the persisted draft and passes a grounded rewrite", async () => {
    const outcome = await validateExecutor({ ...CONTEXT, stepName: "VALIDATE" })

    expect(outcome.status).toBe("COMPLETED")
    if (outcome.status === "COMPLETED") {
      expect(outcome.output).toMatchObject({
        validated: true,
        resumeId: "draft-1",
        validationStatus: "PASS",
        claims: 1,
      })
    }
    expect(mocks.createValidation).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resumeId: "draft-1",
        tailoringRunId: "tailor-run-1",
        status: "PASS",
      }),
    })
  })

  it("fails closed when the stored draft gained an unsupported claim", async () => {
    mocks.findResume.mockResolvedValue({
      id: "draft-1",
      sections: [
        {
          id: "draft-section-1",
          type: "EXPERIENCE",
          title: "Experience",
          order: 0,
          visible: true,
          items: [
            {
              id: "draft-item-1",
              content: {
                role: "Backend Engineer",
                company: "Acme",
                bullets: ["Built TypeScript APIs used by 40% of customers."],
              },
              metadata: null,
              order: 0,
            },
          ],
        },
      ],
    })

    const outcome = await validateExecutor({ ...CONTEXT, stepName: "VALIDATE" })

    expect(outcome.status).toBe("FAILED")
    if (outcome.status === "FAILED") {
      expect(outcome.error).toContain("FABRICATED_METRIC")
      expect(outcome.retryable).toBe(false)
      expect(outcome.fallback).toContain("Nothing was selected or submitted")
    }
    expect(mocks.createValidation).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "FAIL" }),
    })
  })

  it("keeps the legacy suggestion check for pre-existing runs", async () => {
    mocks.findStep.mockResolvedValue({
      status: "COMPLETED",
      output: {
        suggestions: [
          {
            targetId: "s1::i0::b0",
            originalText: "Built TypeScript APIs.",
            action: "rewrite",
            suggested: "Built TypeScript APIs with PostgreSQL and Kubernetes.",
            reason: "Matches the posting.",
          },
        ],
        grounded: { supported: ["typescript"], ambiguous: [], unsupported: ["kubernetes"] },
      },
    })

    const outcome = await validateExecutor({ ...CONTEXT, stepName: "VALIDATE" })

    expect(outcome.status).toBe("FAILED")
    if (outcome.status === "FAILED") {
      expect(outcome.error).toContain("s1::i0::b0")
      expect(outcome.error).toContain("kubernetes")
    }
  })
})
