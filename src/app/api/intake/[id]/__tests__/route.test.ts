// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveApiUserId: vi.fn(),
  getIntakeRun: vi.fn(),
  cancelIntakeRun: vi.fn(),
  retryIntakeRun: vi.fn(),
  scheduleIntakeRun: vi.fn(),
}))

vi.mock("@/features/auth/api-auth", () => ({
  resolveApiUserId: mocks.resolveApiUserId,
}))

vi.mock("@/features/intake/services/intake-run.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/intake/services/intake-run.service")>()
  return {
    ...actual,
    getIntakeRun: mocks.getIntakeRun,
    cancelIntakeRun: mocks.cancelIntakeRun,
    retryIntakeRun: mocks.retryIntakeRun,
  }
})

vi.mock("@/features/intake/services/schedule", () => ({
  scheduleIntakeRun: mocks.scheduleIntakeRun,
}))

import { IntakeRunError } from "@/features/intake/services/intake-run.service"
import { GET } from "../route"
import { POST as CANCEL } from "../cancel/route"
import { POST as RETRY } from "../retry/route"
import { GET as STREAM } from "../stream/route"

const RUN = {
  id: "run-1",
  status: "RUNNING",
  requestedSources: ["RESUME"],
  warnings: [],
  sources: [],
  patches: [],
  counts: { pending: 0, applied: 0, conflicts: 0, rejected: 0 },
  createdAt: "2026-11-11T10:00:00.000Z",
  startedAt: "2026-11-11T10:00:01.000Z",
  finishedAt: null,
  error: null,
}

const params = { params: Promise.resolve({ id: "run-1" }) }
const req = (method = "GET") => new Request("http://localhost/api/intake/run-1", { method })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveApiUserId.mockResolvedValue("user-1")
  mocks.getIntakeRun.mockResolvedValue(RUN)
  mocks.cancelIntakeRun.mockResolvedValue({ ...RUN, status: "CANCELLED" })
  mocks.retryIntakeRun.mockResolvedValue({ ...RUN, status: "PENDING" })
  mocks.scheduleIntakeRun.mockResolvedValue(undefined)
})

describe("GET /api/intake/[id]", () => {
  it("rejects an anonymous caller", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)

    const res = await GET(req(), params)

    expect(res.status).toBe(401)
    expect(mocks.getIntakeRun).not.toHaveBeenCalled()
  })

  it("returns the owner's run", async () => {
    const res = await GET(req(), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ run: RUN })
    expect(mocks.getIntakeRun).toHaveBeenCalledWith("user-1", "run-1")
  })

  it("maps a missing or foreign run to 404", async () => {
    mocks.getIntakeRun.mockRejectedValue(new IntakeRunError(404, "Intake run not found"))

    const res = await GET(req(), params)

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("INTAKE_NOT_FOUND")
  })
})

describe("POST /api/intake/[id]/cancel", () => {
  it("rejects an anonymous caller", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)

    const res = await CANCEL(req("POST"), params)

    expect(res.status).toBe(401)
    expect(mocks.cancelIntakeRun).not.toHaveBeenCalled()
  })

  it("returns the cancelled run", async () => {
    const res = await CANCEL(req("POST"), params)

    expect(res.status).toBe(200)
    expect((await res.json()).run.status).toBe("CANCELLED")
    expect(mocks.cancelIntakeRun).toHaveBeenCalledWith("user-1", "run-1")
  })

  it("maps a finished run to 409", async () => {
    mocks.cancelIntakeRun.mockRejectedValue(
      new IntakeRunError(409, "This intake run has already finished.")
    )

    const res = await CANCEL(req("POST"), params)

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("INTAKE_STATE")
  })
})

describe("POST /api/intake/[id]/retry", () => {
  it("rejects an anonymous caller", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)

    const res = await RETRY(req("POST"), params)

    expect(res.status).toBe(401)
  })

  it("returns 202 and schedules only after a successful reset", async () => {
    const res = await RETRY(req("POST"), params)

    expect(res.status).toBe(202)
    expect(mocks.retryIntakeRun).toHaveBeenCalledWith("user-1", "run-1")
    expect(mocks.scheduleIntakeRun).toHaveBeenCalledWith("run-1")
  })

  it("does not schedule when there is nothing to retry", async () => {
    mocks.retryIntakeRun.mockRejectedValue(
      new IntakeRunError(409, "There is no failed source to retry.")
    )

    const res = await RETRY(req("POST"), params)

    expect(res.status).toBe(409)
    expect(mocks.scheduleIntakeRun).not.toHaveBeenCalled()
  })

  it("maps a missing or foreign run to 404", async () => {
    mocks.retryIntakeRun.mockRejectedValue(new IntakeRunError(404, "Intake run not found"))

    const res = await RETRY(req("POST"), params)

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("INTAKE_NOT_FOUND")
    expect(mocks.scheduleIntakeRun).not.toHaveBeenCalled()
  })
})

describe("GET /api/intake/[id]/stream", () => {
  it("rejects an anonymous caller", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)

    const res = await STREAM(req(), params)

    expect(res.status).toBe(401)
  })

  it("maps an unknown run to 404 before opening a stream", async () => {
    mocks.getIntakeRun.mockRejectedValue(new IntakeRunError(404, "Intake run not found"))

    const res = await STREAM(req(), params)

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: "Intake run not found",
      code: "INTAKE_NOT_FOUND",
    })
  })

  it("emits the terminal run as one progress frame and closes", async () => {
    mocks.getIntakeRun.mockResolvedValue({ ...RUN, status: "COMPLETED", finishedAt: "2026-11-11T10:00:09.000Z" })

    const res = await STREAM(req(), params)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expect(body).toContain("event: progress")
    expect(body).toContain('"status":"COMPLETED"')
    expect(body).not.toContain("event: error")
  })
})
