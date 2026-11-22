// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Prisma } from "@/generated/prisma/client"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  careerProfile: { findUnique: vi.fn() },
  careerRoleFamily: { findFirst: vi.fn(), create: vi.fn() },
  careerTargetRole: { findFirst: vi.fn(), create: vi.fn() },
  careerEvidence: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  careerCapability: {
    create: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  careerEvidenceCapability: {
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    careerProfile: mocks.careerProfile,
    careerRoleFamily: mocks.careerRoleFamily,
    careerTargetRole: mocks.careerTargetRole,
    careerEvidence: mocks.careerEvidence,
    careerCapability: mocks.careerCapability,
    careerEvidenceCapability: mocks.careerEvidenceCapability,
  },
}))

import { approveCareerPathRole } from "../career-path.actions"

const OWN_PROFILE = "cp_user1"
const ROLE_ID = "junior-software-engineer"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
  mocks.careerProfile.findUnique.mockResolvedValue({ id: OWN_PROFILE })
  mocks.careerRoleFamily.findFirst.mockResolvedValue(null)
  mocks.careerTargetRole.findFirst.mockResolvedValue(null)
  mocks.careerTargetRole.create.mockResolvedValue({ id: "tr_new" })
})

describe("approveCareerPathRole", () => {
  it("refuses an anonymous caller before touching any profile data", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(approveCareerPathRole(ROLE_ID)).resolves.toEqual({
      error: "Unauthorized",
    })
    expect(mocks.careerProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.careerTargetRole.create).not.toHaveBeenCalled()
  })

  it("refuses when the caller has no career profile", async () => {
    mocks.careerProfile.findUnique.mockResolvedValue(null)

    const result = await approveCareerPathRole(ROLE_ID)

    expect(result).toEqual({ error: expect.any(String) })
    expect(mocks.careerTargetRole.create).not.toHaveBeenCalled()
  })

  it.each([
    ["blank", "   "],
    ["unknown", "staff-astronaut"],
    ["too long", "x".repeat(101)],
  ])("refuses a %s occupation id without writing", async (_label, id) => {
    await expect(approveCareerPathRole(id)).resolves.toEqual({
      error: "Unknown career path role.",
    })
    expect(mocks.careerTargetRole.findFirst).not.toHaveBeenCalled()
    expect(mocks.careerTargetRole.create).not.toHaveBeenCalled()
  })

  it("creates the canonical role scoped to the caller's profile and appends priority", async () => {
    mocks.careerTargetRole.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ priority: 4 })
    mocks.careerRoleFamily.findFirst.mockResolvedValue({ id: "rf_eng" })

    const result = await approveCareerPathRole(ROLE_ID)

    expect(result).toEqual({ success: true, alreadyExists: false })
    expect(mocks.careerTargetRole.create).toHaveBeenCalledWith({
      data: {
        careerProfileId: OWN_PROFILE,
        title: "Junior Software Engineer",
        roleFamilyId: "rf_eng",
        priority: 5,
        source: "CAREER_PATH",
        discoveryEnabled: false,
      },
      select: { id: true },
    })
    expect(mocks.careerRoleFamily.findFirst).toHaveBeenCalledWith({
      where: { careerProfileId: OWN_PROFILE, name: "Engineering" },
      select: { id: true },
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/career-profile")
  })

  it("trims the id but still stores the catalogue's title", async () => {
    await approveCareerPathRole(`  ${ROLE_ID}  `)

    expect(mocks.careerTargetRole.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Junior Software Engineer" }),
      })
    )
  })

  it("does not create a role family when the profile has no matching family", async () => {
    mocks.careerRoleFamily.findFirst.mockResolvedValue(null)

    await approveCareerPathRole(ROLE_ID)

    expect(mocks.careerTargetRole.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roleFamilyId: null }),
      })
    )
    expect(mocks.careerRoleFamily.create).not.toHaveBeenCalled()
  })

  it("returns alreadyExists without writing when the role is on the list", async () => {
    mocks.careerTargetRole.findFirst.mockResolvedValue({ id: "tr_existing" })

    await expect(approveCareerPathRole(ROLE_ID)).resolves.toEqual({
      success: true,
      alreadyExists: true,
    })
    expect(mocks.careerTargetRole.create).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("checks the exact canonical title within the owner's profile", async () => {
    await approveCareerPathRole(ROLE_ID)

    expect(mocks.careerTargetRole.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        careerProfileId: OWN_PROFILE,
        title: "Junior Software Engineer",
      },
      select: { id: true },
    })
    // Priority is read only for this profile too, never globally.
    expect(mocks.careerTargetRole.findFirst).toHaveBeenNthCalledWith(2, {
      where: { careerProfileId: OWN_PROFILE },
      orderBy: { priority: "desc" },
      select: { priority: true },
    })
  })

  it("does not let another profile's family or target role affect the write", async () => {
    // The mock only answers the owner-scoped query. If the action forgot the
    // profile scope it would receive this unrelated row and skip creation.
    mocks.careerTargetRole.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        where.title
          ? Promise.resolve(null)
          : Promise.resolve({ priority: 0 })
    )
    mocks.careerRoleFamily.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        where.careerProfileId === OWN_PROFILE ? Promise.resolve(null) : Promise.resolve({ id: "rf_other" })
    )

    const result = await approveCareerPathRole(ROLE_ID)

    expect(result).toEqual({ success: true, alreadyExists: false })
    expect(mocks.careerTargetRole.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          careerProfileId: OWN_PROFILE,
          roleFamilyId: null,
        }),
      })
    )
  })

  it("caps the appended priority at 999", async () => {
    mocks.careerTargetRole.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ priority: 1200 })

    await approveCareerPathRole(ROLE_ID)

    expect(mocks.careerTargetRole.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priority: 999 }),
      })
    )
  })

  it("never writes evidence, capabilities or capability links", async () => {
    await approveCareerPathRole(ROLE_ID)

    expect(mocks.careerEvidence.create).not.toHaveBeenCalled()
    expect(mocks.careerEvidence.updateMany).not.toHaveBeenCalled()
    expect(mocks.careerEvidence.deleteMany).not.toHaveBeenCalled()
    expect(mocks.careerCapability.create).not.toHaveBeenCalled()
    expect(mocks.careerCapability.createMany).not.toHaveBeenCalled()
    expect(mocks.careerCapability.updateMany).not.toHaveBeenCalled()
    expect(mocks.careerCapability.deleteMany).not.toHaveBeenCalled()
    expect(mocks.careerEvidenceCapability.create).not.toHaveBeenCalled()
    expect(mocks.careerEvidenceCapability.updateMany).not.toHaveBeenCalled()
    expect(mocks.careerEvidenceCapability.deleteMany).not.toHaveBeenCalled()
  })

  it("returns a friendly error and does not revalidate on database failure", async () => {
    mocks.careerTargetRole.create.mockRejectedValue(new Error("database offline"))

    await expect(approveCareerPathRole(ROLE_ID)).resolves.toEqual({
      error: "Something went wrong. Please try again.",
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("treats a unique-constraint race as already on the list", async () => {
    mocks.careerTargetRole.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: ["careerProfileId", "title"] },
      })
    )

    await expect(approveCareerPathRole(ROLE_ID)).resolves.toEqual({
      success: true,
      alreadyExists: true,
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
