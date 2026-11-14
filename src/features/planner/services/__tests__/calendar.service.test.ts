import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    jobApplication: { findMany: vi.fn() },
    todo: { findMany: vi.fn() },
  },
}))

import { prisma } from "@/shared/lib/prisma"
import { ApplicationStatus } from "@/generated/prisma/enums"
import {
  buildAgenda,
  getUpcomingAgenda,
  type AgendaJobInput,
  type AgendaTodoInput,
} from "../calendar.service"

const from = new Date("2026-07-25T00:00:00.000Z")
const to = new Date("2026-08-24T00:00:00.000Z")
const overdueFrom = new Date("2026-06-25T00:00:00.000Z")

function makeJob(overrides: Partial<AgendaJobInput>): AgendaJobInput {
  return {
    id: "j1",
    status: ApplicationStatus.APPLIED,
    companyName: "Acme Corp",
    jobTitle: "Software Engineer",
    deadline: null,
    interviewDate: null,
    followUpAt: null,
    ...overrides,
  }
}

function makeTodo(overrides: Partial<AgendaTodoInput>): AgendaTodoInput {
  return {
    id: "t1",
    title: "Prep portfolio",
    dueDate: null,
    done: false,
    jobApplicationId: null,
    jobApplication: null,
    ...overrides,
  }
}

describe("buildAgenda", () => {
  it("returns empty for no inputs", () => {
    expect(buildAgenda([], [], from, to)).toEqual([])
  })

  it("tags an interview event with company and title", () => {
    const result = buildAgenda(
      [makeJob({ interviewDate: new Date("2026-07-28T14:00:00.000Z") })],
      [],
      from,
      to
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("interview")
    expect(result[0].company).toBe("Acme Corp")
    expect(result[0].title).toBe("Software Engineer")
    expect(result[0].jobApplicationId).toBe("j1")
  })

  it("tags a deadline event", () => {
    const result = buildAgenda(
      [makeJob({ deadline: new Date("2026-07-30T00:00:00.000Z") })],
      [],
      from,
      to
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("deadline")
  })

  it("tags a follow-up event, same shape as a deadline", () => {
    const result = buildAgenda(
      [makeJob({ followUpAt: new Date("2026-07-31T09:00:00.000Z") })],
      [],
      from,
      to
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("follow-up")
    expect(result[0].key).toBe("follow-up:j1")
    expect(result[0].company).toBe("Acme Corp")
    expect(result[0].title).toBe("Software Engineer")
    expect(result[0].jobApplicationId).toBe("j1")
  })

  it("drops a follow-up outside the window", () => {
    const result = buildAgenda(
      [makeJob({ followUpAt: new Date("2026-09-30T09:00:00.000Z") })],
      [],
      from,
      to
    )
    expect(result).toEqual([])
  })

  it.each([
    ApplicationStatus.INTERESTED,
    ApplicationStatus.OFFER,
    ApplicationStatus.REJECTED,
    ApplicationStatus.WITHDRAWN,
  ])("drops an in-window follow-up on a %s application", (status) => {
    const result = buildAgenda(
      [
        makeJob({
          status,
          followUpAt: new Date("2026-07-31T09:00:00.000Z"),
          interviewDate: new Date("2026-08-02T10:00:00.000Z"),
        }),
      ],
      [],
      from,
      to
    )
    // Only the follow-up is guarded; the interview still shows.
    expect(result.map((item) => item.type)).toEqual(["interview"])
  })

  it("sorts a follow-up in among the other job events", () => {
    const result = buildAgenda(
      [
        makeJob({
          deadline: new Date("2026-08-01T00:00:00.000Z"),
          interviewDate: new Date("2026-07-27T09:00:00.000Z"),
          followUpAt: new Date("2026-07-29T09:00:00.000Z"),
        }),
      ],
      [],
      from,
      to
    )
    expect(result.map((item) => item.type)).toEqual([
      "interview",
      "follow-up",
      "deadline",
    ])
  })

  it("produces two items when a job has both a deadline and an interview", () => {
    const result = buildAgenda(
      [
        makeJob({
          deadline: new Date("2026-08-01T00:00:00.000Z"),
          interviewDate: new Date("2026-07-27T09:00:00.000Z"),
        }),
      ],
      [],
      from,
      to
    )
    expect(result.map((i) => i.type)).toEqual(["interview", "deadline"])
  })

  it("tags a standalone todo with null company and its done flag", () => {
    const result = buildAgenda(
      [],
      [makeTodo({ dueDate: new Date("2026-07-26T00:00:00.000Z"), done: true })],
      from,
      to
    )
    expect(result[0].type).toBe("todo")
    expect(result[0].company).toBeNull()
    expect(result[0].title).toBe("Prep portfolio")
    expect(result[0].done).toBe(true)
    expect(result[0].jobApplicationId).toBeNull()
  })

  it("merges all three types and sorts chronologically", () => {
    const result = buildAgenda(
      [
        makeJob({
          id: "j1",
          deadline: new Date("2026-08-10T00:00:00.000Z"),
          interviewDate: new Date("2026-07-26T10:00:00.000Z"),
        }),
      ],
      [makeTodo({ id: "t1", dueDate: new Date("2026-08-02T00:00:00.000Z") })],
      from,
      to
    )
    expect(result.map((i) => i.type)).toEqual(["interview", "todo", "deadline"])
    const times = result.map((i) => i.date.getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it("excludes events outside the [from, to) window", () => {
    const result = buildAgenda(
      [
        makeJob({ id: "past", interviewDate: new Date("2026-07-01T00:00:00.000Z") }),
        makeJob({ id: "future", deadline: new Date("2026-09-30T00:00:00.000Z") }),
      ],
      [makeTodo({ dueDate: new Date("2026-12-01T00:00:00.000Z") })],
      from,
      to
    )
    expect(result).toEqual([])
  })

  it("carries the company on a job-linked todo and null on a standalone one", () => {
    const result = buildAgenda(
      [],
      [
        makeTodo({
          id: "linked",
          dueDate: new Date("2026-08-02T00:00:00.000Z"),
          jobApplicationId: "j1",
          jobApplication: { job: { companyName: "Sharp Atoms" } },
        }),
        makeTodo({
          id: "standalone",
          dueDate: new Date("2026-08-03T00:00:00.000Z"),
        }),
      ],
      from,
      to
    )
    expect(result.map((i) => i.company)).toEqual(["Sharp Atoms", null])
  })

  it("excludes null dates", () => {
    const result = buildAgenda([makeJob({})], [makeTodo({})], from, to)
    expect(result).toEqual([])
  })
})

describe("buildAgenda overdue items", () => {
  it("ignores past dates entirely when no overdue window is given", () => {
    const result = buildAgenda(
      [makeJob({ followUpAt: new Date("2026-07-01T09:00:00.000Z") })],
      [],
      from,
      to
    )
    expect(result).toEqual([])
  })

  it("tags a past follow-up on a live application as overdue", () => {
    const result = buildAgenda(
      [makeJob({ followUpAt: new Date("2026-07-01T09:00:00.000Z") })],
      [],
      from,
      to,
      overdueFrom
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("follow-up")
    expect(result[0].overdue).toBe(true)
    // The link target the planner row needs.
    expect(result[0].jobApplicationId).toBe("j1")
  })

  it("tags a past deadline on a live application as overdue", () => {
    const result = buildAgenda(
      [makeJob({ deadline: new Date("2026-07-10T00:00:00.000Z") })],
      [],
      from,
      to,
      overdueFrom
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("deadline")
    expect(result[0].overdue).toBe(true)
  })

  it("skips past dates on applications that are no longer live", () => {
    const result = buildAgenda(
      [
        makeJob({
          status: ApplicationStatus.REJECTED,
          followUpAt: new Date("2026-07-01T09:00:00.000Z"),
          deadline: new Date("2026-07-02T00:00:00.000Z"),
        }),
      ],
      [],
      from,
      to,
      overdueFrom
    )
    expect(result).toEqual([])
  })

  it("skips past dates older than the overdue window", () => {
    const result = buildAgenda(
      [makeJob({ followUpAt: new Date("2026-05-01T09:00:00.000Z") })],
      [],
      from,
      to,
      overdueFrom
    )
    expect(result).toEqual([])
  })

  it("sorts overdue items ahead of scheduled ones and leaves those untagged", () => {
    const result = buildAgenda(
      [
        makeJob({ id: "late", followUpAt: new Date("2026-07-01T09:00:00.000Z") }),
        makeJob({
          id: "soon",
          interviewDate: new Date("2026-07-28T09:00:00.000Z"),
        }),
      ],
      [],
      from,
      to,
      overdueFrom
    )
    expect(result.map((item) => item.jobApplicationId)).toEqual(["late", "soon"])
    expect(result[0].overdue).toBe(true)
    expect(result[1].overdue).toBeUndefined()
  })

  it("tags a past, still-open todo as overdue", () => {
    const result = buildAgenda(
      [],
      [makeTodo({ dueDate: new Date("2026-07-20T00:00:00.000Z") })],
      from,
      to,
      overdueFrom
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("todo")
    expect(result[0].overdue).toBe(true)
    expect(result[0].done).toBe(false)
  })

  it("skips a past todo that is already done", () => {
    const result = buildAgenda(
      [],
      [makeTodo({ dueDate: new Date("2026-07-20T00:00:00.000Z"), done: true })],
      from,
      to,
      overdueFrom
    )
    expect(result).toEqual([])
  })

  it("skips an open todo older than the overdue window", () => {
    const result = buildAgenda(
      [],
      [makeTodo({ dueDate: new Date("2026-06-24T00:00:00.000Z") })],
      from,
      to,
      overdueFrom
    )
    expect(result).toEqual([])
  })

  it("does not treat a past interview date as overdue", () => {
    const result = buildAgenda(
      [makeJob({ interviewDate: new Date("2026-07-01T09:00:00.000Z") })],
      [],
      from,
      to,
      overdueFrom
    )
    expect(result).toEqual([])
  })
})

describe("getUpcomingAgenda", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetches both sources, merges, tags, and sorts", async () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    vi.mocked(prisma.jobApplication.findMany).mockResolvedValue([
      {
        id: "j1",
        status: ApplicationStatus.APPLIED,
        interviewDate: new Date(now + 2 * day),
        job: {
          companyName: "Acme Corp",
          title: "Engineer",
          deadline: new Date(now + 10 * day),
        },
      },
    ] as never)
    vi.mocked(prisma.todo.findMany).mockResolvedValue([
      {
        id: "t1",
        title: "Follow up",
        dueDate: new Date(now + 5 * day),
        done: false,
        jobApplicationId: null,
      },
    ] as never)

    const result = await getUpcomingAgenda("user-1")

    expect(prisma.jobApplication.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.todo.findMany).toHaveBeenCalledTimes(1)
    expect(result.map((i) => i.type)).toEqual(["interview", "todo", "deadline"])
    expect(result[0].company).toBe("Acme Corp")
    expect(result[0].title).toBe("Engineer")
    expect(result[1].type).toBe("todo")
  })

  it("returns a past follow-up on a live application, tagged overdue and first", async () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    vi.mocked(prisma.jobApplication.findMany).mockResolvedValue([
      {
        id: "late",
        status: ApplicationStatus.APPLIED,
        interviewDate: null,
        followUpAt: new Date(now - 8 * day),
        job: { companyName: "Sharp Atoms", title: "Engineer", deadline: null },
      },
      {
        id: "soon",
        status: ApplicationStatus.APPLIED,
        interviewDate: new Date(now + 3 * day),
        followUpAt: null,
        job: { companyName: "Acme Corp", title: "Engineer", deadline: null },
      },
    ] as never)
    vi.mocked(prisma.todo.findMany).mockResolvedValue([] as never)

    const result = await getUpcomingAgenda("user-1")

    expect(result.map((item) => item.jobApplicationId)).toEqual(["late", "soon"])
    expect(result[0].type).toBe("follow-up")
    expect(result[0].overdue).toBe(true)
    expect(result[1].overdue).toBeUndefined()
  })

  it("drops a past follow-up once the application is no longer live", async () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    vi.mocked(prisma.jobApplication.findMany).mockResolvedValue([
      {
        id: "dead",
        status: ApplicationStatus.REJECTED,
        interviewDate: null,
        followUpAt: new Date(now - 8 * day),
        job: { companyName: "Sharp Atoms", title: "Engineer", deadline: null },
      },
    ] as never)
    vi.mocked(prisma.todo.findMany).mockResolvedValue([] as never)

    expect(await getUpcomingAgenda("user-1")).toEqual([])
  })

  it("asks for open todos from the lookback window and tags them overdue", async () => {
    const todayStart = new Date("2026-07-25T00:00:00.000Z")
    vi.mocked(prisma.jobApplication.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.todo.findMany).mockResolvedValue([
      {
        id: "late",
        title: "Send portfolio",
        dueDate: new Date("2026-07-20T00:00:00.000Z"),
        done: false,
        jobApplicationId: null,
        jobApplication: null,
      },
    ] as never)

    const result = await getUpcomingAgenda("user-1", todayStart)

    expect(vi.mocked(prisma.todo.findMany).mock.calls[0][0]?.where).toEqual({
      userId: "user-1",
      OR: [
        {
          dueDate: {
            gte: todayStart,
            lt: new Date("2026-08-24T00:00:00.000Z"),
          },
        },
        {
          done: false,
          dueDate: {
            gte: new Date("2026-06-25T00:00:00.000Z"),
            lt: todayStart,
          },
        },
      ],
    })
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("todo")
    expect(result[0].overdue).toBe(true)
  })
})
