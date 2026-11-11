// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resumeFindFirst: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: { resume: { findFirst: mocks.resumeFindFirst } },
}))

import { getResumeHistory } from "../history"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } })
})

describe("getResumeHistory", () => {
  it("requires a session before reading any resume", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(getResumeHistory("resume-1")).resolves.toEqual({
      error: "Authentication required",
    })
    expect(mocks.resumeFindFirst).not.toHaveBeenCalled()
  })

  it("returns provenance for an owned resume without selecting snapshot payloads", async () => {
    mocks.resumeFindFirst.mockResolvedValue({
      id: "resume-1",
      version: 5,
      editEvents: [
        {
          id: "event-1",
          kind: "ROLLBACK",
          versionBefore: 4,
          versionAfter: 5,
          summary: "Restored source revision 2",
          createdAt: new Date("2026-11-11T00:00:00.000Z"),
        },
      ],
      snapshots: [
        {
          id: "snapshot-1",
          sourceResumeId: "source-1",
          sourceVersion: 2,
          hash: "hash-1",
          capturedAt: new Date("2026-11-10T00:00:00.000Z"),
          restoredAt: new Date("2026-11-11T00:00:00.000Z"),
          restoreCount: 1,
        },
      ],
      validations: [
        {
          id: "validation-1",
          status: "PASS",
          sourceHash: "hash-1",
          report: { status: "PASS", claims: [], issues: [] },
          createdAt: new Date("2026-11-10T00:00:00.000Z"),
        },
      ],
      tailoringRuns: [
        {
          id: "run-1",
          status: "COMPLETED",
          mode: "WORKFLOW",
          attempts: 2,
          requirementMap: [{ id: "req-1", verdict: "SUPPORTED" }],
          createdAt: new Date("2026-11-10T00:00:00.000Z"),
        },
      ],
    })

    const result = await getResumeHistory("resume-1")

    expect(result).toMatchObject({
      data: {
        resumeId: "resume-1",
        version: 5,
        snapshots: [{ id: "snapshot-1", sourceVersion: 2, restoreCount: 1 }],
        latestValidation: { status: "PASS" },
        tailoring: { status: "COMPLETED", mode: "WORKFLOW", attempts: 2 },
        requirements: [{ id: "req-1", verdict: "SUPPORTED" }],
      },
    })
    if ("error" in result) return
    expect(result.data.snapshots[0]).not.toHaveProperty("payload")
    expect(result.data.editEvents[0].createdAt).toBe("2026-11-11T00:00:00.000Z")

    const query = mocks.resumeFindFirst.mock.calls[0][0]
    expect(query.where).toEqual({
      id: "resume-1",
      userId: "user-1",
      status: { not: "ARCHIVED" },
    })
    expect(query.select.snapshots.select).not.toHaveProperty("payload")
  })

  it("treats a foreign or archived resume as not found", async () => {
    mocks.resumeFindFirst.mockResolvedValue(null)

    await expect(getResumeHistory("foreign")).resolves.toEqual({
      error: "Resume not found",
    })
  })
})
