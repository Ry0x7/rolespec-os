// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  careerProfile: { findUnique: vi.fn(), update: vi.fn() },
  careerEvidence: { findFirst: vi.fn(), updateMany: vi.fn() },
  consumeRateLimit: vi.fn(),
  enhanceProfileText: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    careerProfile: mocks.careerProfile,
    careerEvidence: mocks.careerEvidence,
  },
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { AI_PROFILE_ENHANCE: "ai:profile-enhance" },
  consumeRateLimit: mocks.consumeRateLimit,
}))
vi.mock("../../services/enhance-profile", () => ({
  enhanceProfileText: mocks.enhanceProfileText,
}))

import { enhanceCareerGoals, enhanceEvidence } from "../enhance"

const OWN_PROFILE = "cp_user1"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
  // First call is `resolveOwnProfileId`, second is the field read.
  mocks.careerProfile.findUnique
    .mockResolvedValueOnce({ id: OWN_PROFILE })
    .mockResolvedValue({
      careerGoals: "want to be like a manager maybe",
      targetRoles: [{ title: "Engineering Manager" }],
    })
  mocks.careerProfile.update.mockResolvedValue({ id: OWN_PROFILE })
  mocks.careerEvidence.findFirst.mockResolvedValue({
    id: "ev_1",
    kind: "EXPERIENCE",
    title: "Frontend Engineer",
    organization: "Acme Inc.",
    details: "did stuff with the checkout thing",
  })
  mocks.careerEvidence.updateMany.mockResolvedValue({ count: 1 })
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.enhanceProfileText.mockResolvedValue({
    improved: "Move into engineering management while staying hands-on.",
    unchanged: false,
  })
})

describe("authentication and scoping", () => {
  it.each([
    ["enhanceCareerGoals", () => enhanceCareerGoals()],
    ["enhanceEvidence", () => enhanceEvidence("ev_1")],
  ])("%s refuses an anonymous caller before any read", async (_name, invoke) => {
    mocks.auth.mockResolvedValue(null)

    await expect(invoke()).resolves.toEqual({ error: "Unauthorized" })
    expect(mocks.careerProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.careerEvidence.findFirst).not.toHaveBeenCalled()
    expect(mocks.enhanceProfileText).not.toHaveBeenCalled()
  })

  it.each([
    ["enhanceCareerGoals", () => enhanceCareerGoals()],
    ["enhanceEvidence", () => enhanceEvidence("ev_1")],
  ])("%s refuses when the caller has no career profile", async (_name, invoke) => {
    mocks.careerProfile.findUnique.mockReset().mockResolvedValue(null)

    const result = (await invoke()) as { error?: string }
    expect(result.error).toBeTruthy()
    expect(mocks.enhanceProfileText).not.toHaveBeenCalled()
    expect(mocks.careerProfile.update).not.toHaveBeenCalled()
    expect(mocks.careerEvidence.updateMany).not.toHaveBeenCalled()
  })

  it("looks the profile up by session user id, never by a client value", async () => {
    await enhanceCareerGoals()

    expect(mocks.careerProfile.findUnique).toHaveBeenNthCalledWith(1, {
      where: { userId: "user_1" },
      select: { id: true },
    })
  })

  it("reads evidence scoped to the caller's own profile", async () => {
    await enhanceEvidence("ev_1")

    expect(mocks.careerEvidence.findFirst).toHaveBeenCalledWith({
      where: { id: "ev_1", careerProfileId: OWN_PROFILE },
      select: {
        id: true,
        kind: true,
        title: true,
        organization: true,
        details: true,
      },
    })
  })

  it("reports not found for an evidence id the caller does not own", async () => {
    mocks.careerEvidence.findFirst.mockResolvedValue(null)

    await expect(enhanceEvidence("ev_other")).resolves.toEqual({ error: "Not found" })
    expect(mocks.enhanceProfileText).not.toHaveBeenCalled()
    expect(mocks.careerEvidence.updateMany).not.toHaveBeenCalled()
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
  })

  it("reports not found when the scoped write matches nothing", async () => {
    mocks.careerEvidence.updateMany.mockResolvedValue({ count: 0 })

    await expect(enhanceEvidence("ev_1")).resolves.toEqual({ error: "Not found" })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe("enhanceCareerGoals", () => {
  it("persists the improved text scoped to the caller's profile and revalidates", async () => {
    const result = await enhanceCareerGoals()

    expect(mocks.careerProfile.update).toHaveBeenCalledWith({
      where: { id: OWN_PROFILE },
      data: { careerGoals: "Move into engineering management while staying hands-on." },
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/career-profile")
    expect(result).toEqual({
      success: true,
      previous: "want to be like a manager maybe",
      enhanced: "Move into engineering management while staying hands-on.",
      unchanged: false,
    })
  })

  it("passes the stored text plus the active target roles as context", async () => {
    await enhanceCareerGoals()

    expect(mocks.enhanceProfileText).toHaveBeenCalledWith({
      userId: "user_1",
      field: "careerGoals",
      text: "want to be like a manager maybe",
      context: { targetRoles: ["Engineering Manager"] },
    })
  })

  it("writes nothing when the service reports the text unchanged", async () => {
    mocks.enhanceProfileText.mockResolvedValue({
      improved: "want to be like a manager maybe",
      unchanged: true,
    })

    const result = await enhanceCareerGoals()

    expect(mocks.careerProfile.update).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      previous: "want to be like a manager maybe",
      enhanced: "want to be like a manager maybe",
      unchanged: true,
    })
  })

  it("refuses an empty field without spending an AI call or a rate-limit attempt", async () => {
    mocks.careerProfile.findUnique
      .mockReset()
      .mockResolvedValueOnce({ id: OWN_PROFILE })
      .mockResolvedValue({ careerGoals: "   ", targetRoles: [] })

    const result = await enhanceCareerGoals()

    expect(result).toEqual({
      error: "Write your career goals first, then enhance them.",
    })
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
    expect(mocks.enhanceProfileText).not.toHaveBeenCalled()
  })
})

describe("enhanceEvidence", () => {
  it("writes only details, scoped to the caller's profile", async () => {
    mocks.enhanceProfileText.mockResolvedValue({
      improved: "Rebuilt the checkout flow end to end.",
      unchanged: false,
    })

    const result = await enhanceEvidence("ev_1")

    expect(mocks.careerEvidence.updateMany).toHaveBeenCalledWith({
      where: { id: "ev_1", careerProfileId: OWN_PROFILE },
      data: { details: "Rebuilt the checkout flow end to end." },
    })
    const { data } = mocks.careerEvidence.updateMany.mock.calls[0][0]
    expect(data).not.toHaveProperty("title")
    expect(data).not.toHaveProperty("outcome")
    expect(data).not.toHaveProperty("source")
    expect(data).not.toHaveProperty("status")
    expect(data).not.toHaveProperty("confirmedAt")
    expect(result).toEqual({
      success: true,
      previous: "did stuff with the checkout thing",
      enhanced: "Rebuilt the checkout flow end to end.",
      unchanged: false,
    })
  })

  it("passes the row's own title, organization and kind as read-only context", async () => {
    await enhanceEvidence("ev_1")

    expect(mocks.enhanceProfileText).toHaveBeenCalledWith({
      userId: "user_1",
      field: "evidenceDetails",
      text: "did stuff with the checkout thing",
      context: {
        evidenceKind: "EXPERIENCE",
        evidenceTitle: "Frontend Engineer",
        evidenceOrganization: "Acme Inc.",
      },
    })
  })

  it("writes nothing when the service reports the text unchanged", async () => {
    mocks.enhanceProfileText.mockResolvedValue({
      improved: "did stuff with the checkout thing",
      unchanged: true,
    })

    const result = await enhanceEvidence("ev_1")

    expect(mocks.careerEvidence.updateMany).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, unchanged: true })
  })

  it("refuses a row with no details yet", async () => {
    mocks.careerEvidence.findFirst.mockResolvedValue({
      id: "ev_1",
      kind: "PROJECT",
      title: "Thing",
      organization: null,
      details: null,
    })

    const result = await enhanceEvidence("ev_1")

    expect(result).toEqual({ error: "Add some details first, then enhance them." })
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
  })
})

describe("rate limiting", () => {
  it.each([
    ["enhanceCareerGoals", () => enhanceCareerGoals()],
    ["enhanceEvidence", () => enhanceEvidence("ev_1")],
  ])("%s stops at the limit without calling the model", async (_name, invoke) => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const result = (await invoke()) as { error?: string }

    expect(result.error).toBe(
      "Too many enhance runs. Please wait a few minutes and try again."
    )
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "ai:profile-enhance",
      "user_1",
      { max: 20, windowMs: 10 * 60 * 1000 }
    )
    expect(mocks.enhanceProfileText).not.toHaveBeenCalled()
    expect(mocks.careerProfile.update).not.toHaveBeenCalled()
    expect(mocks.careerEvidence.updateMany).not.toHaveBeenCalled()
  })
})

describe("AI failures", () => {
  it("reports a generic error and writes nothing when the service throws", async () => {
    mocks.enhanceProfileText.mockRejectedValue(new Error("provider exploded"))

    const result = await enhanceCareerGoals()

    expect(result).toEqual({ error: "Enhance failed. Please try again." })
    expect(mocks.careerProfile.update).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
