import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockRedirect } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    mockPrisma: {
      resume: { findUnique: vi.fn() },
      jobApplication: { findUnique: vi.fn() },
      coverLetter: { create: vi.fn() },
      // The account-name fallback behind `resolveCandidateName`, used when the
      // resume's contact section has no `fullName`.
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    },
    mockRedirect: vi.fn(),
  })
)

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("../../services/cover-letter.service", () => ({
  serializeResumeForCoverLetter: vi.fn(),
  generateCoverLetterAI: vi.fn(),
  improveCoverLetterAI: vi.fn(),
}))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { generateCoverLetter } from "../cover-letter.actions"
import {
  serializeResumeForCoverLetter,
  generateCoverLetterAI,
} from "../../services/cover-letter.service"

const form = (
  options: { jobApplicationId?: string; jobDescription?: string | null } = {}
) => {
  const data = new FormData()
  data.set("resumeId", "resume-1")
  const description =
    options.jobDescription === undefined ? "A".repeat(50) : options.jobDescription
  if (description !== null) data.set("jobDescription", description)
  if (options.jobApplicationId) data.set("jobApplicationId", options.jobApplicationId)
  return data
}

/** Arrange the happy path: an owned resume plus a successful AI generation. */
const arrangeGenerationSucceeds = () => {
  mockPrisma.resume.findUnique.mockResolvedValue({ id: "resume-1", sections: [] })
  vi.mocked(serializeResumeForCoverLetter).mockReturnValue("resume text")
  vi.mocked(generateCoverLetterAI).mockResolvedValue({
    coverLetter: "Dear hiring manager,",
    tips: [],
  } as never)
  mockPrisma.coverLetter.create.mockResolvedValue({ id: "cl-1" })
}

describe("generateCoverLetter resume guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  })

  it("rejects an archived resume the same way as a missing one", async () => {
    // Archived (soft-deleted) rows are excluded by the where clause.
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await generateCoverLetter(form())

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resume-1", userId: "user-1", status: { not: "ARCHIVED" } },
      })
    )
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("rejects a foreign resume", async () => {
    // A resume owned by someone else is filtered out by the userId scope; the
    // linked job is the caller's own, so only the resume guard can fire.
    mockPrisma.resume.findUnique.mockResolvedValue(null)
    mockPrisma.jobApplication.findUnique.mockResolvedValue({ job: { description: null } })

    const result = await generateCoverLetter(form({ jobApplicationId: "job-1" }))

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockPrisma.coverLetter.create).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

describe("generateCoverLetter job application guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  })

  it("links an owned job application when the description was submitted", async () => {
    // Both rows belong to the caller, so the linked id is persisted.
    arrangeGenerationSucceeds()
    // The stored description now lives on the `job` relation.
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      job: { description: "B".repeat(50) },
    })

    await generateCoverLetter(form({ jobApplicationId: "job-1" }))

    expect(mockPrisma.jobApplication.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", userId: "user-1" } })
    )
    expect(mockPrisma.coverLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobApplicationId: "job-1" }),
      })
    )
    expect(mockRedirect).toHaveBeenCalledWith("/jobs/cover-letter/cl-1")
  })

  it("falls back to the description stored on the job relation", async () => {
    // The form omits the textarea when the linked job already has usable text:
    // the description is read off `job.description`, not the mirrored column.
    arrangeGenerationSucceeds()
    const stored = "C".repeat(50)
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      job: { description: stored },
    })

    await generateCoverLetter(
      form({ jobApplicationId: "job-1", jobDescription: null })
    )

    expect(generateCoverLetterAI).toHaveBeenCalledWith(
      "resume text",
      stored,
      "user-1",
      // No contact `fullName` and no account row, so the name resolves to null.
      null
    )
    expect(mockPrisma.coverLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobApplicationId: "job-1",
          jobDescription: stored,
        }),
      })
    )
    expect(mockRedirect).toHaveBeenCalledWith("/jobs/cover-letter/cl-1")
  })

  it("still generates with no job application id at all", async () => {
    // No linked job: the submitted description is the only source.
    arrangeGenerationSucceeds()

    await generateCoverLetter(form())

    expect(mockPrisma.jobApplication.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.coverLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobApplicationId: null }),
      })
    )
    expect(mockRedirect).toHaveBeenCalledWith("/jobs/cover-letter/cl-1")
  })

  it("rejects a foreign job application id even when a description was submitted", async () => {
    // The userId-scoped lookup must run regardless of the submitted description.
    arrangeGenerationSucceeds()
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    const result = await generateCoverLetter(form({ jobApplicationId: "foreign-job" }))

    expect(result).toEqual({ error: "Job application not found" })
    expect(mockPrisma.coverLetter.create).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("rejects a foreign job application id when no description was submitted", async () => {
    // Same generic rejection as above, never "job description is required".
    arrangeGenerationSucceeds()
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null)

    const result = await generateCoverLetter(
      form({ jobApplicationId: "foreign-job", jobDescription: null })
    )

    expect(result).toEqual({ error: "Job application not found" })
    expect(mockPrisma.coverLetter.create).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

describe("generateCoverLetter navigation option", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  })

  it("returns the new id instead of navigating when asked to stay put", async () => {
    arrangeGenerationSucceeds()

    const result = await generateCoverLetter(form(), { redirect: false })

    expect(result).toEqual({ id: "cl-1" })
    expect(mockPrisma.coverLetter.create).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("still redirects when the option is omitted or true", async () => {
    arrangeGenerationSucceeds()

    await generateCoverLetter(form())
    expect(mockRedirect).toHaveBeenCalledWith("/jobs/cover-letter/cl-1")

    mockRedirect.mockClear()
    await generateCoverLetter(form(), { redirect: true })
    expect(mockRedirect).toHaveBeenCalledWith("/jobs/cover-letter/cl-1")
  })

  it("reports errors the same way with the option set", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await generateCoverLetter(form(), { redirect: false })

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
