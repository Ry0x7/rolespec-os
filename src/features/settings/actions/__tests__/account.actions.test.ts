// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  signOut: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn(), delete: vi.fn(), count: vi.fn() },
    resume: { findMany: vi.fn() },
  },
  compare: vi.fn(),
  deleteExportFilesForResumes: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth, signOut: mocks.signOut }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare } }))
vi.mock("@/features/export/services/store-export", () => ({
  deleteExportFilesForResumes: mocks.deleteExportFilesForResumes,
}))

import { deleteMyAccountAction } from "../account.actions"
import { DELETE_CONFIRMATION_PHRASE } from "../../constants/data"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const CREDENTIALS_USER = { id: "user_1", password: "$2a$12$hash", role: "USER" }
const OAUTH_USER = { id: "user_2", password: null, role: "USER" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
  mocks.compare.mockResolvedValue(true)
  mocks.prisma.user.delete.mockResolvedValue({})
  mocks.prisma.user.count.mockResolvedValue(1)
  mocks.prisma.resume.findMany.mockResolvedValue([])
  mocks.deleteExportFilesForResumes.mockResolvedValue(undefined)
  // signOut redirects by throwing, which is what Next does in a real request.
  mocks.signOut.mockRejectedValue(new Error("NEXT_REDIRECT"))
})

describe("authentication and confirmation", () => {
  it("refuses when nobody is signed in", async () => {
    mocks.auth.mockResolvedValue(null)

    const result = await deleteMyAccountAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE, password: "pw" })
    )

    expect(result.ok).toBe(false)
    expect(mocks.prisma.user.delete).not.toHaveBeenCalled()
  })

  it.each(["", "delete", "Delete", "DELETE ME", "DELETED"])(
    "refuses the confirmation %o",
    async (confirmation) => {
      mocks.prisma.user.findUnique.mockResolvedValue(CREDENTIALS_USER)

      const result = await deleteMyAccountAction(form({ confirmation, password: "pw" }))

      expect(result.ok).toBe(false)
      expect(mocks.prisma.user.delete).not.toHaveBeenCalled()
    }
  )

  it("accepts the exact phrase with surrounding whitespace trimmed", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(CREDENTIALS_USER)

    await deleteMyAccountAction(
      form({ confirmation: `  ${DELETE_CONFIRMATION_PHRASE}  `, password: "pw" })
    ).catch(() => {})

    expect(mocks.prisma.user.delete).toHaveBeenCalledWith({ where: { id: "user_1" } })
  })
})

describe("password re-entry", () => {
  it("requires the correct password for a credentials account", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(CREDENTIALS_USER)
    mocks.compare.mockResolvedValue(false)

    const result = await deleteMyAccountAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE, password: "wrong" })
    )

    expect(result).toEqual({ ok: false, message: "That password is not correct." })
    expect(mocks.prisma.user.delete).not.toHaveBeenCalled()
  })

  it("refuses an empty password rather than skipping the check", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(CREDENTIALS_USER)

    const result = await deleteMyAccountAction(form({ confirmation: DELETE_CONFIRMATION_PHRASE }))

    expect(result.ok).toBe(false)
    expect(mocks.compare).not.toHaveBeenCalled()
    expect(mocks.prisma.user.delete).not.toHaveBeenCalled()
  })

  it("does not ask an OAuth-only account for a password it does not have", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_2" } })
    mocks.prisma.user.findUnique.mockResolvedValue(OAUTH_USER)

    await deleteMyAccountAction(form({ confirmation: DELETE_CONFIRMATION_PHRASE })).catch(() => {})

    expect(mocks.compare).not.toHaveBeenCalled()
    expect(mocks.prisma.user.delete).toHaveBeenCalledWith({ where: { id: "user_2" } })
  })
})

describe("last-admin protection", () => {
  it("refuses to delete the only admin", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ ...CREDENTIALS_USER, role: "ADMIN" })
    mocks.prisma.user.count.mockResolvedValue(0)

    const result = await deleteMyAccountAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE, password: "pw" })
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain("only admin account")
    expect(mocks.prisma.user.delete).not.toHaveBeenCalled()
  })

  it("allows an admin to leave when another admin remains", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ ...CREDENTIALS_USER, role: "ADMIN" })
    mocks.prisma.user.count.mockResolvedValue(2)

    await deleteMyAccountAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE, password: "pw" })
    ).catch(() => {})

    expect(mocks.prisma.user.count).toHaveBeenCalledWith({
      where: { role: "ADMIN", id: { not: "user_1" } },
    })
    expect(mocks.prisma.user.delete).toHaveBeenCalled()
  })

  it("does not run the admin check for a normal user", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(CREDENTIALS_USER)

    await deleteMyAccountAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE, password: "pw" })
    ).catch(() => {})

    expect(mocks.prisma.user.count).not.toHaveBeenCalled()
  })
})

describe("deletion", () => {
  it("signs the user out after deleting, not before", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(CREDENTIALS_USER)

    await deleteMyAccountAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE, password: "pw" })
    ).catch(() => {})

    expect(mocks.prisma.user.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0]
    )
  })

  it("deletes only the caller's own account", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(CREDENTIALS_USER)

    await deleteMyAccountAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE, password: "pw" })
    ).catch(() => {})

    // The id comes from the session, never from the form.
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user_1" },
      select: { id: true, password: true, role: true },
    })
    expect(mocks.prisma.user.delete).toHaveBeenCalledWith({ where: { id: "user_1" } })
  })
})

describe("export file cleanup", () => {
  beforeEach(() => {
    mocks.prisma.user.findUnique.mockResolvedValue(CREDENTIALS_USER)
    mocks.prisma.resume.findMany.mockResolvedValue([{ id: "resume_1" }, { id: "resume_2" }])
  })

  async function deleteAccount() {
    await deleteMyAccountAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE, password: "pw" })
    ).catch(() => {})
  }

  it("collects every resume id, archived included, before the cascade removes them", async () => {
    await deleteAccount()

    expect(mocks.prisma.resume.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      select: { id: true },
    })
    expect(mocks.prisma.resume.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.user.delete.mock.invocationCallOrder[0]
    )
  })

  it("deletes the export files after the account, and before signOut", async () => {
    await deleteAccount()

    expect(mocks.deleteExportFilesForResumes).toHaveBeenCalledWith(["resume_1", "resume_2"])
    expect(mocks.prisma.user.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteExportFilesForResumes.mock.invocationCallOrder[0]
    )
    // signOut throws a redirect, so cleanup queued after it would never run.
    expect(mocks.deleteExportFilesForResumes.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0]
    )
  })

  it("does not clean up when the account was never deleted", async () => {
    mocks.compare.mockResolvedValue(false)

    const result = await deleteMyAccountAction(
      form({ confirmation: DELETE_CONFIRMATION_PHRASE, password: "wrong" })
    )

    expect(result.ok).toBe(false)
    expect(mocks.deleteExportFilesForResumes).not.toHaveBeenCalled()
  })

  it("keeps the account deleted even if cleanup rejects", async () => {
    // The helper is documented as never throwing; if it ever does, the account
    // is already gone and the failure must not be mistaken for a failed delete.
    mocks.deleteExportFilesForResumes.mockRejectedValue(new Error("storage down"))

    await deleteAccount()

    expect(mocks.prisma.user.delete).toHaveBeenCalled()
  })
})
