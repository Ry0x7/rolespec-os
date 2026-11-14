import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    jobApplication: { findFirst: vi.fn() },
  },
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import { getJobDescriptionForResume } from "../get-job-description"
import { MAX_ATS_JOB_DESCRIPTION_LENGTH } from "../../constants/ats"

describe("getJobDescriptionForResume", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.jobApplication.findFirst.mockResolvedValue({
      job: { description: "  Own the payments platform. Kubernetes required.  " },
    })
  })

  it("rejects an unauthenticated caller without touching the database", async () => {
    mockAuth.mockResolvedValue(null)

    const result = await getJobDescriptionForResume("job-1")

    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockPrisma.jobApplication.findFirst).not.toHaveBeenCalled()
  })

  it("rejects an empty id", async () => {
    const result = await getJobDescriptionForResume("")

    expect(result).toEqual({ error: "Invalid input" })
    expect(mockPrisma.jobApplication.findFirst).not.toHaveBeenCalled()
  })

  it("scopes the lookup to the session user and reports a missing job", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue(null)

    const result = await getJobDescriptionForResume("job-1")

    expect(result).toEqual({ error: "Job application not found" })
    expect(mockPrisma.jobApplication.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", userId: "user-1" } })
    )
  })

  it("reports a job that has no description saved", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue({ job: { description: "   " } })

    const result = await getJobDescriptionForResume("job-1")

    expect(result).toEqual({ error: "This job has no description saved." })
  })

  it("treats a null description as missing", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue({ job: { description: null } })

    const result = await getJobDescriptionForResume("job-1")

    expect(result).toEqual({ error: "This job has no description saved." })
  })

  it("returns the trimmed description", async () => {
    const result = await getJobDescriptionForResume("job-1")

    expect(result).toEqual({
      jobDescription: "Own the payments platform. Kubernetes required.",
    })
  })

  it("truncates to the storage/ATS limit, not the enhance limit", async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue({
      job: { description: "x".repeat(MAX_ATS_JOB_DESCRIPTION_LENGTH + 1) },
    })

    const result = await getJobDescriptionForResume("job-1")

    expect("jobDescription" in result && result.jobDescription.length).toBe(
      MAX_ATS_JOB_DESCRIPTION_LENGTH
    )
  })
})
