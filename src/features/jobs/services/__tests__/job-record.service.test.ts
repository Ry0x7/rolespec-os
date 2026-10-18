import { describe, it, expect, beforeEach, vi } from "vitest"

import { ApplicationStatus, JobRiskLevel, JobSource, WorkType } from "@/generated/prisma/enums"

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    job: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    jobApplication: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import { Prisma } from "@/generated/prisma/client"

import {
  BULK_DELETE_MAX_IDS,
  createJobApplicationWithJob,
  deleteJobApplicationsWithJobs,
  deleteJobApplicationWithJob,
  findExistingJob,
  jobDataFromApplication,
  jobUpdateFromApplicationUpdate,
  updateJobApplicationWithJob,
} from "../job-record.service"

/**
 * The unique violation Postgres raises on `(userId, canonicalUrl)`, in the
 * shape `@prisma/adapter-pg` actually produces — captured from the live
 * database, where `meta.target` is absent entirely.
 */
function canonicalUrlConflict() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: {
      modelName: "Job",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          kind: "UniqueConstraintViolation",
          constraint: { fields: ['"userId"', '"canonicalUrl"'] },
        },
      },
    },
  })
}

function applicationInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    companyName: "Acme",
    jobTitle: "Frontend Engineer",
    jobLink: "https://example.com/jobs/1",
    jobDescription: "Build things.",
    location: "Remote",
    workType: WorkType.REMOTE,
    status: ApplicationStatus.INTERESTED,
    source: JobSource.DISCOVERY,
    sourceProvider: "remotive",
    externalId: "1",
    canonicalUrl: "https://example.com/jobs/1",
    ...overrides,
  }
}

describe("jobDataFromApplication", () => {
  it("renames the job* columns onto the posting's own vocabulary", () => {
    const job = jobDataFromApplication(applicationInput())

    expect(job).toMatchObject({
      userId: "user-1",
      companyName: "Acme",
      title: "Frontend Engineer",
      url: "https://example.com/jobs/1",
      description: "Build things.",
      location: "Remote",
      workType: WorkType.REMOTE,
    })
  })

  it("carries provenance and posting-derived enrichment across", () => {
    const checkedAt = new Date("2026-01-01")
    const job = jobDataFromApplication(
      applicationInput({
        riskLevel: JobRiskLevel.HIGH,
        riskReasons: ["Asks for payment"],
        riskCheckedAt: checkedAt,
        requirementFlags: ["US_ONLY"],
      })
    )

    expect(job).toMatchObject({
      source: JobSource.DISCOVERY,
      sourceProvider: "remotive",
      externalId: "1",
      canonicalUrl: "https://example.com/jobs/1",
      riskLevel: JobRiskLevel.HIGH,
      riskReasons: ["Asks for payment"],
      riskCheckedAt: checkedAt,
      requirementFlags: ["US_ONLY"],
    })
  })

  it("does not copy anything that describes the user's decision, not the posting", () => {
    const job = jobDataFromApplication(
      applicationInput({
        notes: "Referred by Sam",
        dateApplied: new Date("2026-02-01"),
        matchScore: 82,
      })
    )

    for (const key of ["status", "notes", "dateApplied", "interviewDate", "matchScore"]) {
      expect(job).not.toHaveProperty(key)
    }
  })

  it("leaves a non-null column with a schema default undefined rather than null", () => {
    const job = jobDataFromApplication(applicationInput())

    expect(job.salaryCurrency).toBeUndefined()
    expect(job.source).toBe(JobSource.DISCOVERY)
  })
})

describe("createJobApplicationWithJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
    mockPrisma.jobApplication.create.mockResolvedValue({ id: "app-1" })
  })

  it("writes the posting first and links the application to it", async () => {
    const result = await createJobApplicationWithJob(applicationInput())

    expect(result).toEqual({ id: "app-1", duplicate: false })
    expect(mockPrisma.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", title: "Frontend Engineer" }),
      select: { id: true },
    })
    expect(mockPrisma.jobApplication.create.mock.calls[0][0].data).toMatchObject({
      jobId: "job-row-1",
      userId: "user-1",
      status: ApplicationStatus.INTERESTED,
    })
  })

  it("no longer writes the posting columns onto the application", async () => {
    await createJobApplicationWithJob(
      applicationInput({ salary: 120000, riskLevel: JobRiskLevel.HIGH })
    )

    const data = mockPrisma.jobApplication.create.mock.calls[0][0].data
    for (const field of [
      "jobLink",
      "jobDescription",
      "canonicalUrl",
      "location",
      "workType",
      "salary",
      "riskLevel",
      "source",
      "sourceProvider",
      "externalId",
    ]) {
      expect(data).not.toHaveProperty(field)
    }
  })

  it("sends no company or title on the application half — the posting owns them", async () => {
    await createJobApplicationWithJob(applicationInput())

    const data = mockPrisma.jobApplication.create.mock.calls[0][0].data
    expect(data).not.toHaveProperty("companyName")
    expect(data).not.toHaveProperty("jobTitle")
    expect(mockPrisma.job.create.mock.calls[0][0].data).toMatchObject({
      companyName: "Acme",
      title: "Frontend Engineer",
    })
  })

  it("keeps the decision-side fields on the application", async () => {
    const dateApplied = new Date("2026-02-01")
    await createJobApplicationWithJob(
      applicationInput({ notes: "Referred by Sam", dateApplied, contact: "talent@acme.example" })
    )

    expect(mockPrisma.jobApplication.create.mock.calls[0][0].data).toMatchObject({
      notes: "Referred by Sam",
      dateApplied,
      contact: "talent@acme.example",
    })
  })

  it("does both writes in one transaction, so an application never exists without its posting", async () => {
    await createJobApplicationWithJob(applicationInput())

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe("jobUpdateFromApplicationUpdate", () => {
  it("renames the mirrored posting fields and carries explicit nulls through", () => {
    const job = jobUpdateFromApplicationUpdate({
      jobTitle: "Staff Engineer",
      companyName: "Acme",
      jobLink: null,
      jobDescription: "New description.",
      salary: null,
      requirementFlags: Prisma.DbNull,
    })

    expect(job).toEqual({
      title: "Staff Engineer",
      companyName: "Acme",
      url: null,
      // Derived from the link, so clearing one clears the other.
      canonicalUrl: null,
      description: "New description.",
      salary: null,
      requirementFlags: Prisma.DbNull,
    })
  })

  it("leaves absent fields absent and drops everything that describes the user's decision", () => {
    const job = jobUpdateFromApplicationUpdate({
      status: ApplicationStatus.APPLIED,
      notes: "Referred by Sam",
      dateApplied: new Date("2026-02-01"),
      interviewDate: new Date("2026-02-10"),
      contact: "talent@acme.example",
      matchScore: 82,
      riskLevel: JobRiskLevel.HIGH,
    })

    expect(job).toEqual({ riskLevel: JobRiskLevel.HIGH })
  })
})

describe("updateJobApplicationWithJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.jobApplication.update.mockResolvedValue({ jobId: "job-row-1" })
    mockPrisma.job.update.mockResolvedValue({})
  })

  it("updates the application and its posting in one transaction, scoped to the user", async () => {
    await updateJobApplicationWithJob(
      { id: "app-1", userId: "user-1" },
      { jobTitle: "Staff Engineer", notes: "call back" }
    )

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    // The posting half of the edit is stripped from the application write.
    expect(mockPrisma.jobApplication.update).toHaveBeenCalledWith({
      where: { id: "app-1", userId: "user-1" },
      data: { notes: "call back" },
      select: { jobId: true },
    })
    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: { id: "job-row-1", userId: "user-1" },
      data: { title: "Staff Engineer" },
    })
  })

  it("strips every posting field from the application write while still projecting them", async () => {
    await updateJobApplicationWithJob(
      { id: "app-1", userId: "user-1" },
      {
        companyName: "Acme",
        jobTitle: "Staff Engineer",
        jobLink: null,
        jobDescription: "New description.",
        location: "Remote",
        salary: 120000,
        riskLevel: JobRiskLevel.HIGH,
        requirementFlags: Prisma.DbNull,
        status: ApplicationStatus.APPLIED,
      }
    )

    expect(mockPrisma.jobApplication.update.mock.calls[0][0].data).toEqual({
      status: ApplicationStatus.APPLIED,
    })
    expect(mockPrisma.job.update.mock.calls[0][0].data).toEqual({
      companyName: "Acme",
      title: "Staff Engineer",
      url: null,
      // Clearing the link clears the key derived from it.
      canonicalUrl: null,
      description: "New description.",
      location: "Remote",
      salary: 120000,
      riskLevel: JobRiskLevel.HIGH,
      requirementFlags: Prisma.DbNull,
    })
  })

  it("still runs the application update when the strip leaves nothing, keeping the ownership check", async () => {
    await updateJobApplicationWithJob(
      { id: "app-1", userId: "user-1" },
      { jobTitle: "Staff Engineer" }
    )

    expect(mockPrisma.jobApplication.update).toHaveBeenCalledWith({
      where: { id: "app-1", userId: "user-1" },
      data: {},
      select: { jobId: true },
    })
    expect(mockPrisma.job.update).toHaveBeenCalledTimes(1)
  })

  it("skips the posting write when nothing in the update describes the posting", async () => {
    await updateJobApplicationWithJob(
      { id: "app-1", userId: "user-1" },
      { status: ApplicationStatus.APPLIED, notes: "sent" }
    )

    expect(mockPrisma.jobApplication.update).toHaveBeenCalledTimes(1)
    expect(mockPrisma.job.update).not.toHaveBeenCalled()
  })

  it("writes the posting the application actually points at, not one derived from its id", async () => {
    mockPrisma.jobApplication.update.mockResolvedValue({ jobId: "shared-job-9" })

    await updateJobApplicationWithJob(
      { id: "app-1", userId: "user-1" },
      { jobTitle: "Staff Engineer" }
    )

    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: { id: "shared-job-9", userId: "user-1" },
      data: { title: "Staff Engineer" },
    })
  })
})

describe("deleteJobApplicationWithJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.jobApplication.delete.mockResolvedValue({ jobId: "job-row-1" })
    mockPrisma.jobApplication.count.mockResolvedValue(0)
    mockPrisma.job.delete.mockResolvedValue({})
  })

  it("deletes the posting with the last application that referenced it", async () => {
    await deleteJobApplicationWithJob({ id: "app-1", userId: "user-1" })

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.jobApplication.delete).toHaveBeenCalledWith({
      where: { id: "app-1", userId: "user-1" },
      select: { jobId: true },
    })
    expect(mockPrisma.jobApplication.count).toHaveBeenCalledWith({
      where: { jobId: "job-row-1", userId: "user-1" },
    })
    expect(mockPrisma.job.delete).toHaveBeenCalledWith({
      where: { id: "job-row-1", userId: "user-1" },
    })
  })

  it("leaves a posting another application still tracks alone", async () => {
    mockPrisma.jobApplication.count.mockResolvedValue(1)

    await deleteJobApplicationWithJob({ id: "app-1", userId: "user-1" })

    expect(mockPrisma.jobApplication.delete).toHaveBeenCalledTimes(1)
    expect(mockPrisma.job.delete).not.toHaveBeenCalled()
  })

  it("counts and deletes against the posting the deleted row pointed at", async () => {
    mockPrisma.jobApplication.delete.mockResolvedValue({ jobId: "shared-job-9" })

    await deleteJobApplicationWithJob({ id: "app-1", userId: "user-1" })

    expect(mockPrisma.jobApplication.count).toHaveBeenCalledWith({
      where: { jobId: "shared-job-9", userId: "user-1" },
    })
    expect(mockPrisma.job.delete).toHaveBeenCalledWith({
      where: { id: "shared-job-9", userId: "user-1" },
    })
  })
})

describe("deleteJobApplicationsWithJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.jobApplication.deleteMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) => Promise.resolve({ count: where.id.in.length })
    )
    mockPrisma.job.deleteMany.mockResolvedValue({ count: 0 })
  })

  it("deletes owned rows and the postings they leave orphaned", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        { id: "app-1", jobId: "job-1" },
        { id: "app-2", jobId: "job-2" },
      ])
      .mockResolvedValueOnce([])

    const result = await deleteJobApplicationsWithJobs("user-1", ["app-1", "app-2"])

    expect(result).toEqual({ deletedCount: 2, skippedIds: [] })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.jobApplication.findMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ["app-1", "app-2"] }, userId: "user-1" },
      select: { id: true, jobId: true },
    })
    expect(mockPrisma.jobApplication.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["app-1", "app-2"] }, userId: "user-1" },
    })
    expect(mockPrisma.jobApplication.findMany).toHaveBeenNthCalledWith(2, {
      where: { jobId: { in: ["job-1", "job-2"] }, userId: "user-1" },
      select: { jobId: true },
    })
    expect(mockPrisma.job.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["job-1", "job-2"] }, userId: "user-1" },
    })
  })

  it("keeps a posting another application still tracks", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([
        { id: "app-1", jobId: "job-1" },
        { id: "app-2", jobId: "shared-job" },
      ])
      .mockResolvedValueOnce([{ jobId: "shared-job" }])

    await deleteJobApplicationsWithJobs("user-1", ["app-1", "app-2"])

    expect(mockPrisma.job.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["job-1"] }, userId: "user-1" },
    })
  })

  it("skips ids owned by another user and never deletes them", async () => {
    // The ownership read is scoped to the caller, so the foreign row is absent.
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([{ id: "app-1", jobId: "job-1" }])
      .mockResolvedValueOnce([])

    const result = await deleteJobApplicationsWithJobs("user-1", ["app-1", "foreign-1"])

    expect(result).toEqual({ deletedCount: 1, skippedIds: ["foreign-1"] })
    expect(mockPrisma.jobApplication.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["app-1"] }, userId: "user-1" },
    })
  })

  it("writes nothing when none of the ids belong to the caller", async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValueOnce([])

    const result = await deleteJobApplicationsWithJobs("user-1", ["foreign-1", "foreign-2"])

    expect(result).toEqual({ deletedCount: 0, skippedIds: ["foreign-1", "foreign-2"] })
    expect(mockPrisma.jobApplication.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.job.deleteMany).not.toHaveBeenCalled()
  })

  it("dedupes repeated ids", async () => {
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([{ id: "app-1", jobId: "job-1" }])
      .mockResolvedValueOnce([])

    const result = await deleteJobApplicationsWithJobs("user-1", ["app-1", "app-1", "app-1"])

    expect(result).toEqual({ deletedCount: 1, skippedIds: [] })
    expect(mockPrisma.jobApplication.findMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ["app-1"] }, userId: "user-1" },
      select: { id: true, jobId: true },
    })
  })

  it("returns zero without touching the database for an empty list", async () => {
    const result = await deleteJobApplicationsWithJobs("user-1", [])

    expect(result).toEqual({ deletedCount: 0, skippedIds: [] })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockPrisma.jobApplication.findMany).not.toHaveBeenCalled()
  })

  it("throws above the per-call cap", async () => {
    const ids = Array.from({ length: BULK_DELETE_MAX_IDS + 1 }, (_, i) => "app-" + i)

    await expect(deleteJobApplicationsWithJobs("user-1", ids)).rejects.toThrow(/more than 200/)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("findExistingJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
    mockPrisma.jobApplication.create.mockResolvedValue({ id: "app-1" })
  })

  it("matches on canonical URL, raw link and provider id, scoped to the user", async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null)

    await findExistingJob({
      userId: "user-1",
      canonicalUrl: "https://example.com/jobs/1",
      url: "https://example.com/jobs/1?utm_source=x",
      sourceProvider: "remotive",
      externalId: "1",
    })

    expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { canonicalUrl: "https://example.com/jobs/1" },
          { url: "https://example.com/jobs/1?utm_source=x" },
          { sourceProvider: "remotive", externalId: "1" },
        ],
      },
      select: {
        id: true,
        applications: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    })
  })

  it("needs both halves of the provider key before it will match on them", async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null)

    await findExistingJob({ userId: "user-1", url: "https://example.com/jobs/1", sourceProvider: "remotive" })

    expect(mockPrisma.job.findFirst.mock.calls[0][0].where.OR).toEqual([
      { url: "https://example.com/jobs/1" },
    ])
  })

  it("is never a duplicate when there is nothing to match on, and asks the database nothing", async () => {
    expect(await findExistingJob({ userId: "user-1" })).toBeNull()
    expect(mockPrisma.job.findFirst).not.toHaveBeenCalled()
  })

  it("returns the oldest application, or null when the posting has none left", async () => {
    mockPrisma.job.findFirst.mockResolvedValue({ id: "job-row-1", applications: [{ id: "app-1" }] })
    expect(await findExistingJob({ userId: "user-1", canonicalUrl: "u" })).toEqual({
      jobId: "job-row-1",
      applicationId: "app-1",
    })

    mockPrisma.job.findFirst.mockResolvedValue({ id: "job-row-1", applications: [] })
    expect(await findExistingJob({ userId: "user-1", canonicalUrl: "u" })).toEqual({
      jobId: "job-row-1",
      applicationId: null,
    })
  })
})

describe("createJobApplicationWithJob under the unique posting key", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
    mockPrisma.jobApplication.create.mockResolvedValue({ id: "app-1" })
  })

  it("resolves a lost race onto the winner's application instead of failing", async () => {
    mockPrisma.job.create.mockRejectedValue(canonicalUrlConflict())
    mockPrisma.job.findFirst.mockResolvedValue({
      id: "job-row-winner",
      applications: [{ id: "app-winner" }],
    })

    expect(await createJobApplicationWithJob(applicationInput())).toEqual({
      id: "app-winner",
      duplicate: true,
    })
    expect(mockPrisma.jobApplication.create).not.toHaveBeenCalled()
  })

  it("reuses a posting whose application was deleted rather than orphaning a second one", async () => {
    mockPrisma.job.create.mockRejectedValue(canonicalUrlConflict())
    mockPrisma.job.findFirst.mockResolvedValue({ id: "job-row-orphan", applications: [] })

    expect(await createJobApplicationWithJob(applicationInput())).toEqual({
      id: "app-1",
      duplicate: false,
    })
    expect(mockPrisma.jobApplication.create.mock.calls[0][0].data).toMatchObject({
      jobId: "job-row-orphan",
    })
  })

  it("retries once when the conflicting posting has vanished, then gives up", async () => {
    mockPrisma.job.create.mockRejectedValue(canonicalUrlConflict())
    mockPrisma.job.findFirst.mockResolvedValue(null)

    await expect(createJobApplicationWithJob(applicationInput())).rejects.toMatchObject({
      code: "P2002",
    })
    expect(mockPrisma.job.create).toHaveBeenCalledTimes(2)
  })

  it("also recognises the classic `meta.target` shape", async () => {
    mockPrisma.job.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["userId", "canonicalUrl"] },
      })
    )
    mockPrisma.job.findFirst.mockResolvedValue({
      id: "job-row-winner",
      applications: [{ id: "app-winner" }],
    })

    expect(await createJobApplicationWithJob(applicationInput())).toEqual({
      id: "app-winner",
      duplicate: true,
    })
  })

  it("does not swallow a unique violation on some other key", async () => {
    mockPrisma.job.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["externalId"] },
      })
    )

    await expect(createJobApplicationWithJob(applicationInput())).rejects.toMatchObject({
      code: "P2002",
    })
    expect(mockPrisma.job.findFirst).not.toHaveBeenCalled()
  })
})
