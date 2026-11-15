// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveApiUserId: vi.fn(),
  consumeRateLimit: vi.fn(),
  readIntakeUpload: vi.fn(),
  createIntakeRun: vi.fn(),
  getIntakeRun: vi.fn(),
  scheduleIntakeRun: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/features/auth/api-auth", () => ({
  resolveApiUserId: mocks.resolveApiUserId,
}))

vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { INTAKE_UPLOAD: "intake:upload" },
  consumeRateLimit: mocks.consumeRateLimit,
}))

vi.mock("@/features/intake/services/intake-upload.service", () => ({
  readIntakeUpload: mocks.readIntakeUpload,
}))

vi.mock("@/features/intake/services/intake-run.service", () => ({
  createIntakeRun: mocks.createIntakeRun,
  getIntakeRun: mocks.getIntakeRun,
}))

vi.mock("@/features/intake/services/schedule", () => ({
  scheduleIntakeRun: mocks.scheduleIntakeRun,
}))

vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ error: mocks.logError }),
}))

import { POST } from "../route"

const RUN = { id: "run-1", status: "PENDING", sources: [], patches: [] }

function upload(query: string) {
  return POST(new Request(`http://localhost/api/intake/upload${query}`, { method: "POST" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveApiUserId.mockResolvedValue("user-1")
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.readIntakeUpload.mockResolvedValue({
    ok: true,
    text: "Ada Lovelace\nada@example.com\nExperience\nEngineer at Acme",
    fileName: "ada.pdf",
  })
  mocks.createIntakeRun.mockResolvedValue("run-1")
  mocks.getIntakeRun.mockResolvedValue(RUN)
  mocks.scheduleIntakeRun.mockResolvedValue(undefined)
})

describe("POST /api/intake/upload", () => {
  it("rejects an anonymous caller", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)

    const res = await upload("?source=RESUME")

    expect(res.status).toBe(401)
    expect(mocks.readIntakeUpload).not.toHaveBeenCalled()
  })

  it("rejects a missing or unsupported source before spending an upload slot", async () => {
    for (const query of ["", "?source=CHAT", "?source=resume"]) {
      const res = await upload(query)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("INVALID_SOURCE")
    }
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
  })

  it("returns 429 before reading the file when the upload limit is exhausted", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await upload("?source=RESUME")

    expect(res.status).toBe(429)
    expect(mocks.readIntakeUpload).not.toHaveBeenCalled()
  })

  it("passes through the upload failure status and code", async () => {
    mocks.readIntakeUpload.mockResolvedValue({
      ok: false,
      status: 415,
      code: "INVALID_TYPE",
      error: "Only PDF and DOCX files are supported.",
    })

    const res = await upload("?source=RESUME")

    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({
      error: "Only PDF and DOCX files are supported.",
      code: "INVALID_TYPE",
    })
    expect(mocks.createIntakeRun).not.toHaveBeenCalled()
  })

  it("creates a RESUME run from the extracted text and schedules it", async () => {
    const res = await upload("?source=RESUME")

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ run: RUN })
    expect(mocks.createIntakeRun).toHaveBeenCalledWith("user-1", [
      {
        source: "RESUME",
        input: {
          text: "Ada Lovelace\nada@example.com\nExperience\nEngineer at Acme",
          fileName: "ada.pdf",
        },
      },
    ])
    expect(mocks.scheduleIntakeRun).toHaveBeenCalledWith("run-1")
  })

  it("passes the AI opt-in only for a LinkedIn export", async () => {
    const res = await upload("?source=LINKEDIN&useAi=1")

    expect(res.status).toBe(202)
    expect(mocks.createIntakeRun).toHaveBeenCalledWith("user-1", [
      {
        source: "LINKEDIN",
        input: {
          text: "Ada Lovelace\nada@example.com\nExperience\nEngineer at Acme",
          fileName: "ada.pdf",
          useAi: true,
        },
      },
    ])
  })

  it("does not echo a create failure", async () => {
    mocks.createIntakeRun.mockRejectedValue(new Error("connect ECONNREFUSED"))

    const res = await upload("?source=RESUME")

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("Could not start intake. Please try again.")
    expect(mocks.scheduleIntakeRun).not.toHaveBeenCalled()
  })
})
