import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  jobApplicationFindFirst: vi.fn(),
  jobApplicationUpdate: vi.fn(),
  careerProfileFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  workflowStepFindFirst: vi.fn(),
  workflowStepFindMany: vi.fn(),
  applicationStatusEventCount: vi.fn(),
  followUpTaskFindMany: vi.fn(),
  stageSubmissionAttempt: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    jobApplication: {
      findFirst: mocks.jobApplicationFindFirst,
      update: mocks.jobApplicationUpdate,
    },
    careerProfile: { findUnique: mocks.careerProfileFindUnique },
    user: { findUnique: mocks.userFindUnique },
    workflowStep: {
      findFirst: mocks.workflowStepFindFirst,
      findMany: mocks.workflowStepFindMany,
    },
    applicationStatusEvent: { count: mocks.applicationStatusEventCount },
    followUpTask: { findMany: mocks.followUpTaskFindMany },
  },
}))

vi.mock("@/features/submissions/services/submission.service", () => ({
  stageSubmissionAttempt: mocks.stageSubmissionAttempt,
}))

import { followUpExecutor } from "../follow-up.executor"
import { humanReviewExecutor } from "../human-review.executor"
import { prepareAtsExecutor } from "../prepare-ats.executor"
import { stagingExecutor } from "../staging.executor"
import { trackingExecutor } from "../tracking.executor"

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
    description: "Build TypeScript APIs. Must be authorized to work in the US.",
    location: "Remote - Philippines",
    workType: "REMOTE",
    url: "https://acme.example/jobs/1",
    salary: null,
    salaryPeriod: null,
    salaryCurrency: "USD",
    postedAt: new Date("2026-11-01T00:00:00.000Z"),
    requirementFlags: ["US_ONLY"],
  },
}

function context(stepName: string) {
  return {
    runId: "run-1",
    stepId: "step-1",
    userId: "user-1",
    jobApplicationId: "app-1",
    input: { jobApplicationId: "app-1", resumeId: "resume-1" },
    stepName: stepName as never,
    attempt: 1,
    signal: new AbortController().signal,
    now: new Date("2026-11-11T00:00:00.000Z"),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.jobApplicationFindFirst.mockResolvedValue(APPLICATION)
  mocks.followUpTaskFindMany.mockResolvedValue([])
  mocks.careerProfileFindUnique.mockResolvedValue({
    contactFullName: "Ada Lovelace",
    contactEmail: "ada@example.com",
    contactPhone: null,
    contactLocation: "Manila",
    linkedinUrl: "https://linkedin.example/ada",
    githubUrl: null,
    websiteUrl: null,
    requiresSponsorship: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: "USD",
    salaryPeriod: null,
    workAuthorization: "US citizen",
  })
  mocks.userFindUnique.mockResolvedValue({ name: "Ada", email: "ada@account.example" })
  mocks.workflowStepFindFirst.mockResolvedValue({
    output: { fields: { fullName: "Ada", email: "ada@example.com" }, needsUserAnswer: [] },
  })
  mocks.workflowStepFindMany.mockResolvedValue([])
  mocks.applicationStatusEventCount.mockResolvedValue(0)
  mocks.stageSubmissionAttempt.mockResolvedValue({
    id: "attempt-1",
    status: "STAGED",
    jobApplicationId: "app-1",
    source: "WORKFLOW",
  })
})

describe("prepareAtsExecutor", () => {
  it("never answers work authorization or sponsorship", async () => {
    const outcome = await prepareAtsExecutor(context("PREPARE_ATS"))

    expect(outcome.status).toBe("COMPLETED")
    if (outcome.status !== "COMPLETED") return
    const fields = outcome.output.fields as Record<string, string>
    const blocked = outcome.output.needsUserAnswer as Array<{ field: string }>
    expect(fields).not.toHaveProperty("workAuthorization")
    expect(fields).not.toHaveProperty("sponsorship")
    expect(blocked.map((entry) => entry.field)).toContain("workAuthorization")
    expect(blocked.map((entry) => entry.field)).toContain("sponsorship")
    expect(outcome.output.resumeExportReady).toBe(false)
    expect(mocks.jobApplicationUpdate).not.toHaveBeenCalled()
  })
})

describe("humanReviewExecutor", () => {
  it("names the real job and never approves anything itself", async () => {
    const outcome = await humanReviewExecutor(context("HUMAN_REVIEW"))

    expect(outcome.status).toBe("WAITING_FOR_USER")
    if (outcome.status !== "WAITING_FOR_USER") return
    expect(outcome.review.kind).toBe("SUBMISSION_CONFIRMATION")
    expect(outcome.review.question).toContain("Senior Backend Engineer")
    expect(outcome.review.question).toContain("Acme")
    expect(outcome.review.reason).toContain("Nothing has been submitted")
    expect(outcome.review.suggestedValue).toEqual({
      preparedFieldCount: 2,
      blockedQuestionCount: 0,
      tailoredResumeId: null,
      validationStatus: null,
      validationIssueCount: 0,
      needsReview: false,
    })
  })
})

describe("stagingExecutor", () => {
  it("refuses to stage without an approved review and writes nothing", async () => {
    mocks.workflowStepFindMany.mockResolvedValue([
      { name: "HUMAN_REVIEW", status: "WAITING_FOR_USER", output: null },
    ])

    const outcome = await stagingExecutor(context("SUBMISSION_STAGING"))

    expect(outcome.status).toBe("FAILED")
    if (outcome.status !== "FAILED") return
    expect(outcome.retryable).toBe(false)
    expect(outcome.fallback).toContain("approve the human review")
    expect(mocks.jobApplicationUpdate).not.toHaveBeenCalled()
    expect(mocks.stageSubmissionAttempt).not.toHaveBeenCalled()
  })

  it("stages an approved bundle with submitted: false and no application write", async () => {
    mocks.workflowStepFindMany.mockResolvedValue([
      { name: "RANK", status: "COMPLETED", output: { score: 82 } },
      { name: "RESEARCH", status: "COMPLETED", output: { companyConfidence: "HIGH" } },
      {
        name: "TAILOR",
        status: "COMPLETED",
        output: { suggestions: [{ targetId: "s0::i0" }, { targetId: "s0::i1" }] },
      },
      { name: "VALIDATE", status: "COMPLETED", output: { validated: true } },
      {
        name: "PREPARE_ATS",
        status: "COMPLETED",
        output: { fields: { fullName: "Ada" }, needsUserAnswer: [{ field: "x" }] },
      },
      { name: "HUMAN_REVIEW", status: "COMPLETED", output: { approved: true } },
    ])

    const outcome = await stagingExecutor(context("SUBMISSION_STAGING"))

    expect(outcome.status).toBe("COMPLETED")
    if (outcome.status !== "COMPLETED") return
    expect(outcome.output.submitted).toBe(false)
    expect(outcome.output.staged).toBe(true)
    expect(outcome.output.submissionAttemptId).toBe("attempt-1")
    expect(mocks.stageSubmissionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        jobApplicationId: "app-1",
        workflowRunId: "run-1",
        source: "WORKFLOW",
      })
    )
    expect(outcome.output.job).toMatchObject({
      id: "job-1",
      title: "Senior Backend Engineer",
      companyName: "Acme",
    })
    expect(outcome.output.evidence).toMatchObject({
      rankScore: 82,
      researchConfidence: "HIGH",
      tailoringSuggestionCount: 2,
      validated: true,
      atsFields: 1,
      blockedQuestions: 1,
    })
    expect(mocks.jobApplicationUpdate).not.toHaveBeenCalled()
  })
})

describe("trackingExecutor", () => {
  it("reads the tracker and writes nothing", async () => {
    mocks.applicationStatusEventCount.mockResolvedValue(3)

    const outcome = await trackingExecutor(context("TRACKING"))

    expect(outcome.status).toBe("COMPLETED")
    if (outcome.status !== "COMPLETED") return
    expect(outcome.output.applicationStatus).toBe("INTERESTED")
    expect(outcome.output.dateApplied).toBeNull()
    expect(outcome.output.statusEventCount).toBe(3)
    expect(String(outcome.output.nextAction)).toContain("still need to submit")
    expect(mocks.jobApplicationUpdate).not.toHaveBeenCalled()
  })
})

describe("followUpExecutor", () => {
  it("recommends a date without scheduling or sending", async () => {
    const outcome = await followUpExecutor(context("FOLLOW_UP"))

    expect(outcome.status).toBe("COMPLETED")
    if (outcome.status !== "COMPLETED") return
    expect(outcome.output.scheduled).toBe(false)
    expect(outcome.output.sent).toBe(false)
    expect(outcome.output.recommendedChannel).toBe("EMAIL")
    expect(String(outcome.output.rationale)).toContain("after you submit")
    expect(mocks.jobApplicationUpdate).not.toHaveBeenCalled()
  })
})

describe("missing application", () => {
  it("fails every tail step with a manual fallback instead of throwing", async () => {
    mocks.jobApplicationFindFirst.mockResolvedValue(null)

    for (const executor of [
      prepareAtsExecutor,
      humanReviewExecutor,
      stagingExecutor,
      trackingExecutor,
      followUpExecutor,
    ]) {
      const outcome = await executor(context("TRACKING"))
      expect(outcome.status).toBe("FAILED")
      if (outcome.status === "FAILED") {
        expect(outcome.fallback).toContain("tracker")
      }
    }
  })
})
