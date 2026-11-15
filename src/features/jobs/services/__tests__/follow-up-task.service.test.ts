// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    followUpTask: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
  },
}))

vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import {
  FOLLOW_UP_PLAN,
  followUpDueDate,
  scheduleFollowUpTasks,
} from "../follow-up-task.service"

type Row = Record<string, unknown>

function fakeTx(existing: Row[] = []) {
  const rows = [...existing]
  return {
    rows,
    followUpTask: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        rows.find(
          (row) =>
            row.userId === where.userId &&
            row.jobApplicationId === where.jobApplicationId &&
            row.channel === where.channel
        ) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `task-${data.channel}`,
          status: "PENDING",
          completedAt: null,
          createdAt: new Date("2026-11-12T00:00:00.000Z"),
          updatedAt: new Date("2026-11-12T00:00:00.000Z"),
          ...data,
        }
        rows.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = rows.find((entry) => entry.id === where.id)
        if (!row) throw new Error("not found")
        Object.assign(row, data, { updatedAt: new Date() })
        return row
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const matched = rows.filter(
          (row) =>
            row.userId === where.userId &&
            row.jobApplicationId === where.jobApplicationId &&
            row.status === where.status
        )
        for (const row of matched) Object.assign(row, data)
        return { count: matched.length }
      }),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("followUpDueDate", () => {
  it("counts the two channels in weekdays from the application day", () => {
    const friday = new Date("2026-11-13T00:00:00.000Z")
    expect(followUpDueDate(friday, "EMAIL").toISOString()).toBe(
      "2026-11-20T00:00:00.000Z"
    )
    expect(followUpDueDate(friday, "LINKEDIN").toISOString()).toBe(
      "2026-12-01T00:00:00.000Z"
    )
    expect(FOLLOW_UP_PLAN.map((entry) => entry.channel)).toEqual(["EMAIL", "LINKEDIN"])
  })
})

describe("scheduleFollowUpTasks", () => {
  it("creates one durable task per channel with packed due dates", async () => {
    const tx = fakeTx()
    const tasks = await scheduleFollowUpTasks(tx as never, {
      userId: "user-1",
      jobApplicationId: "app-1",
      appliedOn: new Date("2026-11-13T00:00:00.000Z"),
    })

    expect(tasks).toHaveLength(2)
    expect(tx.rows).toHaveLength(2)
    expect(tx.rows.map((row) => row.channel)).toEqual(["EMAIL", "LINKEDIN"])
    expect((tx.rows[0].dueAt as Date).toISOString()).toBe("2026-11-20T00:00:00.000Z")
    expect((tx.rows[1].dueAt as Date).toISOString()).toBe("2026-12-01T00:00:00.000Z")
  })

  it("does not move a pending task when the confirmation is replayed", async () => {
    const tx = fakeTx()
    await scheduleFollowUpTasks(tx as never, {
      userId: "user-1",
      jobApplicationId: "app-1",
      appliedOn: new Date("2026-11-13T00:00:00.000Z"),
    })
    const originalDue = tx.rows[0].dueAt

    await scheduleFollowUpTasks(tx as never, {
      userId: "user-1",
      jobApplicationId: "app-1",
      appliedOn: new Date("2026-11-20T00:00:00.000Z"),
    })

    expect(tx.followUpTask.create).toHaveBeenCalledTimes(2)
    expect(tx.rows[0].dueAt).toEqual(originalDue)
  })

  it("resets a dismissed reminder when the application is applied again", async () => {
    const tx = fakeTx([
      {
        id: "task-EMAIL",
        userId: "user-1",
        jobApplicationId: "app-1",
        channel: "EMAIL",
        status: "DISMISSED",
        dueAt: new Date("2026-11-20T00:00:00.000Z"),
        completedAt: new Date("2026-11-14T00:00:00.000Z"),
      },
      {
        id: "task-LINKEDIN",
        userId: "user-1",
        jobApplicationId: "app-1",
        channel: "LINKEDIN",
        status: "DISMISSED",
        dueAt: new Date("2026-12-01T00:00:00.000Z"),
        completedAt: new Date("2026-11-14T00:00:00.000Z"),
      },
    ])

    await scheduleFollowUpTasks(tx as never, {
      userId: "user-1",
      jobApplicationId: "app-1",
      appliedOn: new Date("2026-12-04T00:00:00.000Z"),
    })

    expect(tx.rows.map((row) => row.status)).toEqual(["PENDING", "PENDING"])
    expect(tx.rows[0].completedAt).toBeNull()
    expect((tx.rows[0].dueAt as Date).toISOString()).toBe("2026-12-11T00:00:00.000Z")
  })
})
