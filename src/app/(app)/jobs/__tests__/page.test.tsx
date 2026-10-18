import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { isValidElement, type ReactElement, type ReactNode } from "react"

const { mockAuth, mockPrisma, mockRedirect, mockGetUsdPhpRate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    user: { findUnique: vi.fn() },
    jobApplication: { groupBy: vi.fn(), findMany: vi.fn() },
  },
  mockRedirect: vi.fn(),
  mockGetUsdPhpRate: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))
vi.mock("@/shared/lib/fx", () => ({ getUsdPhpRate: mockGetUsdPhpRate }))
// The page frames "today" off the timezone cookie, which needs a request scope.
vi.mock("@/shared/lib/user-day", () => ({
  getUserDayStart: async () => TODAY,
}))
vi.mock("@/features/jobs/components/job-application-list", () => ({
  JobApplicationList: () => <div data-testid="job-application-list" />,
}))

/** The user's day start the mocked `getUserDayStart` hands the page. */
const TODAY = new Date(Date.UTC(2026, 8, 14))

import { JobApplicationList } from "@/features/jobs/components/job-application-list"
import JobsPage from "../page"

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
  mockGetUsdPhpRate.mockResolvedValue(56)
  mockPrisma.user.findUnique.mockResolvedValue({ preferences: null })
  mockPrisma.jobApplication.groupBy.mockResolvedValue([])
})

/** Depth-first search for the element the page hands the given component. */
function findElementByType(
  node: ReactNode,
  type: unknown,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      const found = findElementByType(child, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node as ReactElement<Record<string, unknown>>
  const { children } = node.props as { children?: ReactNode }
  return findElementByType(children, type)
}

/** The `<JobApplicationList>` element the page renders, for the given params. */
async function renderedList(searchParams: { filter?: string; sort?: string } = {}) {
  const tree = await JobsPage({ searchParams: Promise.resolve(searchParams) })
  const list = findElementByType(tree, JobApplicationList)
  expect(list).not.toBeNull()
  return list!
}

/** The single row handed to `<JobApplicationList>` for the mocked query result. */
async function renderedRow() {
  const list = await renderedList()
  const applications = list.props.applications as Record<string, unknown>[]
  expect(applications).toHaveLength(1)
  return applications[0]
}

// Every posting field gets a value nothing else in the row shares, so a mapping
// that reads the wrong source field cannot pass by coincidence.
const job = {
  companyName: "SENTINEL_COMPANY",
  title: "SENTINEL_TITLE",
  location: "SENTINEL_LOCATION",
  salary: 133_711,
  salaryPeriod: "MONTHLY",
  salaryCurrency: "PHP",
  deadline: new Date("2031-03-04T00:00:00.000Z"),
  url: "https://sentinel.example/posting",
  description: "SENTINEL_DESCRIPTION",
  jobType: "CONTRACT",
  workType: "HYBRID",
  riskLevel: "HIGH",
  requirementFlags: ["SENTINEL_FLAG_A", "SENTINEL_FLAG_B"],
  // Read on the server only — none of these may reach the card row.
  qualification: null,
  sourceProvider: "kalibrr",
  source: "DISCOVERY",
  postedAt: new Date("2026-09-08T00:00:00.000Z"),
  discoveredAt: null,
  createdAt: new Date("2025-10-01T00:00:00.000Z"),
}

const applicationLevel = {
  id: "application-1",
  status: "SCREENING",
  dateApplied: new Date("2026-01-02T00:00:00.000Z"),
  interviewDate: new Date("2026-02-03T00:00:00.000Z"),
  contact: "SENTINEL_CONTACT",
  notes: "SENTINEL_NOTES",
  followUpAt: null,
  outcomeAt: null,
  createdAt: new Date("2025-11-01T00:00:00.000Z"),
  updatedAt: new Date("2025-12-01T00:00:00.000Z"),
  coverLetters: [{ id: "cover-1", updatedAt: new Date("2025-12-02T00:00:00.000Z") }],
  _count: { coverLetters: 3 },
}

describe("jobs page job-relation mapping", () => {
  it("maps every posting field off the job relation onto the nested card field", async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([{ ...applicationLevel, job }])

    const row = await renderedRow()

    expect(row).toEqual({
      id: applicationLevel.id,
      status: applicationLevel.status,
      dateApplied: applicationLevel.dateApplied,
      interviewDate: applicationLevel.interviewDate,
      followUpAt: applicationLevel.followUpAt,
      outcomeAt: applicationLevel.outcomeAt,
      contact: applicationLevel.contact,
      notes: applicationLevel.notes,
      createdAt: applicationLevel.createdAt,
      updatedAt: applicationLevel.updatedAt,
      job: {
        companyName: job.companyName,
        title: job.title,
        location: job.location,
        salary: job.salary,
        salaryPeriod: job.salaryPeriod,
        salaryCurrency: job.salaryCurrency,
        deadline: job.deadline,
        url: job.url,
        description: job.description,
        jobType: job.jobType,
        workType: job.workType,
        riskLevel: job.riskLevel,
        requirementFlags: job.requirementFlags,
      },
      verdict: null,
      confidence: expect.objectContaining({ level: expect.any(String) }),
      provenance: expect.any(String),
      nextStep: expect.objectContaining({ urgency: expect.any(Number) }),
      quickActions: expect.any(Array),
      coverLetters: applicationLevel.coverLetters,
      _count: applicationLevel._count,
    })
  })

  it("keeps the posting fields and the application's own fields on separate levels", async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([{ ...applicationLevel, job }])

    const row = await renderedRow()
    const rowJob = row.job as Record<string, unknown>

    // Named one by one so a swap between two same-typed fields names itself.
    expect(rowJob.title).toBe(job.title)
    expect(rowJob.companyName).toBe(job.companyName)
    expect(rowJob.url).toBe(job.url)
    expect(rowJob.description).toBe(job.description)
    expect(rowJob.location).toBe(job.location)
    expect(rowJob.deadline).toBe(job.deadline)
    expect(row.contact).toBe(applicationLevel.contact)
    expect(row.notes).toBe(applicationLevel.notes)
    expect(row.dateApplied).toBe(applicationLevel.dateApplied)
    expect(row.interviewDate).toBe(applicationLevel.interviewDate)
    // Decision-side fields must not leak onto the posting, and vice versa.
    expect(row).not.toHaveProperty("companyName")
    expect(rowJob).not.toHaveProperty("status")
  })

  it("passes requirementFlags through untouched", async () => {
    // NULL for every row in the dev database, so this is the only exercise the
    // field gets.
    mockPrisma.jobApplication.findMany.mockResolvedValue([{ ...applicationLevel, job }])

    const row = await renderedRow()

    expect((row.job as Record<string, unknown>).requirementFlags).toEqual([
      "SENTINEL_FLAG_A",
      "SENTINEL_FLAG_B",
    ])
  })

  // The relation itself can no longer be missing — `jobId` is required — but a
  // sparsely filled posting still has to reach the card as nulls, not as
  // stand-in strings.
  it("passes the posting's empty cells through as null", async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      {
        ...applicationLevel,
        job: {
          companyName: "",
          title: "",
          location: null,
          salary: null,
          salaryPeriod: null,
          salaryCurrency: "USD",
          deadline: null,
          url: null,
          description: null,
          jobType: null,
          workType: null,
          riskLevel: null,
          requirementFlags: null,
          qualification: null,
          sourceProvider: null,
          source: "MANUAL",
          postedAt: null,
          discoveredAt: null,
          createdAt: new Date("2025-10-01T00:00:00.000Z"),
        },
      },
    ])

    const row = await renderedRow()

    expect(row).toEqual({
      id: applicationLevel.id,
      status: applicationLevel.status,
      dateApplied: applicationLevel.dateApplied,
      interviewDate: applicationLevel.interviewDate,
      followUpAt: applicationLevel.followUpAt,
      outcomeAt: applicationLevel.outcomeAt,
      contact: applicationLevel.contact,
      notes: applicationLevel.notes,
      createdAt: applicationLevel.createdAt,
      updatedAt: applicationLevel.updatedAt,
      job: {
        companyName: "",
        title: "",
        location: null,
        salary: null,
        salaryPeriod: null,
        salaryCurrency: "USD",
        deadline: null,
        url: null,
        description: null,
        jobType: null,
        workType: null,
        riskLevel: null,
        requirementFlags: null,
      },
      verdict: null,
      confidence: expect.objectContaining({ level: expect.any(String) }),
      provenance: expect.any(String),
      nextStep: expect.objectContaining({ urgency: expect.any(Number) }),
      quickActions: expect.any(Array),
      coverLetters: applicationLevel.coverLetters,
      _count: applicationLevel._count,
    })
  })
})

describe("jobs page read-time assessments", () => {
  beforeEach(() => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      { ...applicationLevel, job },
    ])
  })

  it("keeps the server-only posting columns off the card row", async () => {
    const row = await renderedRow()
    const rowJob = row.job as Record<string, unknown>

    // The `qualification` blob in particular is large; none of it is needed in
    // the browser once the verdict has been parsed out of it here.
    expect(rowJob).not.toHaveProperty("qualification")
    expect(rowJob).not.toHaveProperty("sourceProvider")
    expect(rowJob).not.toHaveProperty("source")
    expect(rowJob).not.toHaveProperty("postedAt")
    expect(rowJob).not.toHaveProperty("discoveredAt")
    expect(rowJob).not.toHaveProperty("createdAt")
  })

  it("words provenance off the provider and the employer's posting date", async () => {
    const row = await renderedRow()
    expect(row.provenance as string).toMatch(/^Kalibrr \u00b7 Posted /)
  })

  it("reads the verdict out of the stored qualification", async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      {
        ...applicationLevel,
        job: {
          ...job,
          qualification: {
            verdict: "STRONG",
            nextAction: "Apply",
            checkedAt: "2026-09-01T00:00:00.000Z",
            worthIt: { signal: "GOOD", reasons: [] },
            eligible: { signal: "GOOD", reasons: [] },
            match: { signal: "GOOD", reasons: [], matched: [], confirmedCount: 2 },
            risk: { signal: "GOOD", reasons: [], level: "LOW" },
          },
        },
      },
    ])

    expect((await renderedRow()).verdict).toBe("STRONG")
  })

  it("decides the next step against the user's day, not the server's", async () => {
    // SCREENING with an interview date already in the past.
    expect((await renderedRow()).nextStep).toEqual({
      label: "Log the interview outcome",
      urgency: 1,
      tone: "soon",
    })
  })

  it("orders the rows by urgency by default and by recency on request", async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      {
        ...applicationLevel,
        id: "closed",
        status: "REJECTED",
        interviewDate: null,
        outcomeAt: new Date("2026-09-09T00:00:00.000Z"),
        updatedAt: new Date("2026-09-10T00:00:00.000Z"),
        job,
      },
      { ...applicationLevel, id: "urgent", job },
    ])

    const byUrgency = await renderedList()
    expect(
      (byUrgency.props.applications as { id: string }[]).map((row) => row.id),
    ).toEqual(["urgent", "closed"])

    const byRecency = await renderedList({ sort: "recent" })
    expect(
      (byRecency.props.applications as { id: string }[]).map((row) => row.id),
    ).toEqual(["closed", "urgent"])
    expect(byRecency.props.initialSort).toBe("RECENT")
  })
})

describe("jobs page follow-up filter param", () => {
  beforeEach(() => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      { ...applicationLevel, job },
    ])
  })

  it("preselects the follow-up filter for ?filter=follow-up-due", async () => {
    const list = await renderedList({ filter: "follow-up-due" })
    expect(list.props.initialFollowUpFilter).toBe("FOLLOW_UP_DUE")
  })

  it("leaves the filter off when the param is absent", async () => {
    const list = await renderedList()
    expect(list.props.initialFollowUpFilter).toBe("ALL")
  })

  it("ignores an unrecognised filter value", async () => {
    const list = await renderedList({ filter: "nonsense" })
    expect(list.props.initialFollowUpFilter).toBe("ALL")
  })
})

describe("jobs page header cross-links", () => {
  beforeEach(() => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      { ...applicationLevel, job },
    ])
  })

  // `/workspace` is the only cross-job kanban; before this the list had no
  // in-flow way to reach it.
  it("links to the workspace board from the header", async () => {
    const tree = await JobsPage({ searchParams: Promise.resolve({}) })
    render(tree)

    const board = screen.getByRole("link", { name: /board/i })
    expect(board.getAttribute("href")).toBe("/workspace")
  })

  it("keeps the Discover link beside the board link", async () => {
    const tree = await JobsPage({ searchParams: Promise.resolve({}) })
    render(tree)

    expect(
      screen.getByRole("link", { name: /discover/i }).getAttribute("href"),
    ).toBe("/jobs/discover")
  })
})
