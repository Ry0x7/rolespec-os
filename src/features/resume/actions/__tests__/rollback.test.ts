// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resumeFindFirst: vi.fn(),
  snapshotFindFirst: vi.fn(),
  transaction: vi.fn(),
  deleteSections: vi.fn(),
  createSection: vi.fn(),
  updateResume: vi.fn(),
  updateSnapshot: vi.fn(),
  createEditEvent: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    resume: { findFirst: mocks.resumeFindFirst },
    resumeSnapshot: { findFirst: mocks.snapshotFindFirst },
    $transaction: mocks.transaction,
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getTailoredResumeDiff, rollbackTailoredResume } from "../rollback"

const TAILORED = {
  id: "tailored-1",
  title: "Acme tailored",
  version: 4,
  sourceResumeId: "source-1",
  jobApplicationId: "app-1",
}

const SNAPSHOT_PAYLOAD = {
  sourceResumeId: "source-1",
  sourceVersion: 2,
  capturedAt: "2026-11-11T00:00:00.000Z",
  title: "Original source",
  template: "MINIMAL",
  targetRole: "Backend Engineer",
  targetCompany: "Acme",
  sections: [
    {
      id: "old-section",
      type: "EXPERIENCE",
      title: "Experience",
      order: 0,
      visible: true,
      items: [
        {
          id: "old-item",
          content: {
            role: "Backend Engineer",
            company: "Acme",
            bullets: ["Original bullet from the captured revision."],
          },
          order: 0,
        },
      ],
    },
  ],
}

const LIVE_SOURCE = {
  id: "source-1",
  sections: [
    {
      type: "EXPERIENCE",
      title: "Experience",
      order: 0,
      visible: true,
      items: [
        {
          content: {
            role: "Backend Engineer",
            company: "Acme",
            bullets: ["A later edit that must NOT be restored."],
          },
          metadata: null,
          order: 0,
        },
      ],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } })
  mocks.resumeFindFirst.mockResolvedValueOnce(TAILORED)
  mocks.snapshotFindFirst.mockResolvedValue({
    id: "snapshot-1",
    sourceVersion: 2,
    payload: SNAPSHOT_PAYLOAD,
  })
  mocks.updateResume.mockResolvedValue({ version: 5 })
  mocks.deleteSections.mockResolvedValue({ count: 1 })
  mocks.createSection.mockResolvedValue({ id: "restored-section" })
  mocks.updateSnapshot.mockResolvedValue({ count: 1 })
  mocks.createEditEvent.mockResolvedValue({ id: "event-1" })
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      resumeSection: {
        deleteMany: mocks.deleteSections,
        create: mocks.createSection,
      },
      resume: { update: mocks.updateResume },
      resumeSnapshot: { updateMany: mocks.updateSnapshot },
      resumeEditEvent: { create: mocks.createEditEvent },
    })
  )
})

describe("rollbackTailoredResume", () => {
  it("restores the captured snapshot, not the source resume's later edits", async () => {
    const result = await rollbackTailoredResume("tailored-1")

    expect(result).toMatchObject({
      success: true,
      restoredFrom: "snapshot",
      snapshotId: "snapshot-1",
      sourceVersion: 2,
    })
    expect(mocks.resumeFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.createSection).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resumeId: "tailored-1",
        items: {
          create: [
            expect.objectContaining({
              content: expect.objectContaining({
                bullets: ["Original bullet from the captured revision."],
              }),
            }),
          ],
        },
      }),
    })
    expect(mocks.createEditEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "ROLLBACK",
        versionBefore: 4,
        versionAfter: 5,
        metadata: expect.objectContaining({
          restoredFrom: "snapshot",
          snapshotId: "snapshot-1",
          sourceVersion: 2,
        }),
      }),
    })
    expect(JSON.stringify(mocks.createSection.mock.calls)).not.toContain(
      "A later edit that must NOT be restored."
    )
  })

  it("can restore a specifically chosen earlier snapshot", async () => {
    const result = await rollbackTailoredResume("tailored-1", "snapshot-0")

    expect(result.success).toBe(true)
    expect(mocks.snapshotFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", resumeId: "tailored-1", id: "snapshot-0" },
      })
    )
  })

  it("falls back to the live source only for legacy resumes, and says so", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(null)
    mocks.resumeFindFirst.mockReset()
    mocks.resumeFindFirst.mockResolvedValueOnce(TAILORED).mockResolvedValueOnce(LIVE_SOURCE)

    const result = await rollbackTailoredResume("tailored-1")

    expect(result).toMatchObject({ success: true, restoredFrom: "live-source" })
    expect(mocks.createSection).toHaveBeenCalledWith({
      data: expect.objectContaining({
        items: {
          create: [
            expect.objectContaining({
              content: expect.objectContaining({
                bullets: ["A later edit that must NOT be restored."],
              }),
            }),
          ],
        },
      }),
    })
    expect(mocks.createEditEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "ROLLBACK",
        summary: expect.stringContaining("legacy"),
      }),
    })
  })

  it("refuses a foreign or missing tailored resume before writing", async () => {
    mocks.resumeFindFirst.mockReset()
    mocks.resumeFindFirst.mockResolvedValue(null)

    const result = await rollbackTailoredResume("foreign")

    expect(result.success).toBe(false)
    expect(mocks.snapshotFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("getTailoredResumeDiff", () => {
  it("compares against the captured source revision, not later source edits", async () => {
    mocks.resumeFindFirst.mockReset()
    mocks.resumeFindFirst.mockResolvedValueOnce({
      id: "tailored-1",
      title: "Acme tailored",
      sourceResumeId: "source-1",
      sections: [
        {
          type: "EXPERIENCE",
          title: "Experience",
          items: [
            {
              content: {
                role: "Backend Engineer",
                company: "Acme",
                bullets: ["Built the original API."],
              },
            },
          ],
        },
      ],
    })

    const result = await getTailoredResumeDiff("tailored-1")

    expect(result).toMatchObject({
      success: true,
      comparedAgainst: "snapshot",
      sourceVersion: 2,
    })
    if (!result.success) return
    expect(JSON.stringify(result.diff)).toContain("Original bullet from the captured revision.")
    expect(JSON.stringify(result.diff)).not.toContain(
      "A later edit that must NOT be restored."
    )
    // One resume read (the tailored copy); the snapshot supplied the other side.
    expect(mocks.resumeFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.snapshotFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", resumeId: "tailored-1" },
        orderBy: { capturedAt: "desc" },
      })
    )
  })
})
