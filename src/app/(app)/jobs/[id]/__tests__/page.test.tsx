import { describe, it, expect, beforeEach, vi } from "vitest"
import { isValidElement, type ReactElement, type ReactNode } from "react"

const { mockAuth, mockPrisma, mockRedirect, mockNotFound, mockGetUsdPhpRate } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    mockPrisma: {
      user: { findUnique: vi.fn() },
      resume: { findMany: vi.fn() },
      jobApplication: { findUnique: vi.fn() },
      // Read by the shared resume source options the in-place tailor dialog takes.
      careerRoleFamily: { findMany: vi.fn() },
      // This application's own tasks, listed in the Track section.
      todo: { findMany: vi.fn() },
    },
    mockRedirect: vi.fn(),
    mockNotFound: vi.fn(),
    mockGetUsdPhpRate: vi.fn(),
  }),
)

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: mockNotFound }))
vi.mock("@/shared/lib/fx", () => ({ getUsdPhpRate: mockGetUsdPhpRate }))
// The page frames "today" off the timezone cookie, which needs a request scope.
// Given an instant, it frames it on a UTC+8 calendar, as the real helper does
// with a `tz-offset=-480` cookie.
vi.mock("@/shared/lib/user-day", async () => {
  const { calendarDayStart } = await import("@/shared/lib/dates")
  return {
    getUserDayStart: async (now?: Date) =>
      now ? calendarDayStart(now, -480) : new Date(Date.UTC(2026, 8, 14)),
  }
})
// The flat `application` object is handed straight to the edit provider, so the
// stub below is the seam the mapping is read through.
vi.mock("@/features/jobs/components/job-edit-provider", () => ({
  JobEditProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

import { JobEditProvider } from "@/features/jobs/components/job-edit-provider"
import {
  FollowUpActions,
  LastFollowUpNote,
} from "@/features/jobs/components/follow-up-actions"
import JobApplicationDetailPage from "../page"

/** In Next.js notFound()/redirect() throw; mirror that so nothing runs after. */
beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockNotFound.mockImplementation(() => {
    throw new Error("NOT_FOUND")
  })
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
  mockGetUsdPhpRate.mockResolvedValue(56)
  mockPrisma.user.findUnique.mockResolvedValue({ preferences: null })
  mockPrisma.resume.findMany.mockResolvedValue([])
  mockPrisma.careerRoleFamily.findMany.mockResolvedValue([])
  mockPrisma.todo.findMany.mockResolvedValue([])
})

const params = Promise.resolve({ id: "application-1" })

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

/** Every string child in the element tree, without rendering components. */
function collectText(node: ReactNode): string[] {
  if (typeof node === "string") return [node]
  if (Array.isArray(node)) return (node as ReactNode[]).flatMap(collectText)
  if (!isValidElement(node)) return []
  const { children } = node.props as { children?: ReactNode }
  return collectText(children)
}

async function renderedApplication() {
  const tree = await JobApplicationDetailPage({ params })
  const provider = findElementByType(tree, JobEditProvider)
  expect(provider).not.toBeNull()
  return provider!.props.application as Record<string, unknown>
}

// Every posting field gets a value nothing else in the row shares, so a mapping
// that reads the wrong source field cannot pass by coincidence.
const job = {
  companyName: "SENTINEL_COMPANY",
  title: "SENTINEL_TITLE",
  url: "https://sentinel.example/posting",
  location: "SENTINEL_LOCATION",
  jobType: "CONTRACT",
  workType: "HYBRID",
  salary: 133_711,
  salaryPeriod: "MONTHLY",
  salaryCurrency: "PHP",
  description: "SENTINEL_DESCRIPTION",
  deadline: new Date("2031-03-04T00:00:00.000Z"),
  riskLevel: "HIGH",
  riskReasons: ["SENTINEL_RISK_REASON"],
  riskSource: "AI",
  riskCheckedAt: new Date("2026-04-05T00:00:00.000Z"),
  requirementFlags: ["SENTINEL_FLAG_A", "SENTINEL_FLAG_B"],
  // Provenance and dates. They are not mapped onto the flat application, but the
  // page reads them for the source line and the confidence signal, so the
  // fixture has to carry them.
  sourceProvider: null,
  source: "EXTENSION",
  postedAt: new Date("2026-06-07T00:00:00.000Z"),
  discoveredAt: new Date("2026-06-08T00:00:00.000Z"),
  createdAt: new Date("2026-06-09T00:00:00.000Z"),
}

const applicationLevel = {
  id: "application-1",
  status: "SCREENING",
  dateApplied: new Date("2026-01-02T00:00:00.000Z"),
  interviewDate: new Date("2026-02-03T00:00:00.000Z"),
  followUpAt: new Date("2026-02-10T00:00:00.000Z"),
  resumeId: "SENTINEL_SUBMITTED_RESUME_ID",
  contact: "SENTINEL_CONTACT",
  notes: "SENTINEL_NOTES",
  matchScore: 77,
  matchResult: { summary: "SENTINEL_MATCH_SUMMARY" },
  matchResumeId: "SENTINEL_MATCH_RESUME_ID",
  matchCheckedAt: new Date("2026-05-06T00:00:00.000Z"),
  createdAt: new Date("2025-11-01T00:00:00.000Z"),
  updatedAt: new Date("2025-12-01T00:00:00.000Z"),
  coverLetters: [
    {
      id: "cover-1",
      createdAt: new Date("2025-12-02T00:00:00.000Z"),
      resume: { title: "SENTINEL_RESUME_TITLE" },
    },
  ],
  interviewQuestions: [
    { id: "question-1", question: "SENTINEL_QUESTION", source: "SCRAPED" },
  ],
}

describe("job detail page job-relation mapping", () => {
  it("maps every posting field off the job relation onto the flat field", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ ...applicationLevel, job })

    const application = await renderedApplication()

    expect(application).toEqual({
      id: applicationLevel.id,
      companyName: job.companyName,
      jobTitle: job.title,
      status: applicationLevel.status,
      location: job.location,
      salary: job.salary,
      salaryPeriod: job.salaryPeriod,
      salaryCurrency: job.salaryCurrency,
      dateApplied: applicationLevel.dateApplied,
      deadline: job.deadline,
      interviewDate: applicationLevel.interviewDate,
      followUpAt: applicationLevel.followUpAt,
      jobLink: job.url,
      contact: applicationLevel.contact,
      jobDescription: job.description,
      notes: applicationLevel.notes,
      jobType: job.jobType,
      workType: job.workType,
      riskLevel: job.riskLevel,
      riskReasons: job.riskReasons,
      riskSource: job.riskSource,
      riskCheckedAt: job.riskCheckedAt,
      requirementFlags: job.requirementFlags,
      matchScore: applicationLevel.matchScore,
      matchResult: applicationLevel.matchResult,
      matchResumeId: applicationLevel.matchResumeId,
      matchCheckedAt: applicationLevel.matchCheckedAt,
      createdAt: applicationLevel.createdAt,
      updatedAt: applicationLevel.updatedAt,
      coverLetters: applicationLevel.coverLetters,
      interviewQuestions: applicationLevel.interviewQuestions,
    })
  })

  it("keeps the posting fields and the application's own fields on separate levels", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ ...applicationLevel, job })

    const application = await renderedApplication()

    // Named one by one so a swap between two same-typed fields names itself.
    expect(application.jobTitle).toBe(job.title)
    expect(application.companyName).toBe(job.companyName)
    expect(application.jobLink).toBe(job.url)
    expect(application.jobDescription).toBe(job.description)
    expect(application.location).toBe(job.location)
    expect(application.deadline).toBe(job.deadline)
    expect(application.riskSource).toBe(job.riskSource)
    expect(application.riskCheckedAt).toBe(job.riskCheckedAt)
    expect(application.status).toBe(applicationLevel.status)
    expect(application.notes).toBe(applicationLevel.notes)
    expect(application.contact).toBe(applicationLevel.contact)
    expect(application.matchScore).toBe(applicationLevel.matchScore)
    expect(application.matchResumeId).toBe(applicationLevel.matchResumeId)
    expect(application.matchCheckedAt).toBe(applicationLevel.matchCheckedAt)
  })

  it("passes requirementFlags through untouched", async () => {
    // NULL for every row in the dev database, so this is the only exercise the
    // field gets.
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ ...applicationLevel, job })

    const application = await renderedApplication()

    expect(application.requirementFlags).toEqual(["SENTINEL_FLAG_A", "SENTINEL_FLAG_B"])
  })

  // The relation itself can no longer be missing — `jobId` is required — but a
  // sparsely filled posting still has to reach the panels as nulls.
  it("passes the posting's empty cells through as null", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      ...applicationLevel,
      job: {
        companyName: "",
        title: "",
        url: null,
        location: null,
        jobType: null,
        workType: null,
        salary: null,
        salaryPeriod: null,
        salaryCurrency: "USD",
        description: null,
        deadline: null,
        riskLevel: null,
        riskReasons: null,
        riskSource: null,
        riskCheckedAt: null,
        requirementFlags: null,
        // The sparse case: no provider and no employer date, so the page falls
        // back to `discoveredAt`/`createdAt`.
        sourceProvider: null,
        source: "MANUAL",
        postedAt: null,
        discoveredAt: null,
        createdAt: new Date("2026-06-09T00:00:00.000Z"),
      },
    })

    const application = await renderedApplication()

    expect(application).toEqual({
      id: applicationLevel.id,
      companyName: "",
      jobTitle: "",
      status: applicationLevel.status,
      location: null,
      salary: null,
      salaryPeriod: null,
      salaryCurrency: "USD",
      dateApplied: applicationLevel.dateApplied,
      deadline: null,
      interviewDate: applicationLevel.interviewDate,
      followUpAt: applicationLevel.followUpAt,
      jobLink: null,
      contact: applicationLevel.contact,
      jobDescription: null,
      notes: applicationLevel.notes,
      jobType: null,
      workType: null,
      riskLevel: null,
      riskReasons: null,
      riskSource: null,
      riskCheckedAt: null,
      requirementFlags: null,
      matchScore: applicationLevel.matchScore,
      matchResult: applicationLevel.matchResult,
      matchResumeId: applicationLevel.matchResumeId,
      matchCheckedAt: applicationLevel.matchCheckedAt,
      createdAt: applicationLevel.createdAt,
      updatedAt: applicationLevel.updatedAt,
      coverLetters: applicationLevel.coverLetters,
      interviewQuestions: applicationLevel.interviewQuestions,
    })
  })

  // "Today" is pinned to 2026-09-14 by the user-day mock above.
  it.each([
    ["due today", new Date("2026-09-14T00:00:00.000Z"), " — due today"],
    ["past", new Date("2026-09-12T00:00:00.000Z"), " — overdue"],
    ["future", new Date("2026-09-20T00:00:00.000Z"), null],
  ])("labels a %s follow-up in the Track section", async (_case, followUpAt, label) => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      ...applicationLevel,
      followUpAt,
      job,
    })

    const text = collectText(await JobApplicationDetailPage({ params }))

    if (label === null) {
      expect(text).not.toContain(" — due today")
      expect(text).not.toContain(" — overdue")
    } else {
      expect(text).toContain(label)
    }
    // A follow-up due today is not also called overdue.
    if (label === " — due today") expect(text).not.toContain(" — overdue")
  })

  it("reads the last follow-up's day on the user's calendar, not UTC", async () => {
    // 01:00 on Sep 14 in UTC+8 is still Sep 13 in UTC.
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      ...applicationLevel,
      followUpAt: null,
      lastFollowedUpAt: new Date("2026-09-13T17:00:00.000Z"),
      job,
    })

    const note = findElementByType(
      await JobApplicationDetailPage({ params }),
      LastFollowUpNote,
    )

    expect(note).not.toBeNull()
    expect(note!.props.lastFollowedUpAt).toEqual(new Date("2026-09-14T00:00:00.000Z"))
    expect(note!.props.today).toEqual(new Date("2026-09-14T00:00:00.000Z"))
  })

  it.each([
    ["SCREENING", true],
    ["WITHDRAWN", false],
  ])("shows follow-up controls for a %s row with a stale date: %s", async (status, shown) => {
    // Rows closed before terminal moves cleared `followUpAt` still carry one.
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      ...applicationLevel,
      status,
      followUpAt: new Date("2026-09-12T00:00:00.000Z"),
      lastFollowedUpAt: new Date("2026-09-01T00:00:00.000Z"),
      job,
    })

    const tree = await JobApplicationDetailPage({ params })
    const text = collectText(tree)

    expect(findElementByType(tree, FollowUpActions) !== null).toBe(shown)
    expect(text.includes("Follow Up")).toBe(shown)
    expect(text.includes(" — overdue")).toBe(shown)
    expect(findElementByType(tree, LastFollowUpNote)).toBeNull()
  })

  it("hides the last follow-up note on a terminal row", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      ...applicationLevel,
      status: "WITHDRAWN",
      followUpAt: null,
      lastFollowedUpAt: new Date("2026-09-01T00:00:00.000Z"),
      job,
    })

    const tree = await JobApplicationDetailPage({ params })

    expect(findElementByType(tree, LastFollowUpNote)).toBeNull()
    expect(collectText(tree)).not.toContain("Follow Up")
  })

  it("returns not-found for a missing application", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    await expect(JobApplicationDetailPage({ params })).rejects.toThrow("NOT_FOUND")
    expect(mockNotFound).toHaveBeenCalledTimes(1)
  })
})
