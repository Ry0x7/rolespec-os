// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveApiUserId: vi.fn(),
  logActivityEvent: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  createEvent: vi.fn(),
}))

vi.mock("@/features/auth/api-auth", () => ({
  resolveApiUserId: mocks.resolveApiUserId,
  logActivityEvent: mocks.logActivityEvent,
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    jobApplication: { findFirst: mocks.findFirst },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        jobApplication: { update: mocks.update },
        applicationStatusEvent: { create: mocks.createEvent },
      }),
  },
}))

import { PATCH } from "../route"

const EXISTING = {
  id: "app-1",
  status: "APPLIED",
  job: { title: "Backend Engineer", companyName: "Acme" },
}

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/applications/app-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "app-1" }) }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveApiUserId.mockResolvedValue("user-1")
  mocks.logActivityEvent.mockResolvedValue(undefined)
  mocks.findFirst.mockResolvedValue(EXISTING)
  mocks.update.mockResolvedValue({ id: "app-1", status: "INTERVIEW" })
  mocks.createEvent.mockResolvedValue({})
})

describe("PATCH /api/applications/[id] — status history", () => {
  it("records one event for a real transition, with the outcome note", async () => {
    const res = await patch({
      status: "INTERVIEW",
      outcomeNote: "Recruiter call booked.",
    })

    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.createEvent).toHaveBeenCalledTimes(1)
    expect(mocks.createEvent.mock.calls[0][0]).toEqual({
      data: {
        jobApplicationId: "app-1",
        fromStatus: "APPLIED",
        toStatus: "INTERVIEW",
        note: "Recruiter call booked.",
        source: "USER",
      },
    })
  })

  it("does not record an event when the save does not move the status", async () => {
    mocks.update.mockResolvedValue({ id: "app-1", status: "APPLIED" })

    const res = await patch({ status: "APPLIED" })

    expect(res.status).toBe(200)
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it("does not record a status event for a notes-only edit", async () => {
    const res = await patch({ notes: "Met the hiring manager at a meetup." })

    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it("still returns 404 without recording when the application is not the caller's", async () => {
    mocks.findFirst.mockResolvedValue(null)

    const res = await patch({ status: "INTERVIEW" })

    expect(res.status).toBe(404)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })
})
