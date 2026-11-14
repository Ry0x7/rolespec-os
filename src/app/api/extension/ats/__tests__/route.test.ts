// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  consumeRateLimit: vi.fn(),
  createAtsPreparation: vi.fn(),
  getAtsPreparation: vi.fn(),
  listAtsPreparations: vi.fn(),
  recordAtsResults: vi.fn(),
  attachAtsResume: vi.fn(),
  confirmAtsSubmission: vi.fn(),
  abandonAtsPreparation: vi.fn(),
  approveAtsAnswer: vi.fn(),
  listAtsAnswers: vi.fn(),
  revokeAtsAnswer: vi.fn(),
  refreshAtsPreparationStatus: vi.fn(),
  answerFromReviewTask: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/features/settings/services/api-token", () => ({
  verifyApiToken: mocks.verifyApiToken,
}))

vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: {
    EXTENSION_ATS_PREPARE: "extension:ats-prepare",
    EXTENSION_ATS_ANSWERS: "extension:ats-answers",
    EXTENSION_ATS_REVIEW: "extension:ats-review",
    EXTENSION_RESUME_PDF: "extension:resume-pdf",
  },
  consumeRateLimit: mocks.consumeRateLimit,
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
}))

vi.mock("@/features/ats/services/ats-preparation.service", () => ({
  AtsError: class AtsError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly details?: unknown
    ) {
      super(message)
      this.name = "AtsError"
    }
  },
  createAtsPreparation: mocks.createAtsPreparation,
  getAtsPreparation: mocks.getAtsPreparation,
  listAtsPreparations: mocks.listAtsPreparations,
  recordAtsResults: mocks.recordAtsResults,
  attachAtsResume: mocks.attachAtsResume,
  confirmAtsSubmission: mocks.confirmAtsSubmission,
  abandonAtsPreparation: mocks.abandonAtsPreparation,
  approveAtsAnswer: mocks.approveAtsAnswer,
  listAtsAnswers: mocks.listAtsAnswers,
  revokeAtsAnswer: mocks.revokeAtsAnswer,
  refreshAtsPreparationStatus: mocks.refreshAtsPreparationStatus,
  answerFromReviewTask: mocks.answerFromReviewTask,
}))

vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ error: mocks.logError, info: vi.fn(), warn: vi.fn() }),
}))

import { POST as createPreparation } from "../preparations/route"
import { PATCH as patchPreparation } from "../preparations/[id]/route"
import { DELETE as deleteAnswer, POST as postAnswer } from "../answers/route"

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnop"

const PREPARATION = {
  id: "prep-1",
  jobApplicationId: "app-1",
  workflowRunId: null,
  vendor: "greenhouse",
  sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
  canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1",
  pageTitle: null,
  jobTitle: null,
  companyName: null,
  status: "READY_FOR_REVIEW",
  resumeId: null,
  resumeTitle: null,
  plan: { fields: [], fillCount: 0, reviewCount: 0, resumeUploadCount: 0 },
  results: null,
  reviewTaskIds: [],
  fieldsDetected: 1,
  fieldsFilled: 0,
  fieldsBlocked: 1,
  approvedAt: null,
  filledAt: null,
  submittedAt: null,
  submissionNote: null,
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  openReviewTasks: [],
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(mocks.verifyApiToken.getMockImplementation() === undefined
        ? {}
        : { authorization: "Bearer rspec_test" }),
      origin: EXTENSION_ORIGIN,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function field(overrides: Record<string, unknown> = {}) {
  return {
    fieldId: "af-0",
    label: "Email",
    tagName: "input",
    type: "email",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyApiToken.mockResolvedValue("user-1")
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.createAtsPreparation.mockResolvedValue({
    preparation: PREPARATION,
    approvedAnswers: [],
    created: true,
  })
  mocks.getAtsPreparation.mockResolvedValue(PREPARATION)
  mocks.listAtsPreparations.mockResolvedValue([PREPARATION])
  mocks.recordAtsResults.mockResolvedValue(PREPARATION)
  mocks.attachAtsResume.mockResolvedValue(PREPARATION)
  mocks.confirmAtsSubmission.mockResolvedValue({
    preparation: { ...PREPARATION, status: "SUBMITTED" },
    applicationStatus: "APPLIED",
  })
  mocks.approveAtsAnswer.mockResolvedValue({
    answer: {
      id: "answer-1",
      preparationId: "prep-1",
      questionKey: "will you require visa sponsorship",
      questionText: "Will you require visa sponsorship?",
      category: "sponsorship",
      sensitivity: "sensitive",
      value: "No",
      scope: "APPLICATION",
      source: "USER_APPROVED",
      approvedAt: "2026-11-11T00:00:00.000Z",
      lastUsedAt: null,
      useCount: 0,
    },
    resolvedTaskIds: ["task-1"],
    preparation: PREPARATION,
  })
  mocks.revokeAtsAnswer.mockResolvedValue({ revoked: true, preparation: PREPARATION })
  mocks.listAtsAnswers.mockResolvedValue([])
})

describe("extension ATS authorization and limits", () => {
  it("refuses a request with no token", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)
    const response = await createPreparation(
      jsonRequest("http://localhost/api/extension/ats/preparations", "POST", {
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
        fields: [field()],
      })
    )
    expect(response.status).toBe(401)
    expect(mocks.createAtsPreparation).not.toHaveBeenCalled()
  })

  it("refuses when the per-token preparation limit is exhausted", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)
    const response = await createPreparation(
      jsonRequest("http://localhost/api/extension/ats/preparations", "POST", {
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
        fields: [field()],
      })
    )
    expect(response.status).toBe(429)
    expect(mocks.createAtsPreparation).not.toHaveBeenCalled()
  })

  it("reflects CORS only to extension origins", async () => {
    const response = await createPreparation(
      jsonRequest("http://localhost/api/extension/ats/preparations", "POST", {
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
        fields: [field()],
      })
    )
    expect(response.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN)
  })
})

describe("creating a preparation", () => {
  it("passes the authenticated owner and detected fields to the service", async () => {
    const response = await createPreparation(
      jsonRequest("http://localhost/api/extension/ats/preparations", "POST", {
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
        vendor: "greenhouse",
        fields: [field({ frameId: 2 })],
      })
    )
    expect(response.status).toBe(201)
    expect(mocks.createAtsPreparation).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        vendor: "greenhouse",
        fields: [expect.objectContaining({ fieldId: "af-0", frameId: 2 })],
      })
    )
  })

  it("rejects malformed fields before they reach the service", async () => {
    const response = await createPreparation(
      jsonRequest("http://localhost/api/extension/ats/preparations", "POST", {
        sourceUrl: "not-a-url",
        fields: [{ fieldId: "", label: "" }],
      })
    )
    expect(response.status).toBe(400)
    expect(mocks.createAtsPreparation).not.toHaveBeenCalled()
  })

  it("records results when the scan response includes filled fields", async () => {
    const response = await createPreparation(
      jsonRequest("http://localhost/api/extension/ats/preparations", "POST", {
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
        fields: [field()],
        results: [{ fieldId: "af-0", status: "FILLED" }],
      })
    )
    expect(response.status).toBe(201)
    expect(mocks.recordAtsResults).toHaveBeenCalledWith("user-1", "prep-1", [
      { fieldId: "af-0", status: "FILLED" },
    ])
  })
})

describe("preparation actions", () => {
  it("records field-level outcomes", async () => {
    const response = await patchPreparation(
      jsonRequest("http://localhost/api/extension/ats/preparations/prep-1", "PATCH", {
        action: "RECORD_RESULTS",
        results: [{ fieldId: "af-0", status: "REVIEW_REQUIRED" }],
      }),
      { params: Promise.resolve({ id: "prep-1" }) }
    )
    expect(response.status).toBe(200)
    expect(mocks.recordAtsResults).toHaveBeenCalledWith("user-1", "prep-1", [
      { fieldId: "af-0", status: "REVIEW_REQUIRED" },
    ])
  })

  it("requires an explicit submitted boolean", async () => {
    const response = await patchPreparation(
      jsonRequest("http://localhost/api/extension/ats/preparations/prep-1", "PATCH", {
        action: "CONFIRM_SUBMISSION",
      }),
      { params: Promise.resolve({ id: "prep-1" }) }
    )
    expect(response.status).toBe(400)
    expect(mocks.confirmAtsSubmission).not.toHaveBeenCalled()
  })

  it("never confirms a submission on the user's behalf", async () => {
    const response = await patchPreparation(
      jsonRequest("http://localhost/api/extension/ats/preparations/prep-1", "PATCH", {
        action: "CONFIRM_SUBMISSION",
        submitted: true,
        note: "confirmation page shown",
      }),
      { params: Promise.resolve({ id: "prep-1" }) }
    )
    expect(response.status).toBe(200)
    expect(mocks.confirmAtsSubmission).toHaveBeenCalledWith("user-1", "prep-1", {
      submitted: true,
      note: "confirmation page shown",
    })
  })
})

describe("approved answer memory", () => {
  it("passes the question, value, scope and replacement flag through", async () => {
    const response = await postAnswer(
      jsonRequest("http://localhost/api/extension/ats/answers", "POST", {
        preparationId: "prep-1",
        questionText: "Will you require visa sponsorship?",
        value: "No",
        scope: "APPLICATION",
        replace: true,
      })
    )
    expect(response.status).toBe(201)
    expect(mocks.approveAtsAnswer).toHaveBeenCalledWith("user-1", {
      preparationId: "prep-1",
      questionText: "Will you require visa sponsorship?",
      value: "No",
      scope: "APPLICATION",
      replace: true,
    })
  })

  it("returns a conflict with the existing answer, not a silent overwrite", async () => {
    const { AtsError } = await import("@/features/ats/services/ats-preparation.service")
    mocks.approveAtsAnswer.mockRejectedValue(
      new AtsError("A different answer exists.", "CONFLICT", {
        existingAnswer: { id: "answer-old", value: "Yes" },
      })
    )
    const response = await postAnswer(
      jsonRequest("http://localhost/api/extension/ats/answers", "POST", {
        preparationId: "prep-1",
        questionText: "Will you require visa sponsorship?",
        value: "No",
        scope: "APPLICATION",
      })
    )
    expect(response.status).toBe(409)
    const body = (await response.json()) as { code: string; details: unknown }
    expect(body.code).toBe("CONFLICT")
    expect(body.details).toMatchObject({
      existingAnswer: { id: "answer-old", value: "Yes" },
    })
  })

  it("revokes by answer id for the authenticated owner", async () => {
    const response = await deleteAnswer(
      jsonRequest("http://localhost/api/extension/ats/answers", "DELETE", {
        id: "answer-1",
      })
    )
    expect(response.status).toBe(200)
    expect(mocks.revokeAtsAnswer).toHaveBeenCalledWith("user-1", "answer-1")
  })
})
