import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockRedirect, mockRevalidatePath } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    resume: { findUnique: vi.fn() },
    resumeSection: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn() },
    resumeSectionItem: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
  mockRedirect: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))

import { addResumeSection, removeResumeSection, reorderResumeSections } from "../sections"

describe("reorderResumeSections ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.$transaction.mockResolvedValue([])
    mockPrisma.resumeSection.update.mockImplementation((args: unknown) => args)
  })

  it("rejects when the resume does not belong to the caller", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await reorderResumeSections("resume-1", ["s-1", "s-2"])

    expect(result.error).toBe("Resume not found")
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    // The ownership filter must be part of the lookup, and archived
    // (soft-deleted) resumes must be excluded by it too.
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resume-1", userId: "user-1", status: { not: "ARCHIVED" } },
      })
    )
  })

  it("rejects an archived resume the same way as a missing one", async () => {
    // The status filter lives in the where clause, so an archived row simply
    // doesn't come back.
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await reorderResumeSections("resume-1", ["s-1"])

    expect(result.error).toBe("Resume not found")
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "ARCHIVED" } }),
      })
    )
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects when any section id does not belong to the resume", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      sections: [{ id: "s-1" }, { id: "s-2" }],
    })

    const result = await reorderResumeSections("resume-1", ["s-1", "someone-elses-section"])

    expect(result.error).toBe("Section not found")
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockPrisma.resumeSection.update).not.toHaveBeenCalled()
  })

  it("writes the new order when every section belongs to the resume", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      sections: [{ id: "s-1" }, { id: "s-2" }],
    })

    const result = await reorderResumeSections("resume-1", ["s-2", "s-1"])

    expect(result.error).toBeUndefined()
    expect(mockPrisma.resumeSection.update).toHaveBeenNthCalledWith(1, {
      where: { id: "s-2" },
      data: { order: 0 },
    })
    expect(mockPrisma.resumeSection.update).toHaveBeenNthCalledWith(2, {
      where: { id: "s-1" },
      data: { order: 1 },
    })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockRevalidatePath).toHaveBeenCalledWith("/resumes/resume-1")
  })
})

describe("archived resumes are treated as deleted", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  })

  it("addResumeSection rejects an archived resume", async () => {
    // The status filter is in the where clause, so the row doesn't come back.
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await addResumeSection("resume-1", "SKILLS")

    expect(result).toEqual({ id: "", error: "Resume not found" })
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resume-1", userId: "user-1", status: { not: "ARCHIVED" } },
      })
    )
  })

  it("removeResumeSection rejects a section on an archived resume", async () => {
    mockPrisma.resumeSection.findUnique.mockResolvedValue({
      id: "s-1",
      type: "SKILLS",
      resume: { userId: "user-1", status: "ARCHIVED" },
    })

    const result = await removeResumeSection("resume-1", "s-1")

    expect(result.error).toBe("Section not found")
    expect(mockPrisma.resumeSectionItem.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.resumeSection.delete).not.toHaveBeenCalled()
  })

  it("removeResumeSection still deletes a section on a live resume", async () => {
    mockPrisma.resumeSection.findUnique.mockResolvedValue({
      id: "s-1",
      type: "SKILLS",
      resume: { userId: "user-1", status: "ACTIVE" },
    })

    const result = await removeResumeSection("resume-1", "s-1")

    expect(result.error).toBeUndefined()
    expect(mockPrisma.resumeSection.delete).toHaveBeenCalledWith({ where: { id: "s-1" } })
  })
})

describe("addResumeSection order", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resumeSection.create.mockResolvedValue({ id: "s-new" })
  })

  it("places the new section after the highest existing order, not at the count", async () => {
    // Orders 0, 1, 2 with the middle one deleted leave 0 and 2 — count is 2,
    // which would collide with the last section.
    mockPrisma.resume.findUnique.mockResolvedValue({
      id: "resume-1",
      sections: [
        { id: "s-0", type: "CONTACT", order: 0 },
        { id: "s-2", type: "EXPERIENCE", order: 2 },
      ],
    })

    const result = await addResumeSection("resume-1", "SKILLS")

    expect(result).toEqual({ id: "s-new" })
    expect(mockPrisma.resumeSection.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ order: 3 }) })
    )
  })

  it("uses order 0 for the first section of an empty resume", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue({ id: "resume-1", sections: [] })

    await addResumeSection("resume-1", "SKILLS")

    expect(mockPrisma.resumeSection.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ order: 0 }) })
    )
  })
})
