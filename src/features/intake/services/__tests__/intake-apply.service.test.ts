// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const client = {
    $queryRaw: vi.fn(),
    intakePatch: { findFirst: vi.fn(), update: vi.fn() },
    intakeConflict: { upsert: vi.fn(), updateMany: vi.fn() },
    intakeCorrection: { create: vi.fn() },
    careerProfile: { findUnique: vi.fn(), update: vi.fn() },
    careerEvidence: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    careerCapability: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    careerTargetRole: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  }
  return {
    intakePatch: client.intakePatch,
    intakeConflict: client.intakeConflict,
    intakeCorrection: client.intakeCorrection,
    careerProfile: client.careerProfile,
    careerEvidence: client.careerEvidence,
    careerCapability: client.careerCapability,
    careerTargetRole: client.careerTargetRole,
    getOrCreateCareerProfileId: vi.fn(),
    $queryRaw: client.$queryRaw,
    transaction: vi.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client)
    ),
  }
})

vi.mock("@/features/career-profile/services/career-profile.service", () => ({
  getOrCreateCareerProfileId: mocks.getOrCreateCareerProfileId,
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    intakePatch: mocks.intakePatch,
    intakeConflict: mocks.intakeConflict,
    intakeCorrection: mocks.intakeCorrection,
    careerProfile: mocks.careerProfile,
    careerEvidence: mocks.careerEvidence,
    careerCapability: mocks.careerCapability,
    careerTargetRole: mocks.careerTargetRole,
    $transaction: mocks.transaction,
  },
}))

import {
  applyIntakePatch,
  correctIntakePatch,
  IntakeApplyError,
  rejectIntakePatch,
} from "../intake-apply.service"

const PROVENANCE = {
  adapter: "resume-text",
  sourceUrl: null,
  fileName: "resume.pdf",
  externalId: null,
  locator: "contact:contactEmail",
  fetchedAt: "2026-11-11T12:00:00.000Z",
  detail: null,
}

function patch(overrides: Record<string, unknown> = {}) {
  return {
    id: "patch-1",
    runId: "run-1",
    source: "RESUME",
    kind: "CONTACT",
    confidence: 90,
    payload: { field: "contactEmail", value: "ada@new.com" },
    provenance: PROVENANCE,
    status: "PENDING",
    rejectionReason: null,
    appliedTargetType: null,
    appliedTargetId: null,
    conflict: null,
    run: { userId: "user-1" },
    ...overrides,
  }
}

const CONFLICT = {
  id: "conflict-1",
  existingType: "career_profile",
  existingId: "profile-1",
  field: "contactEmail",
  incoming: { value: "ada@new.com" },
  existing: { value: "ada@old.com" },
  status: "OPEN",
  resolution: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.$queryRaw.mockResolvedValue([{ id: "locked" }])
  mocks.getOrCreateCareerProfileId.mockResolvedValue("profile-1")
  mocks.intakePatch.findFirst.mockResolvedValue(patch())
  mocks.intakePatch.update.mockResolvedValue({})
  mocks.intakeConflict.upsert.mockResolvedValue(CONFLICT)
  mocks.intakeConflict.updateMany.mockResolvedValue({ count: 1 })
  mocks.intakeCorrection.create.mockResolvedValue({})
  mocks.careerProfile.findUnique.mockResolvedValue({
    contactFullName: null,
    contactEmail: null,
    contactPhone: null,
    contactLocation: null,
    linkedinUrl: null,
    githubUrl: null,
    websiteUrl: null,
  })
  mocks.careerProfile.update.mockResolvedValue({})
  mocks.careerEvidence.findMany.mockResolvedValue([])
  mocks.careerEvidence.findFirst.mockResolvedValue(null)
  mocks.careerEvidence.create.mockResolvedValue({ id: "ev-new" })
  mocks.careerEvidence.update.mockResolvedValue({})
  mocks.careerCapability.findMany.mockResolvedValue([])
  mocks.careerCapability.findFirst.mockResolvedValue(null)
  mocks.careerCapability.create.mockResolvedValue({ id: "cap-new" })
  mocks.careerCapability.update.mockResolvedValue({})
  mocks.careerTargetRole.findMany.mockResolvedValue([])
  mocks.careerTargetRole.findFirst.mockResolvedValue(null)
  mocks.careerTargetRole.create.mockResolvedValue({ id: "role-new" })
  mocks.careerTargetRole.update.mockResolvedValue({})
})

describe("contact patches", () => {
  it("writes a field only when the profile has no value", async () => {
    const result = await applyIntakePatch("user-1", "patch-1")

    expect(result.status).toBe("APPLIED")
    expect(mocks.careerProfile.update).toHaveBeenCalledWith({
      where: { id: "profile-1" },
      data: { contactEmail: "ada@new.com" },
    })
    expect(mocks.intakeConflict.upsert).not.toHaveBeenCalled()
  })

  it("returns a review task instead of overwriting a different value", async () => {
    mocks.careerProfile.findUnique.mockResolvedValue({
      contactFullName: null,
      contactEmail: "ada@old.com",
      contactPhone: null,
      contactLocation: null,
      linkedinUrl: null,
      githubUrl: null,
      websiteUrl: null,
    })

    const result = await applyIntakePatch("user-1", "patch-1")

    expect(result.status).toBe("CONFLICT")
    expect(result.conflict?.existing).toEqual({ value: "ada@old.com" })
    expect(mocks.careerProfile.update).not.toHaveBeenCalled()
    expect(mocks.intakeConflict.upsert).toHaveBeenCalledTimes(1)
  })

  it("keeps the existing value when the user chooses it", async () => {
    mocks.careerProfile.findUnique.mockResolvedValue({
      contactFullName: null,
      contactEmail: "ada@old.com",
      contactPhone: null,
      contactLocation: null,
      linkedinUrl: null,
      githubUrl: null,
      websiteUrl: null,
    })

    const result = await applyIntakePatch("user-1", "patch-1", "KEEP_EXISTING")

    expect(result.status).toBe("REJECTED")
    expect(mocks.careerProfile.update).not.toHaveBeenCalled()
    expect(mocks.intakePatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED" }) })
    )
  })

  it("accepts the imported value when the user chooses it", async () => {
    mocks.careerProfile.findUnique.mockResolvedValue({
      contactFullName: null,
      contactEmail: "ada@old.com",
      contactPhone: null,
      contactLocation: null,
      linkedinUrl: null,
      githubUrl: null,
      websiteUrl: null,
    })

    const result = await applyIntakePatch("user-1", "patch-1", "ACCEPT_INCOMING")

    expect(result.status).toBe("APPLIED")
    expect(mocks.careerProfile.update).toHaveBeenCalledWith({
      where: { id: "profile-1" },
      data: { contactEmail: "ada@new.com" },
    })
    expect(mocks.intakeConflict.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patchId: "patch-1", status: "OPEN" },
        data: expect.objectContaining({ resolution: "ACCEPT_INCOMING" }),
      })
    )
  })

  it("leaves the patch unapplied when the profile write fails, then retries cleanly", async () => {
    mocks.careerProfile.update.mockRejectedValueOnce(new Error("database unavailable"))

    await expect(applyIntakePatch("user-1", "patch-1")).rejects.toThrow(
      "database unavailable"
    )
    // The target write and the status write share one transaction: a failed
    // profile update must never leave a patch marked APPLIED.
    expect(mocks.intakePatch.update).not.toHaveBeenCalled()

    mocks.careerProfile.update.mockResolvedValue({})
    const retried = await applyIntakePatch("user-1", "patch-1")
    expect(retried.status).toBe("APPLIED")
    expect(mocks.intakePatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPLIED" }) })
    )
  })
})

const EVIDENCE_PATCH = patch({
  kind: "EVIDENCE",
  payload: {
    evidenceKind: "EXPERIENCE",
    title: "Backend Engineer",
    organization: "Acme",
    details: null,
    outcome: null,
    startDate: "2021-01-01",
    endDate: null,
  },
})

const EXISTING_EVIDENCE = {
  id: "ev-1",
  kind: "EXPERIENCE",
  title: "Backend Engineer",
  organization: "Acme",
  details: null,
  outcome: null,
  startDate: null,
  endDate: null,
  status: "CANDIDATE",
  metadata: null,
  source: "RESUME_IMPORT_CANDIDATE",
}

describe("evidence patches", () => {
  beforeEach(() => {
    mocks.intakePatch.findFirst.mockResolvedValue(EVIDENCE_PATCH)
    mocks.careerEvidence.findMany.mockResolvedValue([EXISTING_EVIDENCE])
  })

  it("refuses to overwrite confirmed evidence through accept-incoming", async () => {
    mocks.careerEvidence.findFirst.mockResolvedValue({
      id: "ev-1",
      status: "CONFIRMED",
      metadata: null,
    })

    await expect(
      applyIntakePatch("user-1", "patch-1", "ACCEPT_INCOMING")
    ).rejects.toMatchObject({ status: 409, name: "IntakeApplyError" })
    expect(mocks.careerEvidence.update).not.toHaveBeenCalled()
  })

  it("creates a second row when the user keeps both versions", async () => {
    const result = await applyIntakePatch("user-1", "patch-1", "KEEP_BOTH")

    expect(result.status).toBe("APPLIED")
    expect(mocks.careerEvidence.create).toHaveBeenCalledTimes(1)
    expect(mocks.careerEvidence.create.mock.calls[0][0].data).toMatchObject({
      careerProfileId: "profile-1",
      status: "CANDIDATE",
      title: "Backend Engineer",
    })
  })

  it("creates candidate evidence with provenance metadata when nothing matches", async () => {
    mocks.careerEvidence.findMany.mockResolvedValue([])

    const result = await applyIntakePatch("user-1", "patch-1")

    expect(result.status).toBe("APPLIED")
    expect(mocks.careerEvidence.create.mock.calls[0][0].data.metadata).toMatchObject({
      intakeRunId: "run-1",
      intakePatchId: "patch-1",
      intakeSource: "RESUME",
    })
  })
})

describe("skill and target-role collisions", () => {
  it("returns a conflict for a differently-spelled existing skill", async () => {
    mocks.intakePatch.findFirst.mockResolvedValue(
      patch({
        kind: "SKILL",
        payload: { name: "Node.js", category: "Runtime" },
      })
    )
    mocks.careerCapability.findMany.mockResolvedValue([
      { id: "cap-1", name: "NodeJS", category: null, confirmed: true },
    ])

    const result = await applyIntakePatch("user-1", "patch-1")
    expect(result.status).toBe("CONFLICT")
    expect(mocks.careerCapability.create).not.toHaveBeenCalled()
  })

  it("reactivates an existing target role instead of duplicating it", async () => {
    mocks.intakePatch.findFirst.mockResolvedValue(
      patch({ kind: "TARGET_ROLE", payload: { title: "Backend Engineer" } })
    )
    mocks.careerTargetRole.findMany.mockResolvedValue([
      { id: "role-1", title: "backend engineer", active: false, priority: 0 },
    ])
    mocks.careerTargetRole.findFirst.mockResolvedValue({
      id: "role-1",
      active: false,
    })

    const result = await applyIntakePatch("user-1", "patch-1", "ACCEPT_INCOMING")

    expect(result.status).toBe("APPLIED")
    expect(mocks.careerTargetRole.update).toHaveBeenCalledWith({
      where: { id: "role-1" },
      data: { active: true },
    })
    expect(mocks.careerTargetRole.create).not.toHaveBeenCalled()
  })
})

describe("rejection and correction", () => {
  it("refuses to reject a fact already written to the profile", async () => {
    mocks.intakePatch.findFirst.mockResolvedValue({
      id: "patch-1",
      status: "APPLIED",
    })

    await expect(rejectIntakePatch("user-1", "patch-1")).rejects.toMatchObject({
      status: 409,
    })
  })

  it("404s a patch belonging to another owner", async () => {
    mocks.intakePatch.findFirst.mockResolvedValue(null)

    await expect(applyIntakePatch("user-1", "patch-1")).rejects.toBeInstanceOf(
      IntakeApplyError
    )
    await expect(applyIntakePatch("user-1", "patch-1")).rejects.toMatchObject({
      status: 404,
    })
  })

  it("corrects applied evidence and records the previous payload", async () => {
    mocks.intakePatch.findFirst.mockResolvedValue({
      ...EVIDENCE_PATCH,
      status: "APPLIED",
      appliedTargetType: "career_evidence",
      appliedTargetId: "ev-1",
    })
    mocks.careerEvidence.findFirst.mockResolvedValue({ id: "ev-1" })

    const result = await correctIntakePatch(
      "user-1",
      "patch-1",
      {
        kind: "EVIDENCE",
        data: {
          evidenceKind: "EXPERIENCE",
          title: "Senior Backend Engineer",
          organization: "Acme",
          details: "Corrected by the user.",
          outcome: null,
          startDate: "2021-01-01",
          endDate: "2024-01-01",
        },
      },
      "Title was too junior."
    )

    expect(result.status).toBe("APPLIED")
    expect(mocks.careerEvidence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ev-1" },
        data: expect.objectContaining({ title: "Senior Backend Engineer" }),
      })
    )
    expect(mocks.intakeCorrection.create).toHaveBeenCalledTimes(1)
    expect(mocks.intakePatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ correctedAt: expect.any(Date) }),
      })
    )
  })
})
