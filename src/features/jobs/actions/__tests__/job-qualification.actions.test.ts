import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockUpdate, mockRevalidate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    jobApplication: { findUnique: vi.fn() },
    careerProfile: { findUnique: vi.fn() },
  },
  mockUpdate: vi.fn(),
  mockRevalidate: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }))
vi.mock("../../services/job-record.service", () => ({
  updateJobApplicationWithJob: mockUpdate,
}))

import { recheckJobQualification } from "../job-qualification.actions"

const APPLICATION = {
  id: "app-1",
  job: {
    title: "Junior Web Developer",
    companyName: "Acme",
    description: "We are hiring a junior web developer to build React apps.",
    location: "Remote — Philippines",
    workType: "REMOTE",
    url: "https://acme.example/jobs/1",
    canonicalUrl: "https://acme.example/jobs/1",
  },
}

const PROFILE = {
  locations: ["Philippines"],
  openToRelocation: false,
  workModes: ["REMOTE"],
  requiresSponsorship: false,
  experienceLevel: "JUNIOR",
  targetRoles: [{ title: "Web Developer", active: true }],
  capabilities: [{ name: "React", confirmed: true }],
}

/** The `data` handed to the paired application/posting write. */
function lastWriteData() {
  return mockUpdate.mock.calls.at(-1)?.[1]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockPrisma.jobApplication.findUnique.mockResolvedValue(APPLICATION)
  mockPrisma.careerProfile.findUnique.mockResolvedValue(PROFILE)
  mockUpdate.mockResolvedValue(undefined)
})

describe("recheckJobQualification", () => {
  it("errors without touching the database when there is no session", async () => {
    mockAuth.mockResolvedValue(null)

    const result = await recheckJobQualification("app-1")

    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockPrisma.jobApplication.findUnique).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("scopes the read to the signed-in user and refuses someone else's row", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    const result = await recheckJobQualification("app-1")

    expect(result).toEqual({ error: "Job application not found" })
    expect(mockPrisma.jobApplication.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "app-1", userId: "user-1" } })
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("writes a fresh snapshot onto the posting and returns the verdict", async () => {
    const result = await recheckJobQualification("app-1")

    expect(result).toMatchObject({ success: true })
    if (!("success" in result)) throw new Error("expected success")

    const snapshot = lastWriteData()?.qualification
    expect(snapshot).toBeTruthy()
    expect(snapshot.verdict).toBe(result.verdict)
    // `checkedAt` is stamped now, not carried over from the old snapshot.
    expect(snapshot.checkedAt).toBe(result.checkedAt)
    expect(Date.parse(snapshot.checkedAt)).not.toBeNaN()
    expect(snapshot.match).toBeTruthy()
    expect(snapshot.eligible).toBeTruthy()

    // The write is owner-scoped and nothing about the application's own
    // decision fields (status, dates, resume) is in the payload.
    expect(mockUpdate).toHaveBeenCalledWith(
      { id: "app-1", userId: "user-1" },
      { qualification: expect.anything() }
    )
    expect(Object.keys(lastWriteData())).toEqual(["qualification"])
  })

  it("revalidates the three surfaces that render a verdict", async () => {
    await recheckJobQualification("app-1")

    expect(mockRevalidate).toHaveBeenCalledWith("/jobs/app-1")
    expect(mockRevalidate).toHaveBeenCalledWith("/jobs")
    expect(mockRevalidate).toHaveBeenCalledWith("/dashboard")
  })

  it("still produces a snapshot for a job with no description", async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      ...APPLICATION,
      job: { ...APPLICATION.job, description: null, location: null, workType: null },
    })

    const result = await recheckJobQualification("app-1")

    expect(result).toMatchObject({ success: true })
    expect(lastWriteData()?.qualification.verdict).toBeTruthy()
  })

  it("asks for a Career Profile rather than writing an empty verdict", async () => {
    mockPrisma.careerProfile.findUnique.mockResolvedValue(null)

    const result = await recheckJobQualification("app-1")

    expect(result).toEqual({
      error: "Add your Career Profile first — the check is run against it.",
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("reports a generic failure when the write throws", async () => {
    mockUpdate.mockRejectedValue(new Error("db down"))

    const result = await recheckJobQualification("app-1")

    expect(result).toEqual({ error: "Something went wrong. Please try again." })
  })
})
