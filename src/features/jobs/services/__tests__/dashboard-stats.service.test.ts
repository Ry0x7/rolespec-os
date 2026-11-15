// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    jobApplication: {
      count: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    todo: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import { getJobsDashboardStats } from "../dashboard-stats.service"

const NOW = new Date("2026-08-14T09:30:00.000Z")
const USER_ID = "user-1"

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)

  mockPrisma.jobApplication.count.mockResolvedValue(2)
  mockPrisma.jobApplication.groupBy.mockResolvedValue([])
  // upcoming rows, then recent applications
  mockPrisma.jobApplication.findMany.mockResolvedValue([])
  mockPrisma.todo.findMany.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe("getJobsDashboardStats status counts", () => {
  it("groups the caller's applications by status", async () => {
    await getJobsDashboardStats(USER_ID)

    expect(mockPrisma.jobApplication.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { userId: USER_ID },
      _count: { _all: true },
    })
  })

  it("zero-fills every status the user has none of, in pipeline order", async () => {
    mockPrisma.jobApplication.groupBy.mockResolvedValue([
      { status: "APPLIED", _count: { _all: 3 } },
      { status: "OFFER", _count: { _all: 1 } },
    ])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.statusCounts).toEqual([
      { status: "INTERESTED", count: 0 },
      { status: "APPLIED", count: 3 },
      { status: "SCREENING", count: 0 },
      { status: "INTERVIEW", count: 0 },
      { status: "OFFER", count: 1 },
      { status: "REJECTED", count: 0 },
      { status: "WITHDRAWN", count: 0 },
    ])
  })

  it("returns all-zero counts for a user with no applications", async () => {
    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.statusCounts).toHaveLength(7)
    expect(stats.statusCounts.every((row) => row.count === 0)).toBe(true)
  })

  it("still returns the other dashboard fields", async () => {
    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.appliedToday).toBe(2)
    expect(stats.upcomingEvents).toEqual([])
    expect(stats.recentApplications).toEqual([])
  })
})

describe("getJobsDashboardStats posting fields", () => {
  it("reads company and title off the job relation", async () => {
    // Call order inside the Promise.all: upcoming rows, then recent rows.
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        {
          id: "app-1",
          status: "APPLIED",
          interviewDate: new Date("2026-08-16T13:00:00.000Z"),
          job: {
            companyName: "Acme Corp",
            title: "Software Engineer",
            deadline: new Date("2026-08-18T00:00:00.000Z"),
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "app-2",
          status: "INTERESTED",
          createdAt: new Date("2026-08-13T10:00:00.000Z"),
          job: { companyName: "Globex", title: "Data Analyst" },
        },
      ])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.upcomingEvents).toEqual([
      {
        id: "app-1",
        title: "Acme Corp",
        subtitle: "Software Engineer",
        status: "APPLIED",
        date: new Date("2026-08-16T13:00:00.000Z"),
        type: "interview",
        href: "/jobs/app-1",
      },
      {
        id: "app-1",
        title: "Acme Corp",
        subtitle: "Software Engineer",
        status: "APPLIED",
        date: new Date("2026-08-18T00:00:00.000Z"),
        type: "deadline",
        href: "/jobs/app-1",
      },
    ])
    expect(stats.recentApplications).toEqual([
      {
        id: "app-2",
        companyName: "Globex",
        jobTitle: "Data Analyst",
        status: "INTERESTED",
        createdAt: new Date("2026-08-13T10:00:00.000Z"),
      },
    ])
  })

  it("filters the deadline window through the job relation", async () => {
    await getJobsDashboardStats(USER_ID)

    const upcomingArgs = mockPrisma.jobApplication.findMany.mock.calls[0][0]
    expect(upcomingArgs.where.OR).toEqual([
      { interviewDate: { gte: expect.any(Date), lt: expect.any(Date) } },
      { job: { deadline: { gte: expect.any(Date), lt: expect.any(Date) } } },
      {
        status: { in: ["APPLIED", "SCREENING", "INTERVIEW"] },
        followUpAt: { gte: expect.any(Date), lt: expect.any(Date) },
      },
    ])
  })
})

describe("getJobsDashboardStats upcoming window", () => {
  /** `NOW` is 2026-08-14, so day +7 is 2026-08-21. */
  function upcomingRow(overrides: Record<string, unknown>) {
    return {
      id: "app-1",
      status: "APPLIED",
      interviewDate: null,
      followUpAt: null,
      job: { companyName: "Acme Corp", title: "Engineer", deadline: null },
      ...overrides,
    }
  }

  it("queries a window that runs to the end of the seventh day", async () => {
    await getJobsDashboardStats(USER_ID)

    const where = mockPrisma.jobApplication.findMany.mock.calls[0][0].where
    expect(where.OR[0].interviewDate.gte).toEqual(
      new Date("2026-08-14T00:00:00.000Z"),
    )
    // Exclusive: everything dated 2026-08-21 is still inside.
    expect(where.OR[0].interviewDate.lt).toEqual(
      new Date("2026-08-22T00:00:00.000Z"),
    )
  })

  it("includes an interview dated exactly seven days out", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        upcomingRow({ interviewDate: new Date("2026-08-21T13:00:00.000Z") }),
      ])
      .mockResolvedValueOnce([])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.upcomingEvents.map((event) => event.type)).toEqual(["interview"])
  })

  it("includes a deadline dated exactly seven days out", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        upcomingRow({
          job: {
            companyName: "Acme Corp",
            title: "Engineer",
            deadline: new Date("2026-08-21T00:00:00.000Z"),
          },
        }),
      ])
      .mockResolvedValueOnce([])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.upcomingEvents.map((event) => event.type)).toEqual(["deadline"])
  })

  it("frames the window on the caller's day, not the server's UTC day", async () => {
    // 07:00 on 9 Sep for a UTC+8 user; the server instant is still 8 Sep.
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))
    const userToday = new Date("2026-09-09T00:00:00.000Z")

    await getJobsDashboardStats(USER_ID, userToday)

    const appliedTodayWhere = mockPrisma.jobApplication.count.mock.calls[0][0].where
    expect(appliedTodayWhere.dateApplied).toEqual({
      gte: userToday,
      lt: new Date("2026-09-10T00:00:00.000Z"),
    })
  })

  it("includes a follow-up seven of the user's own days out", async () => {
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        upcomingRow({ followUpAt: new Date("2026-09-16T00:00:00.000Z") }),
      ])
      .mockResolvedValueOnce([])

    const stats = await getJobsDashboardStats(
      USER_ID,
      new Date("2026-09-09T00:00:00.000Z"),
    )

    expect(stats.upcomingEvents.map((event) => event.type)).toEqual(["follow-up"])
  })

  it("excludes an interview one day past the window", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        upcomingRow({ interviewDate: new Date("2026-08-22T00:00:00.000Z") }),
      ])
      .mockResolvedValueOnce([])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.upcomingEvents).toEqual([])
  })
})

describe("getJobsDashboardStats follow-up events", () => {
  it("lists a scheduled follow-up on a live application as its own event", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        {
          id: "app-1",
          status: "APPLIED",
          interviewDate: null,
          followUpAt: new Date("2026-08-21T00:00:00.000Z"),
          job: { companyName: "Sharp Atoms", title: "Engineer", deadline: null },
        },
      ])
      .mockResolvedValueOnce([])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.upcomingEvents).toEqual([
      {
        id: "app-1",
        title: "Sharp Atoms",
        subtitle: "Engineer",
        status: "APPLIED",
        date: new Date("2026-08-21T00:00:00.000Z"),
        type: "follow-up",
        href: "/jobs/app-1",
      },
    ])
  })

  it("ignores a follow-up on an application that is already closed", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        {
          id: "app-1",
          status: "REJECTED",
          interviewDate: null,
          followUpAt: new Date("2026-08-16T00:00:00.000Z"),
          job: { companyName: "Sharp Atoms", title: "Engineer", deadline: null },
        },
      ])
      .mockResolvedValueOnce([])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.upcomingEvents).toEqual([])
  })
})

describe("getJobsDashboardStats todo events", () => {
  it("queries only open todos due inside the same window", async () => {
    await getJobsDashboardStats(USER_ID)

    expect(mockPrisma.todo.findMany.mock.calls[0][0].where).toEqual({
      userId: USER_ID,
      done: false,
      dueDate: {
        gte: new Date("2026-08-14T00:00:00.000Z"),
        // Exclusive: everything dated 2026-08-21 is still inside.
        lt: new Date("2026-08-22T00:00:00.000Z"),
      },
    })
  })

  it("lists a todo linked to a job with that job's company and link", async () => {
    mockPrisma.todo.findMany.mockResolvedValue([
      {
        id: "todo-1",
        title: "Send the take-home",
        dueDate: new Date("2026-08-15T00:00:00.000Z"),
        jobApplicationId: "app-1",
        jobApplication: { job: { companyName: "Acme Corp" } },
      },
    ])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.upcomingEvents).toEqual([
      {
        id: "todo-1",
        title: "Send the take-home",
        subtitle: "Acme Corp",
        status: null,
        date: new Date("2026-08-15T00:00:00.000Z"),
        type: "todo",
        href: "/jobs/app-1",
      },
    ])
  })

  it("sends a standalone todo to the planner and carries no company", async () => {
    mockPrisma.todo.findMany.mockResolvedValue([
      {
        id: "todo-2",
        title: "Update the portfolio",
        dueDate: new Date("2026-08-16T00:00:00.000Z"),
        jobApplicationId: null,
        jobApplication: null,
      },
    ])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.upcomingEvents).toEqual([
      {
        id: "todo-2",
        title: "Update the portfolio",
        subtitle: null,
        status: null,
        date: new Date("2026-08-16T00:00:00.000Z"),
        type: "todo",
        href: "/planner",
      },
    ])
  })

  it("sorts todos into the same chronological list as job events", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        {
          id: "app-1",
          status: "APPLIED",
          interviewDate: new Date("2026-08-18T13:00:00.000Z"),
          followUpAt: null,
          job: { companyName: "Acme Corp", title: "Engineer", deadline: null },
        },
      ])
      .mockResolvedValueOnce([])
    mockPrisma.todo.findMany.mockResolvedValue([
      {
        id: "todo-1",
        title: "Send the take-home",
        dueDate: new Date("2026-08-15T00:00:00.000Z"),
        jobApplicationId: "app-1",
        jobApplication: { job: { companyName: "Acme Corp" } },
      },
    ])

    const stats = await getJobsDashboardStats(USER_ID)

    expect(stats.upcomingEvents.map((event) => event.type)).toEqual([
      "todo",
      "interview",
    ])
  })
})

describe("getJobsDashboardStats due-today follow-ups", () => {
  // 01:00 on 1 Oct for a UTC+8 user; the server instant is still 30 Sep.
  const USER_TODAY = new Date("2026-10-01T00:00:00.000Z")
  const USER_TOMORROW = new Date("2026-10-02T00:00:00.000Z")

  function followUpRow(id: string, followUpAt: Date) {
    return {
      id,
      status: "APPLIED",
      interviewDate: null,
      followUpAt,
      job: { companyName: `Company ${id}`, title: "Engineer", deadline: null },
    }
  }

  beforeEach(() => {
    vi.setSystemTime(new Date("2026-09-30T17:00:00.000Z"))
  })

  it("counts follow-ups as due through the end of the user's today", async () => {
    await getJobsDashboardStats(USER_ID, USER_TODAY)

    // Call order inside the Promise.all: applied today, then follow-up due.
    const dueWhere = mockPrisma.jobApplication.count.mock.calls[1][0].where
    expect(dueWhere).toEqual({
      userId: USER_ID,
      status: { in: ["APPLIED", "SCREENING", "INTERVIEW"] },
      followUpAt: { lt: USER_TOMORROW },
    })
    // A follow-up dated today exactly and a past one both fall inside;
    // tomorrow's does not.
    const due = (date: Date) => date < dueWhere.followUpAt.lt
    expect(due(USER_TODAY)).toBe(true)
    expect(due(new Date("2026-09-28T00:00:00.000Z"))).toBe(true)
    expect(due(USER_TOMORROW)).toBe(false)
  })

  it("starts upcoming follow-ups at tomorrow so a due one is not listed twice", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        followUpRow("today", USER_TODAY),
        followUpRow("tomorrow", USER_TOMORROW),
      ])
      .mockResolvedValueOnce([])

    const stats = await getJobsDashboardStats(USER_ID, USER_TODAY)

    const where = mockPrisma.jobApplication.findMany.mock.calls[0][0].where
    expect(where.OR[2].followUpAt).toEqual({
      gte: USER_TOMORROW,
      lt: new Date("2026-10-09T00:00:00.000Z"),
    })
    expect(stats.upcomingEvents.map((event) => [event.id, event.type])).toEqual([
      ["tomorrow", "follow-up"],
    ])
  })
})
