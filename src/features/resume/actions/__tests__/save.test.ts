import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    resume: { findUnique: vi.fn(), update: vi.fn() },
    resumeSectionItem: {
      create: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
  mockRedirect: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))

import { saveResume } from "../save"

/** One owned section holding one owned item. */
const ownedResume = {
  id: "resume-1",
  sections: [{ id: "sec-1", items: [{ id: "item-1" }] }],
}

type SectionArg = Parameters<typeof saveResume>[1][number]

const section = (id: string, items: SectionArg["items"]): SectionArg => ({
  id,
  type: "SUMMARY",
  title: "Summary",
  order: 0,
  visible: true,
  items,
})

const item = (id: string, order = 0): SectionArg["items"][number] => ({
  id,
  content: { text: "Some content" },
  metadata: null,
  order,
})

describe("saveResume ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resume.findUnique.mockResolvedValue(ownedResume)
    mockPrisma.resume.update.mockResolvedValue({ id: "resume-1" })
    mockPrisma.resumeSectionItem.findMany.mockResolvedValue([])
    mockPrisma.resumeSectionItem.create.mockResolvedValue({ id: "created-1" })
    mockPrisma.resumeSectionItem.upsert.mockResolvedValue({ id: "item-1" })
    mockPrisma.resumeSectionItem.deleteMany.mockResolvedValue({ count: 0 })
  })

  it("rejects when the resume does not belong to the caller", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await saveResume("resume-1", [section("sec-1", [item("item-1")])])

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockPrisma.resumeSectionItem.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.resumeSectionItem.upsert).not.toHaveBeenCalled()
  })

  it("rejects an archived resume the same way as a missing one", async () => {
    // Archived (soft-deleted) rows are excluded by the where clause, so the
    // lookup returns nothing and the caller sees the not-found error.
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    const result = await saveResume("resume-1", [section("sec-1", [item("item-1")])])

    expect(result).toEqual({ error: "Resume not found" })
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resume-1", userId: "user-1", status: { not: "ARCHIVED" } },
      })
    )
    expect(mockPrisma.resume.update).not.toHaveBeenCalled()
  })

  it("rejects a section id that does not belong to the caller's resume", async () => {
    const result = await saveResume("resume-1", [
      section("someone-elses-section", [item("victim-item")]),
    ])

    expect(result).toEqual({ error: "Section not found" })
    // The vulnerability was deleteMany({ where: { sectionId } }) on a foreign
    // section — nothing may be written or deleted here.
    expect(mockPrisma.resumeSectionItem.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.resumeSectionItem.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.resumeSectionItem.create).not.toHaveBeenCalled()
    expect(mockPrisma.resume.update).not.toHaveBeenCalled()
  })

  it("rejects an item id that exists outside the caller's resume", async () => {
    // The id is not in this resume, but it does exist in the DB — i.e. it is
    // someone else's row.
    mockPrisma.resumeSectionItem.findMany.mockResolvedValue([{ id: "foreign-item" }])

    const result = await saveResume("resume-1", [section("sec-1", [item("foreign-item")])])

    expect(result).toEqual({ error: "Item not found" })
    expect(mockPrisma.resumeSectionItem.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.resumeSectionItem.deleteMany).not.toHaveBeenCalled()
  })

  it("rejects a payload that is not shaped like sections", async () => {
    const broken = [{ id: "sec-1", title: "Summary" }] as unknown as Parameters<
      typeof saveResume
    >[1]

    const result = await saveResume("resume-1", broken)

    expect(result.error).toBeTruthy()
    expect(result.success).toBeUndefined()
    expect(mockPrisma.resumeSectionItem.deleteMany).not.toHaveBeenCalled()
  })
})

describe("saveResume legitimate writes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.resume.findUnique.mockResolvedValue(ownedResume)
    mockPrisma.resume.update.mockResolvedValue({ id: "resume-1" })
    mockPrisma.resumeSectionItem.findMany.mockResolvedValue([])
    mockPrisma.resumeSectionItem.create.mockResolvedValue({ id: "real-2" })
    mockPrisma.resumeSectionItem.upsert.mockResolvedValue({ id: "item-1" })
    mockPrisma.resumeSectionItem.deleteMany.mockResolvedValue({ count: 0 })
  })

  it("creates temp- items and returns the temp → real idMap", async () => {
    const result = await saveResume("resume-1", [
      section("sec-1", [item("item-1", 0), item("temp-abc", 1)]),
    ])

    expect(result).toEqual({ success: true, idMap: { "temp-abc": "real-2" } })
    expect(mockPrisma.resumeSectionItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sectionId: "sec-1", order: 1 }),
      })
    )
    expect(mockPrisma.resumeSectionItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-1" } })
    )
    // The created row's real id must survive the prune of removed items.
    expect(mockPrisma.resumeSectionItem.deleteMany).toHaveBeenCalledWith({
      where: { sectionId: "sec-1", id: { notIn: ["item-1", "real-2"] } },
    })
  })

  it("allows a new item id that exists nowhere in the DB", async () => {
    const result = await saveResume("resume-1", [section("sec-1", [item("brand-new-id")])])

    expect(result).toEqual({ success: true, idMap: {} })
    expect(mockPrisma.resumeSectionItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "brand-new-id" } })
    )
  })
})
