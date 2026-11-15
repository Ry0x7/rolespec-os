import { describe, it, expect, vi } from "vitest"

// The ranking rule under test is pure, but the module also owns the query, so
// the client is stubbed rather than constructed.
vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))

import { prisma } from "@/shared/lib/prisma"
import { assessOpportunityConfidence } from "@/features/discovery/services/opportunity-confidence.service"
import { STRONG_FIT_NEXT_STEP } from "../application-next-step.service"
import {
  decideReason,
  getDashboardAttention,
  rankDecideQueue,
  type DecideCandidate,
} from "../dashboard-attention.service"

/** A snapshot the defensive parser accepts, with the verdict under test. */
function snapshot(
  verdict: string,
  nextAction = "Do the thing.",
  riskLevel: string | null = null,
) {
  return {
    verdict,
    nextAction,
    checkedAt: "2026-01-02T03:04:05.000Z",
    worthIt: { signal: "NEUTRAL", reasons: [] },
    eligible: { signal: "NEUTRAL", reasons: [] },
    match: { signal: "GOOD", reasons: [], matched: [], confirmedCount: 0 },
    risk: { signal: "NEUTRAL", reasons: [], level: riskLevel },
  }
}

function candidate(
  id: string,
  qualification: unknown,
  createdAt = "2026-01-01T00:00:00.000Z",
): DecideCandidate {
  return {
    id,
    companyName: `Company ${id}`,
    jobTitle: `Title ${id}`,
    createdAt: new Date(createdAt),
    qualification,
  }
}

describe("decideReason", () => {
  it("gives a distinct decision-phase line for every verdict and for none", () => {
    const lines = [
      decideReason("STRONG"),
      decideReason("WORTH_A_LOOK"),
      decideReason("WEAK"),
      decideReason("BLOCKED"),
      decideReason(null),
    ]

    expect(new Set(lines).size).toBe(5)
    expect(lines.every((line) => line.length > 0)).toBe(true)
  })

  it("does not use discovery-phase save wording", () => {
    for (const verdict of ["STRONG", "WORTH_A_LOOK", "WEAK", "BLOCKED", null] as const) {
      expect(decideReason(verdict).toLowerCase()).not.toContain("save it")
    }
  })

  it("claims no fit the verdict does not state", () => {
    // The same sentence `describeNextStep` gives a saved STRONG job, so the
    // dashboard, the tracker and the job page never word this state three ways.
    expect(decideReason("STRONG")).toBe("Strong fit — prepare and apply")
    expect(decideReason("STRONG")).toBe(STRONG_FIT_NEXT_STEP)
    expect(decideReason("WORTH_A_LOOK")).toBe(
      "Worth a look — review the posting and decide",
    )
    expect(decideReason("WEAK")).toBe(
      "Weak fit — check whether it is still worth applying",
    )
    expect(decideReason("BLOCKED")).toBe(
      "Ruled out on your criteria — drop it unless the posting was wrong",
    )
    expect(decideReason(null)).toBe("Not assessed — open it and judge for yourself")
  })

  it("puts the risk warning ahead of every verdict line when risk is HIGH", () => {
    const expected =
      "High scam-signal risk — verify the company independently before spending time on it"

    for (const verdict of ["STRONG", "WORTH_A_LOOK", "WEAK", "BLOCKED", null] as const) {
      expect(decideReason(verdict, "HIGH")).toBe(expected)
    }
  })

  it("keeps the verdict line for every risk level below HIGH", () => {
    for (const verdict of ["STRONG", "WORTH_A_LOOK", "WEAK", "BLOCKED", null] as const) {
      for (const level of ["LOW", "MEDIUM", null] as const) {
        expect(decideReason(verdict, level)).toBe(decideReason(verdict))
      }
    }
  })
})

describe("rankDecideQueue", () => {
  it("orders strongest verdict first", () => {
    const ranked = rankDecideQueue(
      [
        candidate("weak", snapshot("WEAK")),
        candidate("blocked", snapshot("BLOCKED")),
        candidate("strong", snapshot("STRONG")),
        candidate("look", snapshot("WORTH_A_LOOK")),
      ],
      4,
    )

    expect(ranked.map((row) => row.id)).toEqual([
      "strong",
      "look",
      "weak",
      "blocked",
    ])
  })

  it("breaks ties on the same verdict by newest first", () => {
    const ranked = rankDecideQueue(
      [
        candidate("older", snapshot("STRONG"), "2026-01-01T00:00:00.000Z"),
        candidate("newer", snapshot("STRONG"), "2026-03-01T00:00:00.000Z"),
      ],
      2,
    )

    expect(ranked.map((row) => row.id)).toEqual(["newer", "older"])
  })

  it("takes the top three by default", () => {
    const ranked = rankDecideQueue([
      candidate("a", snapshot("STRONG")),
      candidate("b", snapshot("STRONG")),
      candidate("c", snapshot("STRONG")),
      candidate("d", snapshot("STRONG")),
    ])

    expect(ranked).toHaveLength(3)
  })

  it("uses the decision-phase line for the verdict, not the snapshot's next action", () => {
    const [row] = rankDecideQueue([
      candidate("a", snapshot("STRONG", "Save it and tailor a resume.")),
    ])

    expect(row.verdict).toBe("STRONG")
    expect(row.reason).toBe(decideReason("STRONG"))
    expect(row.reason).not.toContain("Save it")
    expect(row.companyName).toBe("Company a")
    expect(row.jobTitle).toBe("Title a")
  })

  it("reports the risk, not the fit, for a HIGH-risk snapshot", () => {
    const [row] = rankDecideQueue([
      candidate("a", snapshot("WORTH_A_LOOK", "Do the thing.", "HIGH")),
    ])

    expect(row.verdict).toBe("WORTH_A_LOOK")
    expect(row.reason).toBe(decideReason("WORTH_A_LOOK", "HIGH"))
    expect(row.reason).not.toBe(decideReason("WORTH_A_LOOK"))
  })

  it("leaves the verdict line alone for a MEDIUM-risk snapshot", () => {
    const [row] = rankDecideQueue([
      candidate("a", snapshot("STRONG", "Do the thing.", "MEDIUM")),
    ])

    expect(row.reason).toBe(decideReason("STRONG"))
  })

  it("treats a null column as no verdict rather than crashing", () => {
    const [row] = rankDecideQueue([candidate("a", null)])

    expect(row.verdict).toBeNull()
    expect(row.reason).toBe(decideReason(null))
  })

  it("treats unparseable JSON as no verdict", () => {
    const [row] = rankDecideQueue([
      candidate("a", { verdict: "MAYBE", nextAction: 7 }),
    ])

    expect(row.verdict).toBeNull()
  })

  it("sorts no-verdict rows last but never drops them", () => {
    const ranked = rankDecideQueue(
      [
        candidate("none", null),
        candidate("blocked", snapshot("BLOCKED")),
        candidate("strong", snapshot("STRONG")),
      ],
      3,
    )

    expect(ranked.map((row) => row.id)).toEqual(["strong", "blocked", "none"])
  })

  it("reports the posting-side confidence alongside the verdict", () => {
    const [row] = rankDecideQueue([
      {
        ...candidate("a", snapshot("STRONG")),
        sourceProvider: "greenhouse",
        source: "DISCOVERY",
        url: "https://boards.greenhouse.io/acme/jobs/1",
        postedAt: new Date(Date.now() - 2 * 86_400_000),
      },
    ])

    expect(row.confidence.level).toBe("HIGH")
    expect(row.confidence.summary).toContain("Official ATS board")
    // Fit and confidence stay separate answers.
    expect(row.verdict).toBe("STRONG")
  })

  it("says the source is unknown when the row carries no provider or URL", () => {
    const [row] = rankDecideQueue([
      {
        id: "a",
        companyName: "Acme",
        jobTitle: "Dev",
        createdAt: new Date(),
        qualification: snapshot("STRONG"),
        // No provider, no URL, and a createdAt of "now" is not a posting date
        // signal in itself — but it is still a date, so this is not UNKNOWN.
      },
    ])

    expect(row.confidence.level).toBe("MEDIUM")
    expect(row.confidence.summary).toContain("Source unknown")
  })

  it("demotes a LOW-confidence row below MEDIUM and UNKNOWN in the same verdict", () => {
    const base = (id: string) => ({
      ...candidate(id, snapshot("STRONG"), "2026-01-01T00:00:00.000Z"),
    })
    const ranked = rankDecideQueue(
      [
        // Stale, unsourced, undisclosed: LOW, and the newest of the three.
        {
          ...base("low"),
          companyName: "Confidential",
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          postedAt: new Date("2020-01-01T00:00:00.000Z"),
          url: "https://remotive.com/x",
        },
        {
          ...base("medium"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          postedAt: new Date(Date.now() - 3 * 86_400_000),
          url: "https://remotive.com/x",
        },
      ],
      2,
    )

    expect(ranked.map((row) => row.confidence.level)).toEqual(["MEDIUM", "LOW"])
    // Newest-first would have put "low" on top; confidence demoted it.
    expect(ranked.map((row) => row.id)).toEqual(["medium", "low"])
  })

  it("never reorders across verdicts on confidence", () => {
    const ranked = rankDecideQueue(
      [
        {
          ...candidate("weakButConfident", snapshot("WEAK")),
          sourceProvider: "greenhouse",
          url: "https://boards.greenhouse.io/acme/jobs/1",
          postedAt: new Date(Date.now() - 86_400_000),
        },
        {
          ...candidate("strongButThin", snapshot("STRONG")),
          companyName: "Undisclosed",
          url: "https://remotive.com/x",
          postedAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      ],
      2,
    )

    expect(ranked.map((row) => row.id)).toEqual(["strongButThin", "weakButConfident"])
    expect(ranked[0].confidence.level).toBe("LOW")
  })

  it("counts the posting length when the caller loaded it", () => {
    const base = {
      ...candidate("a", snapshot("STRONG")),
      sourceProvider: "greenhouse",
      url: "https://boards.greenhouse.io/acme/jobs/1",
      postedAt: new Date("2026-01-01T00:00:00.000Z"),
    }

    const withoutBody = rankDecideQueue([base])[0]
    const withBody = rankDecideQueue([{ ...base, descriptionLength: 2_000 }])[0]

    expect(withoutBody.confidence.summary).not.toContain("detailed posting")
    expect(withBody.confidence.summary).toContain("detailed posting")
  })

  it("returns nothing when there is nothing to decide on", () => {
    expect(rankDecideQueue([])).toEqual([])
  })
})

describe("getDashboardAttention decide queue", () => {
  it("does not cut a row the posting length lifts out of LOW before re-scoring it", async () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000)
    // All four are STRONG job-board listings from named employers.
    const row = (id: string, savedDaysAgo: number, postedDaysAgo: number) => ({
      id,
      createdAt: daysAgo(savedDaysAgo),
      job: {
        companyName: `Company ${id}`,
        title: `Title ${id}`,
        qualification: snapshot("STRONG"),
        sourceProvider: null,
        source: null,
        url: `https://remotive.com/${id}`,
        postedAt: daysAgo(postedDaysAgo),
        discoveredAt: null,
      },
    })
    const decideRows = [
      // Fresh posting: MEDIUM with or without a body.
      row("newest", 10, 5),
      // Posted 60 days ago: LOW without the body, MEDIUM once "detailed
      // posting" is counted — and newer than the two below.
      row("detailed", 16, 60),
      row("older1", 21, 5),
      row("older2", 22, 5),
    ]
    const bodyLength: Record<string, number> = {
      newest: 300,
      detailed: 2_000,
      older1: 300,
      older2: 300,
    }

    Object.assign(prisma, {
      jobApplication: {
        count: vi.fn().mockResolvedValue(decideRows.length),
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
          const where = args.where
          if (where.id) {
            const ids = (where.id as { in: string[] }).in
            return ids.map((id) => ({
              id,
              job: { description: "x".repeat(bodyLength[id]) },
            }))
          }
          if (where.status === "INTERESTED") return decideRows
          return []
        }),
      },
    })

    const { decideQueue } = await getDashboardAttention("user-1")

    expect(decideQueue.map((item) => item.id)).toEqual([
      "newest",
      "detailed",
      "older1",
    ])
    expect(decideQueue[1].confidence.level).toBe("MEDIUM")
  })

  describe("matches the level Job Detail computes for the same posting", () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000)

    /**
     * One saved job, as both queries see it: the window row the dashboard
     * selects (no `description`), and the body the second read returns.
     */
    function stubSingleJob(postedDaysAgo: number, description: string) {
      const job = {
        companyName: "Acme",
        title: "Engineer",
        qualification: snapshot("STRONG"),
        sourceProvider: null,
        source: null,
        url: "https://boards.greenhouse.io/acme/jobs/1",
        postedAt: daysAgo(postedDaysAgo),
        discoveredAt: null,
      }
      Object.assign(prisma, {
        jobApplication: {
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
            const where = args.where
            if (where.id) return [{ id: "app-1", job: { description } }]
            if (where.status === "INTERESTED") {
              return [{ id: "app-1", createdAt: daysAgo(1), job }]
            }
            return []
          }),
        },
      })
      // The inputs `jobs/[id]/page.tsx` passes, with the full body.
      const detail = assessOpportunityConfidence({
        provider: job.sourceProvider,
        source: job.source,
        url: job.url,
        postedAt: job.postedAt,
        discoveredAt: job.discoveredAt,
        createdAt: daysAgo(1),
        companyName: job.companyName,
        description,
      })
      // The dashboard's level had the body never been loaded.
      const withoutBody = rankDecideQueue([
        {
          id: "app-1",
          companyName: job.companyName,
          jobTitle: job.title,
          createdAt: daysAgo(1),
          qualification: job.qualification,
          url: job.url,
          postedAt: job.postedAt,
        },
      ])[0].confidence.level
      return { detail, withoutBody }
    }

    it("agrees on a long, dated ATS posting", async () => {
      const { detail } = stubSingleJob(5, "x".repeat(2_000))

      const { decideQueue } = await getDashboardAttention("user-1")

      expect(detail.level).toBe("HIGH")
      expect(decideQueue[0].confidence.level).toBe(detail.level)
      expect(decideQueue[0].confidence.summary).toBe(detail.summary)
    })

    it("agrees when the body lifts a score from just under HIGH onto the threshold", async () => {
      // ATS board (2) + aging posting (0) + named employer (1) = 3, MEDIUM;
      // a detailed body adds 1 and lands exactly on the HIGH floor of 4.
      const { detail, withoutBody } = stubSingleJob(60, "x".repeat(2_000))

      const { decideQueue } = await getDashboardAttention("user-1")

      expect(withoutBody).toBe("MEDIUM")
      expect(detail.level).toBe("HIGH")
      expect(decideQueue[0].confidence.level).toBe(detail.level)
    })

    it("agrees when a very short body drops a score sitting on the HIGH threshold", async () => {
      // ATS board (2) + recent posting (1) + named employer (1) = 4, exactly
      // HIGH; a very short body subtracts 1.
      const { detail, withoutBody } = stubSingleJob(20, "x".repeat(50))

      const { decideQueue } = await getDashboardAttention("user-1")

      expect(withoutBody).toBe("HIGH")
      expect(detail.level).toBe("MEDIUM")
      expect(decideQueue[0].confidence.level).toBe(detail.level)
    })
  })
})

describe("getDashboardAttention awaiting outcome", () => {
  /** The user's day start, as the dashboard page hands it in. */
  const TODAY_START = new Date(Date.UTC(2026, 8, 14))
  const at = (iso: string) => new Date(iso)

  type StoredRow = {
    id: string
    userId: string
    status: string
    interviewDate: Date | null
  }

  /**
   * Answers the awaiting-outcome query the way Postgres would, by applying the
   * `where` the service built — so the boundary under test is the filter the
   * service actually sends, not a re-statement of it.
   */
  function stubApplications(rows: StoredRow[]) {
    const findMany = vi.fn(
      async (args: {
        where: Record<string, unknown>
        orderBy?: Record<string, string>
        take?: number
      }) => {
        const where = args.where
        if (!where.interviewDate) return []
        const statuses = (where.status as { in: string[] }).in
        const before = (where.interviewDate as { lt: Date }).lt
        return rows
          .filter(
            (row) =>
              row.userId === where.userId &&
              statuses.includes(row.status) &&
              row.interviewDate !== null &&
              row.interviewDate.getTime() < before.getTime(),
          )
          .sort(
            (a, b) =>
              (a.interviewDate?.getTime() ?? 0) - (b.interviewDate?.getTime() ?? 0),
          )
          .slice(0, args.take)
          .map((row) => ({
            id: row.id,
            interviewDate: row.interviewDate,
            job: { companyName: `Company ${row.id}`, title: `Title ${row.id}` },
          }))
      },
    )
    Object.assign(prisma, {
      jobApplication: { count: vi.fn().mockResolvedValue(0), findMany },
    })
    return findMany
  }

  it("lists a live interview held yesterday, with its days since", async () => {
    stubApplications([
      {
        id: "yesterday",
        userId: "user-1",
        status: "INTERVIEW",
        interviewDate: at("2026-09-13T15:00:00.000Z"),
      },
    ])

    const { awaitingOutcome } = await getDashboardAttention("user-1", TODAY_START)

    expect(awaitingOutcome).toEqual([
      {
        id: "yesterday",
        companyName: "Company yesterday",
        jobTitle: "Title yesterday",
        interviewDate: at("2026-09-13T15:00:00.000Z"),
        daysSince: 1,
      },
    ])
  })

  it("leaves out an interview later today", async () => {
    stubApplications([
      {
        id: "today",
        userId: "user-1",
        status: "SCREENING",
        interviewDate: at("2026-09-14T00:00:00.000Z"),
      },
      {
        id: "tonight",
        userId: "user-1",
        status: "INTERVIEW",
        interviewDate: at("2026-09-14T20:00:00.000Z"),
      },
    ])

    const { awaitingOutcome } = await getDashboardAttention("user-1", TODAY_START)

    expect(awaitingOutcome).toEqual([])
  })

  it("leaves out offers and closed rows even with a past interview", async () => {
    const findMany = stubApplications(
      ["OFFER", "REJECTED", "WITHDRAWN", "APPLIED", "INTERESTED"].map((status) => ({
        id: status,
        userId: "user-1",
        status,
        interviewDate: at("2026-09-01T10:00:00.000Z"),
      })),
    )

    const { awaitingOutcome } = await getDashboardAttention("user-1", TODAY_START)

    expect(awaitingOutcome).toEqual([])
    const query = findMany.mock.calls
      .map(([args]) => args.where)
      .find((where) => where.interviewDate)
    expect(query?.status).toEqual({ in: ["SCREENING", "INTERVIEW"] })
  })

  it("is scoped to the user, oldest interview first and capped", async () => {
    stubApplications([
      ...["a", "b", "c", "d"].map((id, index) => ({
        id,
        userId: "user-1",
        status: index % 2 ? "SCREENING" : "INTERVIEW",
        interviewDate: at(`2026-09-1${3 - index}T09:00:00.000Z`),
      })),
      {
        id: "other-user",
        userId: "user-2",
        status: "INTERVIEW",
        interviewDate: at("2026-08-01T09:00:00.000Z"),
      },
    ])

    const { awaitingOutcome } = await getDashboardAttention("user-1", TODAY_START)

    // d is Sep 10, c Sep 11, b Sep 12; a (Sep 13) falls past the cap of three.
    expect(awaitingOutcome.map((row) => [row.id, row.daysSince])).toEqual([
      ["d", 4],
      ["c", 3],
      ["b", 2],
    ])
  })
})

describe("getDashboardAttention due follow-ups", () => {
  /** The user's day start, as the dashboard page hands it in. */
  const TODAY_START = new Date(Date.UTC(2026, 9, 1))
  const at = (iso: string) => new Date(iso)

  type StoredRow = { id: string; userId: string; status: string; followUpAt: Date | null }

  /**
   * Answers the follow-up queries by applying the `where` the service built,
   * so the boundary under test is the filter it actually sends.
   */
  function stubApplications(rows: StoredRow[]) {
    const matching = (where: Record<string, unknown>) => {
      const statuses = (where.status as { in: string[] }).in
      const before = (where.followUpAt as { lt: Date }).lt
      return rows.filter(
        (row) =>
          row.userId === where.userId &&
          statuses.includes(row.status) &&
          row.followUpAt !== null &&
          row.followUpAt.getTime() < before.getTime(),
      )
    }
    const findMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
      if (!args.where.followUpAt) return []
      return matching(args.where)
        .sort((a, b) => (a.followUpAt?.getTime() ?? 0) - (b.followUpAt?.getTime() ?? 0))
        .map((row) => ({
          id: row.id,
          followUpAt: row.followUpAt,
          job: { companyName: `Company ${row.id}`, title: `Title ${row.id}` },
        }))
    })
    const count = vi.fn(async (args: { where: Record<string, unknown> }) =>
      args.where.followUpAt ? matching(args.where).length : 0,
    )
    Object.assign(prisma, { jobApplication: { count, findMany } })
  }

  it("counts a follow-up dated today as due today, whatever the UTC instant", async () => {
    // 01:00 on 1 Oct for a UTC+8 user: the server instant is still 30 Sep.
    vi.useFakeTimers()
    vi.setSystemTime(at("2026-09-30T17:00:00.000Z"))
    try {
      stubApplications([
        { id: "today", userId: "user-1", status: "APPLIED", followUpAt: TODAY_START },
      ])

      const { overdueFollowUps, overdueTotal } = await getDashboardAttention(
        "user-1",
        TODAY_START,
      )

      expect(overdueFollowUps.map((row) => [row.id, row.daysOverdue])).toEqual([
        ["today", 0],
      ])
      expect(overdueTotal).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("leaves out a follow-up dated tomorrow and keeps a past one as overdue", async () => {
    stubApplications([
      {
        id: "tomorrow",
        userId: "user-1",
        status: "APPLIED",
        followUpAt: at("2026-10-02T00:00:00.000Z"),
      },
      {
        id: "past",
        userId: "user-1",
        status: "INTERVIEW",
        followUpAt: at("2026-09-28T00:00:00.000Z"),
      },
    ])

    const { overdueFollowUps, overdueTotal } = await getDashboardAttention(
      "user-1",
      TODAY_START,
    )

    expect(overdueFollowUps.map((row) => [row.id, row.daysOverdue])).toEqual([
      ["past", 3],
    ])
    expect(overdueTotal).toBe(1)
  })
})

describe("getDashboardAttention awaiting outcome for a UTC+8 user", () => {
  // `todayStart` is the user's day as a UTC midnight label, but `interviewDate`
  // is an instant, so the service takes the user's offset to compare them.
  it("does not list an interview later this morning as held yesterday", async () => {
    // 06:00 on 12 Oct in UTC+8; the page hands in the user's day as UTC midnight.
    vi.setSystemTime(new Date("2026-10-11T22:00:00.000Z"))
    const todayStart = new Date(Date.UTC(2026, 9, 12))
    // 07:30 on 12 Oct in UTC+8 — it has not happened yet.
    const interviewDate = new Date("2026-10-11T23:30:00.000Z")
    const findMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
      const lt = (args.where.interviewDate as { lt: Date } | undefined)?.lt
      if (!lt) return []
      return interviewDate.getTime() < lt.getTime()
        ? [{ id: "morning", interviewDate, job: { companyName: "Acme", title: "Eng" } }]
        : []
    })
    Object.assign(prisma, {
      jobApplication: { count: vi.fn().mockResolvedValue(0), findMany },
    })

    try {
      const { awaitingOutcome } = await getDashboardAttention("user-1", todayStart, -480)
      expect(awaitingOutcome).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("getDashboardAttention awaiting outcome for a UTC-5 user", () => {
  it("lists an interview late yesterday, already today in UTC, as 1 day ago", async () => {
    // 10:00 on 12 Oct in UTC-5; the page hands in the user's day as UTC midnight.
    vi.setSystemTime(new Date("2026-10-12T15:00:00.000Z"))
    const todayStart = new Date(Date.UTC(2026, 9, 12))
    // 22:00 on 11 Oct in UTC-5 — 03:00 on 12 Oct in UTC.
    const interviewDate = new Date("2026-10-12T03:00:00.000Z")
    const findMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
      const lt = (args.where.interviewDate as { lt: Date } | undefined)?.lt
      if (!lt) return []
      return interviewDate.getTime() < lt.getTime()
        ? [{ id: "late", interviewDate, job: { companyName: "Acme", title: "Eng" } }]
        : []
    })
    Object.assign(prisma, {
      jobApplication: { count: vi.fn().mockResolvedValue(0), findMany },
    })

    try {
      const { awaitingOutcome } = await getDashboardAttention("user-1", todayStart, 300)
      expect(awaitingOutcome.map((row) => [row.id, row.daysSince])).toEqual([["late", 1]])
    } finally {
      vi.useRealTimers()
    }
  })
})
