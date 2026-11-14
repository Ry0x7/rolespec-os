// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockRevalidate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    note: {
      create: vi.fn(),
    },
  },
  mockRevalidate: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }))

import { createNote } from "../note.actions"

const USER_ID = "user-1"

function formData(entries: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.set(key, value)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: USER_ID } })
  mockPrisma.note.create.mockResolvedValue({ id: "note-1" })
})

describe("createNote", () => {
  it("creates a standalone note with only the user and the content", async () => {
    const result = await createNote(formData({ content: "Prep STAR stories" }))

    expect(result).toEqual({ success: true, id: "note-1" })
    expect(mockPrisma.note.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, content: "Prep STAR stories" },
      select: { id: true },
    })
    expect(mockPrisma.note.create.mock.calls[0][0].data).not.toHaveProperty("jobApplicationId")
  })

  it("rejects empty content without writing", async () => {
    const result = await createNote(formData({ content: "" }))

    expect(result).toMatchObject({ error: "Invalid input" })
    expect(mockPrisma.note.create).not.toHaveBeenCalled()
  })
})
