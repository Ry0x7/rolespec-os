import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    applicationStatusEvent: { findMany: mocks.findMany },
  },
}))

import {
  getApplicationStatusHistory,
  recordStatusTransition,
  type StatusEventWriter,
} from "../application-status.service"

function writer() {
  return { applicationStatusEvent: { create: vi.fn().mockResolvedValue({}) } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findMany.mockResolvedValue([])
})

describe("recordStatusTransition", () => {
  it("does not write an event when the status did not move", async () => {
    const db = writer()

    await expect(
      recordStatusTransition(db as unknown as StatusEventWriter, {
        jobApplicationId: "app-1",
        fromStatus: "APPLIED",
        toStatus: "APPLIED",
      })
    ).resolves.toBe(false)

    expect(db.applicationStatusEvent.create).not.toHaveBeenCalled()
  })

  it("records a starting point with no predecessor", async () => {
    const db = writer()

    await expect(
      recordStatusTransition(db as unknown as StatusEventWriter, {
        jobApplicationId: "app-1",
        fromStatus: null,
        toStatus: "INTERESTED",
      })
    ).resolves.toBe(true)

    expect(db.applicationStatusEvent.create).toHaveBeenCalledWith({
      data: {
        jobApplicationId: "app-1",
        fromStatus: null,
        toStatus: "INTERESTED",
        note: null,
        source: "USER",
      },
    })
  })

  it("records a real move with a trimmed note and the caller's source", async () => {
    const db = writer()

    await recordStatusTransition(db as unknown as StatusEventWriter, {
      jobApplicationId: "app-1",
      fromStatus: "APPLIED",
      toStatus: "INTERVIEW",
      note: "  Recruiter call booked  ",
      source: "EXTENSION",
    })

    expect(db.applicationStatusEvent.create).toHaveBeenCalledWith({
      data: {
        jobApplicationId: "app-1",
        fromStatus: "APPLIED",
        toStatus: "INTERVIEW",
        note: "Recruiter call booked",
        source: "EXTENSION",
      },
    })
  })

  it("clears a whitespace-only note and caps an oversized one", async () => {
    const blank = writer()
    await recordStatusTransition(blank as unknown as StatusEventWriter, {
      jobApplicationId: "app-1",
      fromStatus: "APPLIED",
      toStatus: "SCREENING",
      note: "   ",
    })
    expect(blank.applicationStatusEvent.create.mock.calls[0][0].data.note).toBeNull()

    const long = writer()
    await recordStatusTransition(long as unknown as StatusEventWriter, {
      jobApplicationId: "app-1",
      fromStatus: "APPLIED",
      toStatus: "SCREENING",
      note: "x".repeat(2500),
    })
    expect(long.applicationStatusEvent.create.mock.calls[0][0].data.note).toHaveLength(2000)
  })
})

describe("getApplicationStatusHistory", () => {
  it("reads oldest first and scopes the join to the owner", async () => {
    const events = [
      {
        id: "evt-1",
        fromStatus: null,
        toStatus: "INTERESTED",
        note: null,
        source: "MIGRATION",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    ]
    mocks.findMany.mockResolvedValue(events)

    await expect(getApplicationStatusHistory("user-1", "app-1")).resolves.toEqual({
      events,
    })

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        jobApplicationId: "app-1",
        jobApplication: { userId: "user-1" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        source: true,
        createdAt: true,
      },
    })
  })

  it("returns an empty history when the application is foreign or missing", async () => {
    await expect(getApplicationStatusHistory("user-2", "app-1")).resolves.toEqual({
      events: [],
    })
  })
})
