// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn(), delete: vi.fn() },
    resume: { findMany: vi.fn() },
  },
  deleteExportFilesForResumes: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("@/features/export/services/store-export", () => ({
  deleteExportFilesForResumes: mocks.deleteExportFilesForResumes,
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))

import { resetWorkspaceAction } from "../workspace-reset.actions"
import { DELETE_CONFIRMATION_PHRASE } from "../../constants/data"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "owner_1" } })
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "owner_1" })
  mocks.prisma.user.delete.mockResolvedValue({})
  mocks.prisma.resume.findMany.mockResolvedValue([{ id: "resume_1" }, { id: "resume_2" }])
  mocks.deleteExportFilesForResumes.mockResolvedValue(undefined)
})

describe("authentication and confirmation", () => {
  it("refuses when the workspace is locked", async () => {
    mocks.auth.mockResolvedValue(null)

    const result = await resetWorkspaceAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE })
    )

    expect(result.ok).toBe(false)
    expect(mocks.prisma.user.delete).not.toHaveBeenCalled()
  })

  it.each(["", "delete", "Delete", "DELETE ME"])(
    "refuses the confirmation %o",
    async (confirmation) => {
      const result = await resetWorkspaceAction(form({ confirmation }))

      expect(result.ok).toBe(false)
      expect(mocks.prisma.user.delete).not.toHaveBeenCalled()
    }
  )

  it("accepts the exact phrase with surrounding whitespace trimmed", async () => {
    await resetWorkspaceAction(
      form({ confirmation: `  ${DELETE_CONFIRMATION_PHRASE}  ` })
    )

    expect(mocks.prisma.user.delete).toHaveBeenCalledWith({ where: { id: "owner_1" } })
  })
})

describe("deletion", () => {
  it("collects resume ids before the cascade removes them", async () => {
    await resetWorkspaceAction(form({ confirmation: DELETE_CONFIRMATION_PHRASE }))

    expect(mocks.prisma.resume.findMany).toHaveBeenCalledWith({
      where: { userId: "owner_1" },
      select: { id: true },
    })
    expect(mocks.prisma.resume.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.user.delete.mock.invocationCallOrder[0]
    )
  })

  it("deletes export files after the owner and before redirecting", async () => {
    await resetWorkspaceAction(form({ confirmation: DELETE_CONFIRMATION_PHRASE }))

    expect(mocks.deleteExportFilesForResumes).toHaveBeenCalledWith(["resume_1", "resume_2"])
    expect(mocks.deleteExportFilesForResumes.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0]
    )
    expect(mocks.redirect).toHaveBeenCalledWith("/onboarding?reset=1")
  })

  it("does not clean up when nothing was deleted", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)

    const result = await resetWorkspaceAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE })
    )

    expect(result.ok).toBe(false)
    expect(mocks.deleteExportFilesForResumes).not.toHaveBeenCalled()
  })
})
