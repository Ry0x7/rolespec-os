// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveApiUserId: vi.fn(),
  isSameOriginRequest: vi.fn(),
  consumeRateLimit: vi.fn(),
  getSubmissionAttempt: vi.fn(),
  confirmSubmissionAttempt: vi.fn(),
}))

vi.mock("@/features/auth/api-auth", () => ({
  resolveApiUserId: mocks.resolveApiUserId,
  isSameOriginRequest: mocks.isSameOriginRequest,
}))

vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { SUBMISSION_WRITE: "submission:write" },
  consumeRateLimit: mocks.consumeRateLimit,
}))

vi.mock("@/features/submissions/services/submission.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/submissions/services/submission.service")
  >("@/features/submissions/services/submission.service")
  return {
    SubmissionError: actual.SubmissionError,
    getSubmissionAttempt: mocks.getSubmissionAttempt,
    confirmSubmissionAttempt: mocks.confirmSubmissionAttempt,
  }
})

import { GET, PATCH } from "../route"
import { SubmissionError } from "@/features/submissions/services/submission.service"

const ATTEMPT = {
  id: "attempt-1",
  status: "STAGED",
  jobApplicationId: "app-1",
}

function get() {
  return GET(
    new Request("http://localhost/api/submission-attempts/attempt-1"),
    { params: Promise.resolve({ id: "attempt-1" }) }
  )
}

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/submission-attempts/attempt-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "attempt-1" }) }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveApiUserId.mockResolvedValue("user-1")
  mocks.isSameOriginRequest.mockReturnValue(true)
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.getSubmissionAttempt.mockResolvedValue(ATTEMPT)
  mocks.confirmSubmissionAttempt.mockResolvedValue({
    attempt: { ...ATTEMPT, status: "SUBMITTED" },
    applicationStatus: "APPLIED",
  })
})

describe("/api/submission-attempts/:id", () => {
  it("returns only the owner's attempt with private caching", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(mocks.getSubmissionAttempt).toHaveBeenCalledWith("user-1", "attempt-1")
  })

  it("refuses a cross-origin confirmation", async () => {
    mocks.isSameOriginRequest.mockReturnValue(false)
    const res = await patch({ submitted: true })
    expect(res.status).toBe(403)
    expect(mocks.confirmSubmissionAttempt).not.toHaveBeenCalled()
  })

  it("records an explicit confirmation and returns the tracker result", async () => {
    const res = await patch({ submitted: true, note: "confirmation page" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      submitted: true,
      applicationStatus: "APPLIED",
    })
    expect(mocks.confirmSubmissionAttempt).toHaveBeenCalledWith("user-1", "attempt-1", {
      submitted: true,
      note: "confirmation page",
    })
  })

  it("rejects a non-boolean confirmation", async () => {
    const res = await patch({ submitted: "yes" })
    expect(res.status).toBe(400)
    expect(mocks.confirmSubmissionAttempt).not.toHaveBeenCalled()
  })

  it("maps a one-way confirmation violation to 409", async () => {
    mocks.confirmSubmissionAttempt.mockRejectedValue(
      new SubmissionError("Already submitted.", "TERMINAL")
    )
    const res = await patch({ submitted: false })
    expect(res.status).toBe(409)
  })
})
