import { describe, it, expect, beforeEach, vi } from "vitest"
import { Prisma } from "@/generated/prisma/client"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { formatCalendarDate } from "@/shared/lib/dates"

const { mockAuth, mockPrisma } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    jobApplication: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    job: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() },
    resume: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { revalidatePath } from "next/cache"

import {
  clearJobApplicationFollowUp,
  createJobApplication,
  deleteJobApplication,
  deleteJobApplications,
  saveJobApplicationOutcomeNote,
  scheduleJobApplicationFollowUp,
  selectJobApplicationResume,
  snoozeJobApplicationFollowUp,
  updateJobApplication,
  updateJobApplicationStatus,
} from "../job-application.actions"

/** The `data` object passed to the last application update call. */
function lastUpdateData() {
  return mockPrisma.jobApplication.update.mock.calls.at(-1)?.[0].data
}

/** The `data` object passed to the last posting update call. */
function lastJobUpdateData() {
  return mockPrisma.job.update.mock.calls.at(-1)?.[0].data
}

/** The `data` object of the posting row written alongside a create. */
function jobCreateData() {
  return mockPrisma.job.create.mock.calls[0][0].data
}

describe("updateJobApplicationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The ingest helper writes the Job and the JobApplication in one
    // transaction; running the callback against the same mock keeps every
    // assertion below pointed at the real create call.
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.update.mockResolvedValue({})
    mockPrisma.jobApplication.count.mockResolvedValue(1)
  })

  it("stamps dateApplied on the transition to APPLIED when it is unset", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.INTERESTED,
      dateApplied: null,
    })

    const result = await updateJobApplicationStatus("app-1", ApplicationStatus.APPLIED)

    expect(result).toMatchObject({ success: true })
    expect(lastUpdateData()).toMatchObject({ status: ApplicationStatus.APPLIED })
    expect(lastUpdateData().dateApplied).toBeInstanceOf(Date)
  })

  it("stamps the caller's calendar day, and renders back as that same day", async () => {
    vi.useFakeTimers()
    // 07:00 on 9 Sep for a UTC+8 user: the server instant is still 8 Sep, which
    // is the exact case that used to store — and display — yesterday.
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.INTERESTED,
      dateApplied: null,
    })

    await updateJobApplicationStatus("app-1", ApplicationStatus.APPLIED, "2026-09-09")

    const stamped: Date = lastUpdateData().dateApplied
    expect(stamped.toISOString()).toBe("2026-09-09T00:00:00.000Z")
    expect(formatCalendarDate(stamped)).toBe("Sep 9, 2026")
    vi.useRealTimers()
  })

  it("falls back to the UTC day when no client date is supplied", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.INTERESTED,
      dateApplied: null,
    })

    await updateJobApplicationStatus("app-1", ApplicationStatus.APPLIED)

    expect(lastUpdateData().dateApplied.toISOString()).toBe(
      "2026-09-08T00:00:00.000Z"
    )
    vi.useRealTimers()
  })

  it("leaves an existing dateApplied alone", async () => {
    const existingDate = new Date("2020-01-01")
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.INTERESTED,
      dateApplied: existingDate,
    })

    await updateJobApplicationStatus("app-1", ApplicationStatus.APPLIED)

    expect(lastUpdateData()).toEqual({ status: ApplicationStatus.APPLIED })
  })

  it("does not stamp dateApplied for a non-APPLIED status", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.APPLIED,
      dateApplied: null,
    })

    await updateJobApplicationStatus("app-1", ApplicationStatus.SCREENING)

    expect(lastUpdateData()).toEqual({ status: ApplicationStatus.SCREENING })
  })

  it("reports success when the status did not cross into APPLIED", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.APPLIED,
      dateApplied: new Date(),
    })

    const result = await updateJobApplicationStatus("app-1", ApplicationStatus.OFFER)

    expect(result).toEqual({ success: true })
  })
})

describe("updateJobApplicationStatus outcome stamping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.update.mockResolvedValue({})
  })

  const existing = (
    status: ApplicationStatus,
    outcomeAt: Date | null = null,
  ) => ({ id: "app-1", status, dateApplied: new Date("2026-08-01"), outcomeAt })

  it.each([
    ApplicationStatus.OFFER,
    ApplicationStatus.REJECTED,
    ApplicationStatus.WITHDRAWN,
  ])("stamps outcomeAt on the move to %s", async (status) => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(
      existing(ApplicationStatus.INTERVIEW),
    )

    await updateJobApplicationStatus("app-1", status)

    expect(lastUpdateData().outcomeAt).toBeInstanceOf(Date)
  })

  it("stamps the caller's calendar day, not the server's", async () => {
    vi.useFakeTimers()
    // 07:00 on 9 Sep for a UTC+8 user; the server instant is still 8 Sep.
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue(
      existing(ApplicationStatus.INTERVIEW),
    )

    await updateJobApplicationStatus(
      "app-1",
      ApplicationStatus.REJECTED,
      "2026-09-09",
    )

    const stamped: Date = lastUpdateData().outcomeAt
    expect(stamped.toISOString()).toBe("2026-09-09T00:00:00.000Z")
    expect(formatCalendarDate(stamped)).toBe("Sep 9, 2026")
    vi.useRealTimers()
  })

  it("falls back to the UTC day when no client date is supplied", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue(
      existing(ApplicationStatus.INTERVIEW),
    )

    await updateJobApplicationStatus("app-1", ApplicationStatus.REJECTED)

    expect(lastUpdateData().outcomeAt.toISOString()).toBe(
      "2026-09-08T00:00:00.000Z",
    )
    vi.useRealTimers()
  })

  it("does not stamp outcomeAt for a non-terminal status", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(
      existing(ApplicationStatus.APPLIED),
    )

    await updateJobApplicationStatus("app-1", ApplicationStatus.INTERVIEW)

    expect(lastUpdateData()).toEqual({ status: ApplicationStatus.INTERVIEW })
  })

  it("re-stamps outcomeAt when the user moves from one terminal status to another", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(
      existing(ApplicationStatus.REJECTED, new Date("2026-09-01T00:00:00.000Z")),
    )

    await updateJobApplicationStatus("app-1", ApplicationStatus.OFFER, "2026-09-15")

    expect(lastUpdateData().outcomeAt.toISOString()).toBe(
      "2026-09-15T00:00:00.000Z",
    )
  })

  it("leaves outcomeAt alone when the terminal status is re-saved unchanged", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(
      existing(ApplicationStatus.REJECTED, new Date("2026-09-01T00:00:00.000Z")),
    )

    await updateJobApplicationStatus("app-1", ApplicationStatus.REJECTED, "2026-09-15")

    // The re-save still clears any lingering follow-up: a closed row has
    // nobody to chase, however it got there.
    expect(lastUpdateData()).toEqual({
      status: ApplicationStatus.REJECTED,
      followUpAt: null,
    })
  })

  it("keeps outcomeAt when the application is re-opened", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(
      existing(ApplicationStatus.REJECTED, new Date("2026-09-01T00:00:00.000Z")),
    )

    await updateJobApplicationStatus("app-1", ApplicationStatus.INTERVIEW)

    expect(lastUpdateData()).toEqual({ status: ApplicationStatus.INTERVIEW })
  })

  it("re-stamps outcomeAt when a re-opened application ends again", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(
      existing(ApplicationStatus.INTERVIEW, new Date("2026-09-01T00:00:00.000Z")),
    )

    await updateJobApplicationStatus("app-1", ApplicationStatus.OFFER, "2026-09-15")

    expect(lastUpdateData().outcomeAt.toISOString()).toBe(
      "2026-09-15T00:00:00.000Z",
    )
  })
})

describe("updateJobApplicationStatus follow-up cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.update.mockResolvedValue({})
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.INTERVIEW,
      dateApplied: new Date("2026-08-01"),
      outcomeAt: null,
    })
  })

  it.each([
    ApplicationStatus.OFFER,
    ApplicationStatus.REJECTED,
    ApplicationStatus.WITHDRAWN,
  ])("clears a pending follow-up on the move to %s", async (status) => {
    await updateJobApplicationStatus("app-1", status, "2026-09-15")

    expect(lastUpdateData().followUpAt).toBeNull()
  })

  it("leaves the follow-up alone on a non-terminal move", async () => {
    await updateJobApplicationStatus("app-1", ApplicationStatus.SCREENING)

    expect(lastUpdateData()).not.toHaveProperty("followUpAt")
  })

  it("revalidates the dashboard and planner alongside the job pages", async () => {
    await updateJobApplicationStatus("app-1", ApplicationStatus.REJECTED, "2026-09-15")

    const paths = vi.mocked(revalidatePath).mock.calls.map((call) => call[0])
    expect(paths).toEqual(
      expect.arrayContaining([
        "/jobs",
        "/jobs/app-1",
        "/workspace",
        "/dashboard",
        "/planner",
      ]),
    )
  })
})

describe("clearJobApplicationFollowUp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.update.mockResolvedValue({})
  })

  it("scopes the lookup to the session user", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    expect(await clearJobApplicationFollowUp("app-1")).toEqual({
      error: "Not found",
    })
    expect(mockPrisma.jobApplication.findUnique.mock.calls[0][0].where).toEqual({
      id: "app-1",
      userId: "user-1",
    })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("clears the follow-up and remembers when it was done", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ id: "app-1" })

    const result = await clearJobApplicationFollowUp("app-1")

    expect(result).toEqual({ success: true })
    const data = lastUpdateData()
    expect(data.followUpAt).toBeNull()
    expect(data.lastFollowedUpAt.toISOString()).toBe("2026-09-14T10:00:00.000Z")
    vi.useRealTimers()
  })

  it("revalidates the workspace alongside the job pages", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ id: "app-1" })

    await clearJobApplicationFollowUp("app-1")

    const paths = vi.mocked(revalidatePath).mock.calls.map((call) => call[0])
    expect(paths).toEqual(
      expect.arrayContaining(["/jobs", "/jobs/app-1", "/workspace"]),
    )
  })
})

describe("saveJobApplicationOutcomeNote", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ id: "app-1" })
    mockPrisma.jobApplication.update.mockResolvedValue({})
  })

  it("refuses an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await saveJobApplicationOutcomeNote("app-1", "hi")).toEqual({
      error: "Unauthorized",
    })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("scopes the lookup to the session user and refuses someone else's row", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    expect(await saveJobApplicationOutcomeNote("app-1", "hi")).toEqual({
      error: "Not found",
    })
    expect(mockPrisma.jobApplication.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "app-1", userId: "user-1" } }),
    )
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("stores the trimmed note", async () => {
    const result = await saveJobApplicationOutcomeNote(
      "app-1",
      "  Ghosted after the take-home.  ",
    )

    expect(result).toEqual({ success: true })
    expect(lastUpdateData()).toEqual({
      outcomeNote: "Ghosted after the take-home.",
    })
  })

  it("clears the note back to null when it is emptied", async () => {
    await saveJobApplicationOutcomeNote("app-1", "   ")

    expect(lastUpdateData()).toEqual({ outcomeNote: null })
  })

  it("rejects a note past the length cap without writing", async () => {
    const result = await saveJobApplicationOutcomeNote("app-1", "x".repeat(2001))

    expect(result).toEqual({ error: "That note is too long" })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })
})

describe("createJobApplication dateApplied default", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The ingest helper writes the Job and the JobApplication in one
    // transaction; running the callback against the same mock keeps every
    // assertion below pointed at the real create call.
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.create.mockResolvedValue({ id: "app-1" })
  })

  const form = (status: string) => {
    const data = new FormData()
    data.set("companyName", "Acme")
    data.set("jobTitle", "Engineer")
    data.set("status", status)
    return data
  }

  it("stamps today when quick add creates a row straight into APPLIED", async () => {
    await createJobApplication(form(ApplicationStatus.APPLIED))

    const data = mockPrisma.jobApplication.create.mock.calls[0][0].data
    expect(data.status).toBe(ApplicationStatus.APPLIED)
    expect(data.dateApplied).toBeInstanceOf(Date)
  })

  it("leaves dateApplied null for any other status", async () => {
    await createJobApplication(form(ApplicationStatus.INTERESTED))

    expect(mockPrisma.jobApplication.create.mock.calls[0][0].data.dateApplied).toBeNull()
  })

  it("stamps the client's calendar day, not the server's UTC day", async () => {
    vi.useFakeTimers()
    // 07:00 on 9 Sep for a UTC+8 user: the server instant is still 8 Sep, which
    // is the exact case that used to store — and display — yesterday.
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))

    const data = form(ApplicationStatus.APPLIED)
    data.set("clientToday", "2026-09-09")
    await createJobApplication(data)

    const stamped: Date = mockPrisma.jobApplication.create.mock.calls[0][0].data.dateApplied
    expect(stamped.toISOString()).toBe("2026-09-09T00:00:00.000Z")
    expect(formatCalendarDate(stamped)).toBe("Sep 9, 2026")
    vi.useRealTimers()
  })

  it("falls back to the UTC day when no client date is supplied", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))

    await createJobApplication(form(ApplicationStatus.APPLIED))

    expect(
      mockPrisma.jobApplication.create.mock.calls[0][0].data.dateApplied.toISOString()
    ).toBe("2026-09-08T00:00:00.000Z")
    vi.useRealTimers()
  })
})

describe("createJobApplication outcomeAt stamping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The ingest helper writes the Job and the JobApplication in one
    // transaction; running the callback against the same mock keeps every
    // assertion below pointed at the real create call.
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.create.mockResolvedValue({ id: "app-1" })
  })

  const form = (status: string, clientToday?: string) => {
    const data = new FormData()
    data.set("companyName", "Acme")
    data.set("jobTitle", "Engineer")
    data.set("status", status)
    if (clientToday) data.set("clientToday", clientToday)
    return data
  }

  it("stamps outcomeAt at the client's calendar day when created straight into REJECTED", async () => {
    await createJobApplication(form(ApplicationStatus.REJECTED, "2026-09-09"))

    const data = mockPrisma.jobApplication.create.mock.calls[0][0].data
    expect(data.outcomeAt).toBeInstanceOf(Date)
    expect((data.outcomeAt as Date).toISOString()).toBe("2026-09-09T00:00:00.000Z")
  })

  it("leaves outcomeAt null when created at a non-terminal status", async () => {
    await createJobApplication(form(ApplicationStatus.INTERESTED, "2026-09-09"))

    expect(mockPrisma.jobApplication.create.mock.calls[0][0].data).not.toHaveProperty(
      "outcomeAt"
    )
  })
})

describe("createJobApplication risk heuristics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The ingest helper writes the Job and the JobApplication in one
    // transaction; running the callback against the same mock keeps every
    // assertion below pointed at the real create call.
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.create.mockResolvedValue({ id: "app-1" })
  })

  const form = (jobDescription: string) => {
    const data = new FormData()
    data.set("companyName", "Global Ventures")
    data.set("jobTitle", "Data Entry")
    data.set("jobDescription", jobDescription)
    return data
  }

  it("stamps the heuristic verdict on a scam-shaped description", async () => {
    await createJobApplication(
      form(
        "Urgent requirement! Hiring immediately with unlimited earning potential. " +
          "Pay a small registration fee and message us on WhatsApp +1 555 010 2030."
      )
    )

    // The verdict describes the posting, so it lands on the `Job` row.
    const data = jobCreateData()
    expect(data.riskLevel).toBe("HIGH")
    expect(data.riskSource).toBe("HEURISTIC")
    expect(Array.isArray(data.riskReasons)).toBe(true)
    expect(data.riskReasons.length).toBeGreaterThan(0)
    expect(data.riskCheckedAt).toBeInstanceOf(Date)
  })

  it("leaves the risk columns unset for an ordinary description", async () => {
    await createJobApplication(
      form(
        "We are looking for a Senior Frontend Engineer to own our design system, " +
          "ship React and TypeScript features and work closely with design. " +
          "Requirements: 5+ years of professional frontend experience."
      )
    )

    // Nothing to say about the posting's risk: the columns stay empty on `Job`.
    expect(jobCreateData().riskLevel).toBeNull()
    expect(jobCreateData().riskSource).toBeNull()
    // The application never carries the risk columns at all now.
    expect(mockPrisma.jobApplication.create.mock.calls[0][0].data).not.toHaveProperty(
      "riskLevel"
    )
  })
})

describe("updateJobApplication requirement rescan reads the posting row", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    // Posting fields now reach the `Job` row only, so the update has to resolve
    // to a linked posting for them to be observable.
    mockPrisma.jobApplication.update.mockResolvedValue({ jobId: "job-row-1" })
    mockPrisma.job.update.mockResolvedValue({})
  })

  it("rescans against job.description when the location moves", async () => {
    // The scan inputs live on the `job` relation, not on the application.
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      job: { description: "No visa sponsorship available.", location: null },
    })
    const data = new FormData()
    data.set("location", "Manila")

    await updateJobApplication("app-1", data)

    expect(lastJobUpdateData().requirementFlags).toContain("NO_SPONSORSHIP")
    expect(lastUpdateData()).not.toHaveProperty("requirementFlags")
  })

  it("skips the rescan when neither job.description nor job.location moved", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      job: { description: "No visa sponsorship available.", location: "Manila" },
    })
    const data = new FormData()
    data.set("location", "Manila")
    data.set("notes", "call back")

    await updateJobApplication("app-1", data)

    expect(lastJobUpdateData()).not.toHaveProperty("requirementFlags")
  })
})

describe("deleteJobApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ id: "app-1" })
    mockPrisma.jobApplication.delete.mockResolvedValue({ jobId: "job-row-1" })
    mockPrisma.jobApplication.count.mockResolvedValue(0)
    mockPrisma.job.delete.mockResolvedValue({})
  })

  it("takes the posting with the last application that referenced it", async () => {
    expect(await deleteJobApplication("app-1")).toEqual({ success: true })

    expect(mockPrisma.jobApplication.delete).toHaveBeenCalledWith({
      where: { id: "app-1", userId: "user-1" },
      select: { jobId: true },
    })
    expect(mockPrisma.job.delete).toHaveBeenCalledWith({
      where: { id: "job-row-1", userId: "user-1" },
    })
  })

  it("keeps a posting a second application still tracks", async () => {
    mockPrisma.jobApplication.count.mockResolvedValue(1)

    expect(await deleteJobApplication("app-1")).toEqual({ success: true })
    expect(mockPrisma.job.delete).not.toHaveBeenCalled()
  })

  it("refuses an application that is not the caller's, touching nothing", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    expect(await deleteJobApplication("app-1")).toEqual({ error: "Not found" })
    expect(mockPrisma.jobApplication.delete).not.toHaveBeenCalled()
    expect(mockPrisma.job.delete).not.toHaveBeenCalled()
  })
})

describe("deleteJobApplications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.deleteMany.mockResolvedValue({ count: 1 })
    mockPrisma.job.deleteMany.mockResolvedValue({ count: 1 })
  })

  it("deletes the caller's rows, reports foreign ids as skipped, and revalidates", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([{ id: "app-1", jobId: "job-1" }])
      .mockResolvedValueOnce([])

    expect(await deleteJobApplications(["app-1", "foreign"])).toEqual({
      success: true,
      deletedCount: 1,
      skippedIds: ["foreign"],
    })
    expect(mockPrisma.jobApplication.findMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ["app-1", "foreign"] }, userId: "user-1" },
      select: { id: true, jobId: true },
    })
    expect(revalidatePath).toHaveBeenCalledWith("/jobs")
    expect(revalidatePath).toHaveBeenCalledWith("/workspace")
  })

  it("refuses an unauthenticated caller, touching nothing", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await deleteJobApplications(["app-1"])).toEqual({ error: "Unauthorized" })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects an empty, blank-id, or oversized selection", async () => {
    expect(await deleteJobApplications([])).toEqual({ error: "Invalid selection" })
    expect(await deleteJobApplications([""])).toEqual({ error: "Invalid selection" })
    const tooMany = Array.from({ length: 201 }, (_, i) => "app-" + i)
    expect(await deleteJobApplications(tooMany)).toEqual({ error: "Invalid selection" })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("workType write path", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The ingest helper writes the Job and the JobApplication in one
    // transaction; running the callback against the same mock keeps every
    // assertion below pointed at the real create call.
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.create.mockResolvedValue({ id: "app-1" })
    // Every application has a posting now, so the rescan's pre-read always
    // finds one — an application-only row is no longer representable.
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      job: { description: null, location: null },
    })
    mockPrisma.jobApplication.update.mockResolvedValue({ jobId: "job-row-1" })
    mockPrisma.job.update.mockResolvedValue({})
  })

  it("carries workType through create", async () => {
    const data = new FormData()
    data.set("companyName", "Acme")
    data.set("jobTitle", "Engineer")
    data.set("workType", "REMOTE")

    await createJobApplication(data)

    // `workType` describes the posting, so it is written to `Job` only.
    expect(jobCreateData().workType).toBe("REMOTE")
    expect(mockPrisma.jobApplication.create.mock.calls[0][0].data).not.toHaveProperty(
      "workType"
    )
  })

  it("clears workType to null when the cell is emptied", async () => {
    const data = new FormData()
    data.set("workType", "")

    await updateJobApplication("app-1", data)

    expect(lastJobUpdateData().workType).toBeNull()
  })

  it("leaves workType untouched when it is absent", async () => {
    const data = new FormData()
    data.set("location", "Manila")

    await updateJobApplication("app-1", data)

    expect(lastJobUpdateData()).not.toHaveProperty("workType")
  })

  it("mirrors an edited posting field onto the Job row in the same transaction", async () => {
    mockPrisma.jobApplication.update.mockResolvedValue({ jobId: "job-row-1" })
    const data = new FormData()
    data.set("jobTitle", "Staff Engineer")
    data.set("notes", "call back")

    await updateJobApplication("app-1", data)

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: { id: "job-row-1", userId: "user-1" },
      data: expect.objectContaining({ title: "Staff Engineer" }),
    })
    // The decision-side field stays off the posting.
    expect(mockPrisma.job.update.mock.calls[0][0].data).not.toHaveProperty("notes")
  })
})

describe("selectJobApplicationResume", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.update.mockResolvedValue({})
  })

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await selectJobApplicationResume("app-1", "resume-1")).toEqual({
      error: "Unauthorized",
    })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("scopes the application lookup to the session user", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    expect(await selectJobApplicationResume("app-1", "resume-1")).toEqual({
      error: "Not found",
    })
    expect(mockPrisma.jobApplication.findUnique.mock.calls[0][0].where).toEqual({
      id: "app-1",
      userId: "user-1",
    })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("refuses a resume that does not belong to the same user", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ id: "app-1" })
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    expect(await selectJobApplicationResume("app-1", "someone-elses")).toEqual({
      error: "Resume not found",
    })
    expect(mockPrisma.resume.findUnique.mock.calls[0][0].where).toEqual({
      id: "someone-elses",
      userId: "user-1",
    })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("persists an owned resume", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ id: "app-1" })
    mockPrisma.resume.findUnique.mockResolvedValue({ id: "resume-1" })

    expect(await selectJobApplicationResume("app-1", "resume-1")).toMatchObject({
      success: true,
    })
    expect(lastUpdateData()).toEqual({ resumeId: "resume-1" })
  })

  it("clears the choice without looking a resume up", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ id: "app-1" })

    expect(await selectJobApplicationResume("app-1", null)).toMatchObject({
      success: true,
    })
    expect(mockPrisma.resume.findUnique).not.toHaveBeenCalled()
    expect(lastUpdateData()).toEqual({ resumeId: null })
  })
})

describe("scheduleJobApplicationFollowUp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.update.mockResolvedValue({})
  })

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await scheduleJobApplicationFollowUp("app-1")).toEqual({
      error: "Unauthorized",
    })
  })

  it("scopes the lookup to the session user", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    expect(await scheduleJobApplicationFollowUp("app-1")).toEqual({
      error: "Not found",
    })
    expect(mockPrisma.jobApplication.findUnique.mock.calls[0][0].where).toEqual({
      id: "app-1",
      userId: "user-1",
    })
  })

  it("refuses an application that has not been sent yet", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.INTERESTED,
    })

    expect(await scheduleJobApplicationFollowUp("app-1")).toEqual({
      error: "This application is not waiting on a reply",
    })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("refuses a closed application", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.REJECTED,
    })

    expect(await scheduleJobApplicationFollowUp("app-1")).toMatchObject({
      error: expect.any(String),
    })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("sets followUpAt seven days out for a live application", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.SCREENING,
    })

    const result = await scheduleJobApplicationFollowUp("app-1")

    expect(result).toMatchObject({ success: true })
    // A calendar date, so it lands on the day's UTC midnight rather than
    // carrying the time of day the request happened to arrive at.
    expect(lastUpdateData().followUpAt.toISOString()).toBe(
      "2026-03-08T00:00:00.000Z"
    )
    vi.useRealTimers()
  })

  it("counts the seven days from the caller's own calendar day", async () => {
    vi.useFakeTimers()
    // 07:00 on 9 Sep in UTC+8 — the server instant is still 8 Sep.
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.SCREENING,
    })

    await scheduleJobApplicationFollowUp("app-1", "2026-09-09")

    expect(lastUpdateData().followUpAt.toISOString()).toBe(
      "2026-09-16T00:00:00.000Z"
    )
    vi.useRealTimers()
  })

  it("falls back to the UTC day when the client date is unusable", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.SCREENING,
    })

    await scheduleJobApplicationFollowUp("app-1", "2026-02-31")

    expect(lastUpdateData().followUpAt.toISOString()).toBe(
      "2026-09-15T00:00:00.000Z"
    )
    vi.useRealTimers()
  })

  it("revalidates the workspace alongside the job pages", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.SCREENING,
    })

    await scheduleJobApplicationFollowUp("app-1")

    const paths = vi.mocked(revalidatePath).mock.calls.map((call) => call[0])
    expect(paths).toEqual(
      expect.arrayContaining(["/jobs", "/jobs/app-1", "/workspace"]),
    )
  })
})

describe("snoozeJobApplicationFollowUp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.update.mockResolvedValue({})
  })

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await snoozeJobApplicationFollowUp("app-1")).toEqual({
      error: "Unauthorized",
    })
  })

  it("scopes the lookup to the session user", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    expect(await snoozeJobApplicationFollowUp("app-1")).toEqual({
      error: "Not found",
    })
    expect(mockPrisma.jobApplication.findUnique.mock.calls[0][0].where).toEqual({
      id: "app-1",
      userId: "user-1",
    })
  })

  it("refuses a closed application", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.REJECTED,
      followUpAt: new Date("2026-09-01T00:00:00.000Z"),
    })

    expect(await snoozeJobApplicationFollowUp("app-1")).toEqual({
      error: "This application is not waiting on a reply",
    })
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("counts a week from today when the follow-up has already gone", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.APPLIED,
      followUpAt: new Date("2026-09-01T00:00:00.000Z"),
    })

    const result = await snoozeJobApplicationFollowUp("app-1")

    expect(result).toMatchObject({ success: true })
    expect(lastUpdateData().followUpAt.toISOString()).toBe(
      "2026-09-21T00:00:00.000Z"
    )
    vi.useRealTimers()
  })

  it("adds the week to a follow-up that is still ahead", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.INTERVIEW,
      followUpAt: new Date("2026-09-20T00:00:00.000Z"),
    })

    await snoozeJobApplicationFollowUp("app-1")

    expect(lastUpdateData().followUpAt.toISOString()).toBe(
      "2026-09-27T00:00:00.000Z"
    )
    vi.useRealTimers()
  })

  it("behaves like scheduling one when no follow-up is set", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.APPLIED,
      followUpAt: null,
    })

    await snoozeJobApplicationFollowUp("app-1")

    expect(lastUpdateData().followUpAt.toISOString()).toBe(
      "2026-09-21T00:00:00.000Z"
    )
    vi.useRealTimers()
  })

  it("counts the week from the caller's own calendar day", async () => {
    vi.useFakeTimers()
    // 07:00 on 9 Sep in UTC+8 — the server instant is still 8 Sep.
    vi.setSystemTime(new Date("2026-09-08T23:00:00.000Z"))
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.APPLIED,
      followUpAt: new Date("2026-09-05T00:00:00.000Z"),
    })

    await snoozeJobApplicationFollowUp("app-1", "2026-09-09")

    expect(lastUpdateData().followUpAt.toISOString()).toBe(
      "2026-09-16T00:00:00.000Z"
    )
    vi.useRealTimers()
  })

  it("revalidates the workspace alongside the job pages", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: ApplicationStatus.APPLIED,
      followUpAt: null,
    })

    await snoozeJobApplicationFollowUp("app-1")

    const paths = vi.mocked(revalidatePath).mock.calls.map((call) => call[0])
    expect(paths).toEqual(
      expect.arrayContaining(["/jobs", "/jobs/app-1", "/workspace"]),
    )
  })
})

describe("createJobApplication duplicate detection", () => {
  /**
   * The action runs the real dedupe service, so both questions it asks arrive
   * as `job.findFirst` calls: the URL match carries an `OR`, the name match
   * carries `companyName`, and naming an already-found posting carries `id`.
   */
  function routeFindFirst(matches: {
    byUrl?: unknown
    byName?: unknown
    named?: unknown
  }) {
    mockPrisma.job.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.OR) return Promise.resolve(matches.byUrl ?? null)
        if (where.companyName) return Promise.resolve(matches.byName ?? null)
        return Promise.resolve(matches.named ?? null)
      }
    )
  }

  const form = (jobLink?: string) => {
    const data = new FormData()
    data.set("companyName", "Yngen Datacom Corp.")
    data.set("jobTitle", "IT Network Help Desk")
    data.set("status", ApplicationStatus.INTERESTED)
    if (jobLink) data.set("jobLink", jobLink)
    return data
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
    mockPrisma.jobApplication.create.mockResolvedValue({ id: "app-1" })
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    routeFindFirst({})
  })

  it("refuses the create when the same posting URL is already tracked", async () => {
    routeFindFirst({
      byUrl: { id: "job-1", applications: [{ id: "app-9" }] },
      named: { companyName: "Yngen Datacom Corp.", title: "IT Network Help Desk" },
    })

    const result = await createJobApplication(form("https://boards.example.com/jobs/1"))

    expect(result).toMatchObject({
      code: "DUPLICATE",
      existing: {
        jobId: "job-1",
        applicationId: "app-9",
        companyName: "Yngen Datacom Corp.",
        title: "IT Network Help Desk",
      },
    })
    expect(mockPrisma.job.create).not.toHaveBeenCalled()
  })

  it("warns but does not block when only the company and title match", async () => {
    routeFindFirst({
      byName: {
        id: "job-2",
        companyName: "yngen datacom corp.",
        title: "it network help desk",
        applications: [{ id: "app-8" }],
      },
    })

    const result = await createJobApplication(form())

    expect(result).toMatchObject({
      code: "POSSIBLE_DUPLICATE",
      existing: { jobId: "job-2", applicationId: "app-8" },
    })
    expect(mockPrisma.job.create).not.toHaveBeenCalled()
  })

  it("creates anyway when the name warning is forced through", async () => {
    routeFindFirst({
      byName: {
        id: "job-2",
        companyName: "Yngen Datacom Corp.",
        title: "IT Network Help Desk",
        applications: [{ id: "app-8" }],
      },
    })

    const result = await createJobApplication(form(), { force: true })

    expect(result).toMatchObject({ success: true, id: "app-1" })
    expect(mockPrisma.job.create).toHaveBeenCalled()
  })

  it("still refuses a URL duplicate even when forced", async () => {
    routeFindFirst({
      byUrl: { id: "job-1", applications: [{ id: "app-9" }] },
      named: { companyName: "Yngen Datacom Corp.", title: "IT Network Help Desk" },
    })

    const result = await createJobApplication(
      form("https://boards.example.com/jobs/1"),
      { force: true }
    )

    expect(result).toMatchObject({ code: "DUPLICATE" })
    expect(mockPrisma.job.create).not.toHaveBeenCalled()
  })

  it("stores the canonical URL on a manual create so the next add dedupes", async () => {
    const result = await createJobApplication(
      form("https://www.Example.com/jobs/1?utm_source=x&b=2")
    )

    expect(result).toMatchObject({ success: true, id: "app-1" })
    expect(jobCreateData()).toMatchObject({
      url: "https://www.Example.com/jobs/1?utm_source=x&b=2",
      canonicalUrl: "https://example.com/jobs/1?b=2",
    })
  })

  it("leaves canonicalUrl null when the entry has no link", async () => {
    await createJobApplication(form())

    expect(jobCreateData().canonicalUrl).toBeNull()
  })
})

describe("updateJobApplication link edits", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: "app-1",
      jobId: "job-row-1",
      job: { description: null, location: null },
    })
    mockPrisma.jobApplication.update.mockResolvedValue({ jobId: "job-row-1" })
    mockPrisma.job.update.mockResolvedValue({})
  })

  it("refuses a link that already belongs to another posting, without writing", async () => {
    // The pre-check, not the unique key: the stored row is keyed on the click-
    // source spelling, so nothing would have collided at write time.
    mockPrisma.job.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        where.OR
          ? Promise.resolve({ id: "job-row-9", applications: [{ id: "app-9" }] })
          : Promise.resolve({ companyName: "Acme", title: "Engineer" })
    )

    const data = new FormData()
    data.set("jobLink", "https://example.com/jobs/7")

    const result = await updateJobApplication("app-1", data)

    expect(result).toMatchObject({
      code: "DUPLICATE",
      existing: { jobId: "job-row-9", applicationId: "app-9" },
    })
    expect(mockPrisma.job.update).not.toHaveBeenCalled()
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled()
  })

  it("does not treat the posting being edited as its own duplicate", async () => {
    mockPrisma.job.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        where.OR
          ? Promise.resolve({ id: "job-row-1", applications: [{ id: "app-1" }] })
          : Promise.resolve({ companyName: "Acme", title: "Engineer" })
    )

    const data = new FormData()
    data.set("jobLink", "https://example.com/jobs/7?gclid=search")

    const result = await updateJobApplication("app-1", data)

    expect(result).toMatchObject({ success: true })
    expect(lastJobUpdateData()).toMatchObject({
      canonicalUrl: "https://example.com/jobs/7",
    })
  })

  it("moves the dedupe key with the link the user edited", async () => {
    const data = new FormData()
    data.set("jobLink", "https://www.Example.com/jobs/7?utm_source=x")

    const result = await updateJobApplication("app-1", data)

    expect(result).toMatchObject({ success: true })
    expect(lastJobUpdateData()).toMatchObject({
      url: "https://www.Example.com/jobs/7?utm_source=x",
      canonicalUrl: "https://example.com/jobs/7",
    })
  })

  it("reports the posting the edited link collides with instead of failing", async () => {
    mockPrisma.job.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: ["userId", "canonicalUrl"] },
      })
    )
    mockPrisma.job.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        where.OR
          ? Promise.resolve({ id: "job-1", applications: [{ id: "app-9" }] })
          : Promise.resolve({ companyName: "Acme", title: "Engineer" })
    )

    const data = new FormData()
    data.set("jobLink", "https://example.com/jobs/7")

    const result = await updateJobApplication("app-1", data)

    expect(result).toMatchObject({
      code: "DUPLICATE",
      existing: {
        jobId: "job-1",
        applicationId: "app-9",
        companyName: "Acme",
        title: "Engineer",
      },
    })
  })
})
