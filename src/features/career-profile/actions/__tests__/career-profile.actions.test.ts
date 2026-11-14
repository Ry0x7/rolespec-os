// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  careerProfile: { findUnique: vi.fn(), update: vi.fn() },
  careerRoleFamily: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  careerTargetRole: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  careerEvidence: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  careerCapability: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  careerEvidenceCapability: {
    findFirst: vi.fn(),
    create: vi.fn(),
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

import {
  createRoleFamily,
  createTargetRole,
  deleteRoleFamily,
  deleteTargetRole,
  setTargetRoleActive,
  updateCareerPreferences,
} from "../career-profile.actions"
import {
  confirmEvidence,
  createEvidence,
  deleteEvidence,
  updateEvidence,
} from "../career-evidence.actions"
import {
  createCapabilities,
  createCapability,
  deleteCapability,
  linkEvidenceToCapability,
  setCapabilityConfirmed,
  unlinkEvidenceFromCapability,
} from "../career-capability.actions"

const OWN_PROFILE = "cp_user1"

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => data.append(key, v))
    else data.set(key, value)
  }
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
  mocks.careerProfile.findUnique.mockResolvedValue({ id: OWN_PROFILE })
  mocks.careerProfile.update.mockResolvedValue({ id: OWN_PROFILE })
  // Default "nothing matched" for every scoped write, which is exactly what a
  // cross-user id produces once `careerProfileId` is in the where clause.
  const models: Array<Partial<Record<"findFirst" | "create" | "updateMany" | "deleteMany", ReturnType<typeof vi.fn>>>> = [
    mocks.careerRoleFamily,
    mocks.careerTargetRole,
    mocks.careerEvidence,
    mocks.careerCapability,
    mocks.careerEvidenceCapability,
  ]
  for (const model of models) {
    model.findFirst?.mockResolvedValue(null)
    model.create?.mockResolvedValue({ id: "new_1" })
    model.updateMany?.mockResolvedValue({ count: 1 })
    model.deleteMany?.mockResolvedValue({ count: 1 })
  }
  mocks.careerCapability.findMany.mockResolvedValue([])
  mocks.careerCapability.createMany.mockResolvedValue({ count: 1 })
})

/** Every mutation, in the shape the UI calls it, for the blanket auth checks. */
const ALL_MUTATIONS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ["updateCareerPreferences", () => updateCareerPreferences(form({}))],
  ["createRoleFamily", () => createRoleFamily(form({ name: "Frontend" }))],
  ["deleteRoleFamily", () => deleteRoleFamily("rf_1")],
  ["createTargetRole", () => createTargetRole(form({ title: "Senior FE" }))],
  ["setTargetRoleActive", () => setTargetRoleActive("tr_1", false)],
  ["deleteTargetRole", () => deleteTargetRole("tr_1")],
  ["createEvidence", () => createEvidence(form({ kind: "PROJECT", title: "Thing" }))],
  [
    "updateEvidence",
    () => updateEvidence(form({ id: "ev_1", kind: "PROJECT", title: "Thing" })),
  ],
  ["confirmEvidence", () => confirmEvidence("ev_1")],
  ["deleteEvidence", () => deleteEvidence("ev_1")],
  ["createCapability", () => createCapability(form({ name: "React" }))],
  ["createCapabilities", () => createCapabilities(form({ names: "React, Vue" }))],
  ["setCapabilityConfirmed", () => setCapabilityConfirmed("cap_1", true)],
  ["deleteCapability", () => deleteCapability("cap_1")],
  [
    "linkEvidenceToCapability",
    () => linkEvidenceToCapability(form({ evidenceId: "ev_1", capabilityId: "cap_1" })),
  ],
  ["unlinkEvidenceFromCapability", () => unlinkEvidenceFromCapability("l_1")],
]

describe("authentication", () => {
  it.each(ALL_MUTATIONS)("%s refuses an anonymous caller", async (_name, invoke) => {
    mocks.auth.mockResolvedValue(null)

    await expect(invoke()).resolves.toEqual({ error: "Unauthorized" })
    expect(mocks.careerProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.careerEvidence.create).not.toHaveBeenCalled()
    expect(mocks.careerCapability.create).not.toHaveBeenCalled()
    expect(mocks.careerEvidence.deleteMany).not.toHaveBeenCalled()
    expect(mocks.careerCapability.deleteMany).not.toHaveBeenCalled()
  })

  it.each(ALL_MUTATIONS)(
    "%s refuses when the caller has no career profile",
    async (_name, invoke) => {
      mocks.careerProfile.findUnique.mockResolvedValue(null)

      const result = (await invoke()) as { error?: string }
      expect(result.error).toBeTruthy()
      expect(mocks.careerEvidence.create).not.toHaveBeenCalled()
      expect(mocks.careerCapability.create).not.toHaveBeenCalled()
    }
  )

  it("looks the profile up by session user id, never by a client value", async () => {
    await createEvidence(form({ kind: "PROJECT", title: "Thing", careerProfileId: "cp_other" }))

    expect(mocks.careerProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      select: { id: true },
    })
    expect(mocks.careerEvidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ careerProfileId: OWN_PROFILE }),
      })
    )
  })
})

describe("evidence provenance", () => {
  it("pins a user-entered row to USER_ENTERED/CONFIRMED and ignores request provenance", async () => {
    await createEvidence(
      form({
        kind: "EXPERIENCE",
        title: "Frontend Engineer",
        source: "RESUME_IMPORT_CANDIDATE",
        status: "ARCHIVED",
      })
    )

    const data = mocks.careerEvidence.create.mock.calls[0][0].data
    expect(data.source).toBe("USER_ENTERED")
    expect(data.status).toBe("CONFIRMED")
    expect(data.confirmedAt).toBeInstanceOf(Date)
    expect(data.careerProfileId).toBe(OWN_PROFILE)
  })

  it("never writes a resume-origin row, and stores no resume reference at all", async () => {
    await createEvidence(form({ kind: "PROJECT", title: "Thing", sourceResumeId: "r_1" }))

    const data = mocks.careerEvidence.create.mock.calls[0][0].data
    expect(data.source).not.toBe("RESUME_IMPORT_CANDIDATE")
    // The column was removed: provenance is `source` + `status` only, because
    // the database cannot enforce that a referenced resume shares the owner.
    expect(data).not.toHaveProperty("sourceResumeId")
    expect(data).not.toHaveProperty("sourceResume")
  })

  it("only promotes a CANDIDATE, and only for the owner", async () => {
    await confirmEvidence("ev_1")

    expect(mocks.careerEvidence.updateMany).toHaveBeenCalledWith({
      where: { id: "ev_1", careerProfileId: OWN_PROFILE, status: "CANDIDATE" },
      data: { status: "CONFIRMED", confirmedAt: expect.any(Date) },
    })
  })

  it("reports not found when the row is not a candidate the caller owns", async () => {
    mocks.careerEvidence.updateMany.mockResolvedValue({ count: 0 })

    await expect(confirmEvidence("ev_other")).resolves.toEqual({ error: "Not found" })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    ["startDate", "2026-02-31"],
    ["endDate", "2025-02-29"],
    ["startDate", "2026-13-01"],
    ["endDate", "2026/02/28"],
  ])("refuses a forged %s of %s without writing", async (field, value) => {
    const result = await createEvidence(
      form({ kind: "EXPERIENCE", title: "Frontend Engineer", [field]: value })
    )

    expect(result).toEqual({
      error: expect.stringMatching(/date does not exist|YYYY-MM-DD/),
    })
    expect(mocks.careerEvidence.create).not.toHaveBeenCalled()
  })

  it("stores a valid date at UTC midnight, so a @db.Date column cannot shift", async () => {
    await createEvidence(
      form({ kind: "EXPERIENCE", title: "Frontend Engineer", startDate: "2024-01-15" })
    )

    const { startDate } = mocks.careerEvidence.create.mock.calls[0][0].data
    expect(startDate.toISOString()).toBe("2024-01-15T00:00:00.000Z")
  })

  it("rejects an end date before the start date", async () => {
    const result = await createEvidence(
      form({
        kind: "EXPERIENCE",
        title: "Frontend Engineer",
        startDate: "2026-05-01",
        endDate: "2026-01-01",
      })
    )

    expect(result).toEqual({ error: "The end date cannot be before the start date." })
    expect(mocks.careerEvidence.create).not.toHaveBeenCalled()
  })
})

describe("cross-user resource ids", () => {
  it("scopes every delete through the caller's own profile", async () => {
    await deleteEvidence("ev_other")
    expect(mocks.careerEvidence.deleteMany).toHaveBeenCalledWith({
      where: { id: "ev_other", careerProfileId: OWN_PROFILE },
    })

    await deleteCapability("cap_other")
    expect(mocks.careerCapability.deleteMany).toHaveBeenCalledWith({
      where: { id: "cap_other", careerProfileId: OWN_PROFILE },
    })

    await deleteTargetRole("tr_other")
    expect(mocks.careerTargetRole.deleteMany).toHaveBeenCalledWith({
      where: { id: "tr_other", careerProfileId: OWN_PROFILE },
    })

    await deleteRoleFamily("rf_other")
    expect(mocks.careerRoleFamily.deleteMany).toHaveBeenCalledWith({
      where: { id: "rf_other", careerProfileId: OWN_PROFILE },
    })

    await unlinkEvidenceFromCapability("l_other")
    expect(mocks.careerEvidenceCapability.deleteMany).toHaveBeenCalledWith({
      where: { id: "l_other", capability: { careerProfileId: OWN_PROFILE } },
    })
  })

  it("reports not found instead of succeeding when nothing matched", async () => {
    mocks.careerEvidence.deleteMany.mockResolvedValue({ count: 0 })
    mocks.careerCapability.deleteMany.mockResolvedValue({ count: 0 })
    mocks.careerTargetRole.deleteMany.mockResolvedValue({ count: 0 })
    mocks.careerRoleFamily.deleteMany.mockResolvedValue({ count: 0 })
    mocks.careerEvidenceCapability.deleteMany.mockResolvedValue({ count: 0 })
    mocks.careerCapability.updateMany.mockResolvedValue({ count: 0 })
    mocks.careerTargetRole.updateMany.mockResolvedValue({ count: 0 })

    await expect(deleteEvidence("x")).resolves.toEqual({ error: "Not found" })
    await expect(deleteCapability("x")).resolves.toEqual({ error: "Not found" })
    await expect(deleteTargetRole("x")).resolves.toEqual({ error: "Not found" })
    await expect(deleteRoleFamily("x")).resolves.toEqual({ error: "Not found" })
    await expect(unlinkEvidenceFromCapability("x")).resolves.toEqual({ error: "Not found" })
    await expect(setCapabilityConfirmed("x", true)).resolves.toEqual({ error: "Not found" })
    await expect(setTargetRoleActive("x", false)).resolves.toEqual({ error: "Not found" })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("refuses a target role that points at someone else's role family", async () => {
    mocks.careerRoleFamily.findFirst.mockResolvedValue(null)

    const result = await createTargetRole(
      form({ title: "Senior FE", roleFamilyId: "rf_other" })
    )

    expect(mocks.careerRoleFamily.findFirst).toHaveBeenCalledWith({
      where: { id: "rf_other", careerProfileId: OWN_PROFILE },
      select: { id: true },
    })
    expect(result).toEqual({ error: "That role family does not exist." })
    expect(mocks.careerTargetRole.create).not.toHaveBeenCalled()
  })
})

describe("linkEvidenceToCapability", () => {
  it("checks both sides against the caller's own profile before writing", async () => {
    mocks.careerEvidence.findFirst.mockResolvedValue({ id: "ev_1", status: "CONFIRMED" })
    mocks.careerCapability.findFirst.mockResolvedValue({ id: "cap_1" })

    await linkEvidenceToCapability(
      form({ evidenceId: "ev_1", capabilityId: "cap_1", depth: "DEEP" })
    )

    expect(mocks.careerEvidence.findFirst).toHaveBeenCalledWith({
      where: { id: "ev_1", careerProfileId: OWN_PROFILE },
      select: { id: true, status: true },
    })
    expect(mocks.careerCapability.findFirst).toHaveBeenCalledWith({
      where: { id: "cap_1", careerProfileId: OWN_PROFILE },
      select: { id: true },
    })
    expect(mocks.careerEvidenceCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evidenceId: "ev_1",
          capabilityId: "cap_1",
          depth: "DEEP",
          hasMeasuredOutcome: false,
        }),
      })
    )
  })

  it.each(["2026-02-31", "2026-13-01", "2026/06/01"])(
    "refuses a forged lastUsedAt of %s without writing",
    async (value) => {
      mocks.careerEvidence.findFirst.mockResolvedValue({ id: "ev_1", status: "CONFIRMED" })
      mocks.careerCapability.findFirst.mockResolvedValue({ id: "cap_1" })

      const result = await linkEvidenceToCapability(
        form({ evidenceId: "ev_1", capabilityId: "cap_1", lastUsedAt: value })
      )

      expect(result).toEqual({
        error: expect.stringMatching(/date does not exist|YYYY-MM-DD/),
      })
      expect(mocks.careerEvidenceCapability.create).not.toHaveBeenCalled()
    }
  )

  it("stores a valid lastUsedAt at UTC midnight", async () => {
    mocks.careerEvidence.findFirst.mockResolvedValue({ id: "ev_1", status: "CONFIRMED" })
    mocks.careerCapability.findFirst.mockResolvedValue({ id: "cap_1" })

    await linkEvidenceToCapability(
      form({ evidenceId: "ev_1", capabilityId: "cap_1", lastUsedAt: "2026-06-01" })
    )

    const { lastUsedAt } = mocks.careerEvidenceCapability.create.mock.calls[0][0].data
    expect(lastUsedAt.toISOString()).toBe("2026-06-01T00:00:00.000Z")
  })

  it.each(["CANDIDATE", "ARCHIVED"])(
    "refuses %s evidence, so it cannot become a strength input",
    async (status) => {
      mocks.careerEvidence.findFirst.mockResolvedValue({ id: "ev_1", status })
      mocks.careerCapability.findFirst.mockResolvedValue({ id: "cap_1" })

      const result = await linkEvidenceToCapability(
        form({
          evidenceId: "ev_1",
          capabilityId: "cap_1",
          depth: "DEEP",
          hasMeasuredOutcome: "on",
          lastUsedAt: "2026-06-01",
        })
      )

      expect(result).toEqual({
        error: "Confirm that evidence before linking it to a capability.",
      })
      expect(mocks.careerEvidenceCapability.create).not.toHaveBeenCalled()
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    }
  )

  it("reads the status so an unconfirmed candidate can be recognised", async () => {
    mocks.careerEvidence.findFirst.mockResolvedValue({ id: "ev_1", status: "CANDIDATE" })
    mocks.careerCapability.findFirst.mockResolvedValue({ id: "cap_1" })

    await linkEvidenceToCapability(form({ evidenceId: "ev_1", capabilityId: "cap_1" }))

    expect(mocks.careerEvidence.findFirst).toHaveBeenCalledWith({
      where: { id: "ev_1", careerProfileId: OWN_PROFILE },
      select: { id: true, status: true },
    })
  })

  it.each([
    ["evidence", null, { id: "cap_1" }],
    ["capability", { id: "ev_1", status: "CONFIRMED" }, null],
  ])("refuses when the %s belongs to another user", async (_side, evidence, capability) => {
    mocks.careerEvidence.findFirst.mockResolvedValue(evidence)
    mocks.careerCapability.findFirst.mockResolvedValue(capability)

    const result = await linkEvidenceToCapability(
      form({ evidenceId: "ev_1", capabilityId: "cap_1" })
    )

    expect(result).toEqual({ error: "Not found" })
    expect(mocks.careerEvidenceCapability.create).not.toHaveBeenCalled()
  })
})

describe("capabilities", () => {
  it("creates unconfirmed, with self-assessment kept separate from confirmation", async () => {
    await createCapability(form({ name: "React", selfAssessment: "EXPERT" }))

    const data = mocks.careerCapability.create.mock.calls[0][0].data
    expect(data).not.toHaveProperty("confirmed")
    expect(data.selfAssessment).toBe("EXPERT")
    expect(data.careerProfileId).toBe(OWN_PROFILE)
  })

  it("records and clears confirmation explicitly", async () => {
    await setCapabilityConfirmed("cap_1", true)
    expect(mocks.careerCapability.updateMany).toHaveBeenLastCalledWith({
      where: { id: "cap_1", careerProfileId: OWN_PROFILE },
      data: { confirmed: true, confirmedAt: expect.any(Date) },
    })

    await setCapabilityConfirmed("cap_1", false)
    expect(mocks.careerCapability.updateMany).toHaveBeenLastCalledWith({
      where: { id: "cap_1", careerProfileId: OWN_PROFILE },
      data: { confirmed: false, confirmedAt: null },
    })
  })

  it("refuses a duplicate name within the same profile", async () => {
    mocks.careerCapability.findFirst.mockResolvedValue({ id: "cap_1" })

    await expect(createCapability(form({ name: "React" }))).resolves.toEqual({
      error: "You already have that capability.",
    })
    expect(mocks.careerCapability.create).not.toHaveBeenCalled()
  })
})

describe("updateEvidence", () => {
  it("writes the editable fields scoped to the caller's own profile", async () => {
    const result = await updateEvidence(
      form({
        id: "ev_1",
        kind: "PROJECT",
        title: "Checkout rewrite",
        organization: "  Acme Inc.  ",
        details: "Rebuilt the funnel",
        outcome: "18% less drop-off",
        startDate: "2024-01-15",
        endDate: "2024-06-30",
      })
    )

    expect(result).toEqual({ success: true })
    expect(mocks.careerEvidence.updateMany).toHaveBeenCalledWith({
      where: { id: "ev_1", careerProfileId: OWN_PROFILE },
      data: {
        kind: "PROJECT",
        title: "Checkout rewrite",
        organization: "Acme Inc.",
        details: "Rebuilt the funnel",
        outcome: "18% less drop-off",
        startDate: new Date("2024-01-15T00:00:00.000Z"),
        endDate: new Date("2024-06-30T00:00:00.000Z"),
      },
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/career-profile")
  })

  it("never touches provenance or confirmation state", async () => {
    await updateEvidence(
      form({
        id: "ev_1",
        kind: "EXPERIENCE",
        title: "Frontend Engineer",
        source: "USER_ENTERED",
        status: "CONFIRMED",
        confirmedAt: "2024-01-01",
      })
    )

    const { data } = mocks.careerEvidence.updateMany.mock.calls[0][0]
    expect(data).not.toHaveProperty("source")
    expect(data).not.toHaveProperty("status")
    expect(data).not.toHaveProperty("confirmedAt")
  })

  it("reports not found for an id the caller does not own", async () => {
    mocks.careerEvidence.updateMany.mockResolvedValue({ count: 0 })

    const result = await updateEvidence(
      form({ id: "ev_other", kind: "PROJECT", title: "Thing" })
    )

    expect(result).toEqual({ error: "Not found" })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects an end date before the start date without writing", async () => {
    const result = await updateEvidence(
      form({
        id: "ev_1",
        kind: "EXPERIENCE",
        title: "Frontend Engineer",
        startDate: "2026-05-01",
        endDate: "2026-01-01",
      })
    )

    expect(result).toEqual({ error: "The end date cannot be before the start date." })
    expect(mocks.careerEvidence.updateMany).not.toHaveBeenCalled()
  })
})

describe("createCapabilities", () => {
  it("splits, trims and creates every name scoped to the caller's profile", async () => {
    mocks.careerCapability.createMany.mockResolvedValue({ count: 3 })

    const result = await createCapabilities(form({ names: " React , TypeScript,Prisma " }))

    expect(mocks.careerCapability.createMany).toHaveBeenCalledWith({
      data: [
        { careerProfileId: OWN_PROFILE, name: "React", category: null, selfAssessment: null },
        {
          careerProfileId: OWN_PROFILE,
          name: "TypeScript",
          category: null,
          selfAssessment: null,
        },
        { careerProfileId: OWN_PROFILE, name: "Prisma", category: null, selfAssessment: null },
      ],
      skipDuplicates: true,
    })
    expect(result).toEqual({ success: true, created: 3, skipped: 0 })
  })

  it("drops empty segments so a trailing comma is not an error", async () => {
    mocks.careerCapability.createMany.mockResolvedValue({ count: 1 })

    await createCapabilities(form({ names: "React,, ," }))

    const { data } = mocks.careerCapability.createMany.mock.calls[0][0]
    expect(data.map((row: { name: string }) => row.name)).toEqual(["React"])
  })

  it("de-duplicates within the submission, ignoring case", async () => {
    mocks.careerCapability.createMany.mockResolvedValue({ count: 1 })

    const result = await createCapabilities(form({ names: "React, react, REACT" }))

    const { data } = mocks.careerCapability.createMany.mock.calls[0][0]
    expect(data.map((row: { name: string }) => row.name)).toEqual(["React"])
    expect(result).toEqual({ success: true, created: 1, skipped: 0 })
  })

  it("skips a name already stored in the same case", async () => {
    mocks.careerCapability.findMany.mockResolvedValue([{ name: "React" }])
    mocks.careerCapability.createMany.mockResolvedValue({ count: 1 })

    const result = await createCapabilities(form({ names: "React, Vue" }))

    const { data } = mocks.careerCapability.createMany.mock.calls[0][0]
    expect(data.map((row: { name: string }) => row.name)).toEqual(["Vue"])
    expect(result).toEqual({ success: true, created: 1, skipped: 1 })
  })

  it("skips a name already stored in a different case, which the DB index would not", async () => {
    mocks.careerCapability.findMany.mockResolvedValue([{ name: "React" }])
    mocks.careerCapability.createMany.mockResolvedValue({ count: 1 })

    const result = await createCapabilities(form({ names: "react, Vue" }))

    const { data } = mocks.careerCapability.createMany.mock.calls[0][0]
    expect(data.map((row: { name: string }) => row.name)).toEqual(["Vue"])
    expect(result).toEqual({ success: true, created: 1, skipped: 1 })
  })

  it("writes nothing when every name already exists", async () => {
    mocks.careerCapability.findMany.mockResolvedValue([{ name: "React" }, { name: "Vue" }])

    const result = await createCapabilities(form({ names: "react, VUE" }))

    expect(mocks.careerCapability.createMany).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, created: 0, skipped: 2 })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("refuses an empty submission", async () => {
    const result = await createCapabilities(form({ names: "  ,  " }))

    expect(result).toEqual({ error: "Add at least one skill" })
    expect(mocks.careerCapability.createMany).not.toHaveBeenCalled()
  })

  it("refuses more than 20 names in one submission", async () => {
    const names = Array.from({ length: 21 }, (_, i) => `Skill ${i}`).join(", ")

    const result = await createCapabilities(form({ names }))

    expect(result).toEqual({ error: "Add at most 20 skills at a time" })
    expect(mocks.careerCapability.createMany).not.toHaveBeenCalled()
  })

  it("refuses a name longer than the single-entry cap", async () => {
    const result = (await createCapabilities(
      form({ names: `React, ${"x".repeat(121)}` })
    )) as { error?: string }

    expect(result.error).toBeTruthy()
    expect(mocks.careerCapability.createMany).not.toHaveBeenCalled()
  })
})

describe("updateCareerPreferences", () => {
  it("writes only preference/direction fields, scoped to the caller's profile", async () => {
    await updateCareerPreferences(
      form({
        experienceLevel: "SENIOR",
        locations: "Manila, PH\n\n  Remote — APAC  ",
        openToRelocation: "true",
        workModes: ["REMOTE", "HYBRID"],
        requiresSponsorship: "no",
        salaryMin: "1000",
        salaryMax: "2000",
        salaryPeriod: "MONTHLY",
        salaryCurrency: "PHP",
        careerGoals: "Staff engineer",
      })
    )

    const call = mocks.careerProfile.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: OWN_PROFILE })
    expect(call.data).toEqual({
      experienceLevel: "SENIOR",
      locations: ["Manila, PH", "Remote — APAC"],
      openToRelocation: true,
      workModes: ["REMOTE", "HYBRID"],
      workAuthorization: null,
      requiresSponsorship: false,
      salaryMin: 1000,
      salaryMax: 2000,
      salaryPeriod: "MONTHLY",
      salaryCurrency: "PHP",
      careerGoals: "Staff engineer",
    })
  })

  it("drops an unknown work mode rather than persisting it", async () => {
    await updateCareerPreferences(form({ workModes: ["REMOTE", "MOON"] }))

    expect(mocks.careerProfile.update.mock.calls[0][0].data.workModes).toEqual(["REMOTE"])
  })

  it("leaves sponsorship unanswered when the field is blank", async () => {
    await updateCareerPreferences(form({ requiresSponsorship: "" }))

    expect(mocks.careerProfile.update.mock.calls[0][0].data.requiresSponsorship).toBeNull()
  })

  it("rejects an inverted salary range", async () => {
    const result = await updateCareerPreferences(
      form({ salaryMin: "5000", salaryMax: "1000" })
    )

    expect(result).toEqual({ error: "Minimum salary cannot be higher than the maximum." })
    expect(mocks.careerProfile.update).not.toHaveBeenCalled()
  })
})
