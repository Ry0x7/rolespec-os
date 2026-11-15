// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  consumeRateLimit: vi.fn(),
  getOrCreateCareerProfileId: vi.fn(),
  scanGitHub: vi.fn(),
  scanPortfolio: vi.fn(),
  evidence: { findMany: vi.fn(), create: vi.fn() },
  capability: { findMany: vi.fn(), create: vi.fn() },
  link: { createMany: vi.fn() },
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    careerEvidence: mocks.evidence,
    careerCapability: mocks.capability,
    careerEvidenceCapability: mocks.link,
  },
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { CAREER_WEB_IMPORT: "career:web-import" },
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
  consumeRateLimit: mocks.consumeRateLimit,
}))
vi.mock("../../services/career-profile.service", () => ({
  getOrCreateCareerProfileId: mocks.getOrCreateCareerProfileId,
}))
vi.mock("../../services/web-presence.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/web-presence.service")>()
  return {
    ...actual,
    scanGitHub: mocks.scanGitHub,
    scanPortfolio: mocks.scanPortfolio,
  }
})

import { scanCareerWebSource } from "../web-presence.actions"
import { WebSourceError } from "../../services/web-presence.service"

const PROFILE = "cp_owner"

const GITHUB_SCAN = {
  profile: {
    login: "ada",
    name: "Ada Lovelace",
    htmlUrl: "https://github.com/ada",
    bio: null,
    publicRepos: 1,
  },
  repositories: [
    {
      name: "note-compiler",
      url: "https://github.com/ada/note-compiler",
      description: "Markdown to notebooks, built with TypeScript.",
      language: "TypeScript",
      topics: [],
      stars: 4,
      pushedAt: "2026-10-01T10:00:00Z",
      homepage: null,
    },
  ],
}

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.getOrCreateCareerProfileId.mockResolvedValue(PROFILE)
  mocks.scanGitHub.mockResolvedValue(GITHUB_SCAN)
  mocks.scanPortfolio.mockResolvedValue({
    url: "https://ada.example.com/",
    host: "ada.example.com",
    title: "Ada",
    description: "Engineer",
    headings: ["Projects", "Note compiler"],
    text: "TypeScript",
    projects: [],
  })
  mocks.evidence.findMany.mockResolvedValue([])
  mocks.evidence.create.mockResolvedValue({ id: "ev_1" })
  mocks.capability.findMany.mockResolvedValue([])
  mocks.capability.create.mockImplementation(async (args: { data: { name: string } }) => ({
    id: `cap_${args.data.name}`,
  }))
  mocks.link.createMany.mockResolvedValue({ count: 1 })
})

describe("scanCareerWebSource", () => {
  it("refuses an anonymous caller before any network access", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(
      scanCareerWebSource(form({ source: "github", url: "ada", confirm: "on" }))
    ).resolves.toEqual({ error: "Unauthorized" })
    expect(mocks.scanGitHub).not.toHaveBeenCalled()
  })

  it("requires the opt-in confirmation on the server", async () => {
    await expect(
      scanCareerWebSource(form({ source: "github", url: "https://github.com/ada" }))
    ).resolves.toEqual({
      error: "Confirm that the profile belongs to you before scanning.",
    })
    expect(mocks.scanGitHub).not.toHaveBeenCalled()
  })

  it("rejects an unknown source", async () => {
    await expect(
      scanCareerWebSource(form({ source: "linkedin", url: "ada", confirm: "on" }))
    ).resolves.toEqual({ error: "Choose GitHub or a portfolio page." })
  })

  it("writes candidate evidence and links with GitHub provenance", async () => {
    const result = await scanCareerWebSource(
      form({
        source: "github",
        url: "https://github.com/ada",
        confirm: "on",
      })
    )

    expect(result).toMatchObject({
      success: true,
      source: "github",
      label: "github.com/ada",
      evidenceCreated: 1,
      capabilitiesCreated: expect.any(Number),
    })

    const evidenceData = mocks.evidence.create.mock.calls[0][0].data
    expect(evidenceData).toMatchObject({
      careerProfileId: PROFILE,
      kind: "PROJECT",
      title: "note-compiler",
      organization: "GitHub",
      source: "GITHUB_IMPORT_CANDIDATE",
      status: "CANDIDATE",
    })
    expect(evidenceData).not.toHaveProperty("confirmedAt")
    expect(evidenceData.metadata).toMatchObject({
      source: "github",
      sourceUrl: "https://github.com/ada/note-compiler",
    })

    expect(mocks.link.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          evidenceId: "ev_1",
          capabilityId: "cap_TypeScript",
          depth: "WORKING",
        }),
      ]),
      skipDuplicates: true,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/career-profile")
  })

  it("stores portfolio facts with portfolio provenance and exposure depth", async () => {
    mocks.evidence.create.mockResolvedValue({ id: "ev_portfolio" })

    const result = await scanCareerWebSource(
      form({
        source: "portfolio",
        url: "https://ada.example.com",
        confirm: "on",
      })
    )

    expect(result).toMatchObject({ success: true, source: "portfolio" })
    expect(mocks.evidence.create.mock.calls[0][0].data).toMatchObject({
      source: "PORTFOLIO_IMPORT_CANDIDATE",
      status: "CANDIDATE",
    })
    expect(mocks.link.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ capabilityId: "cap_TypeScript", depth: "EXPOSURE" }),
        ]),
      })
    )
  })

  it("skips evidence and skills that already exist in the profile", async () => {
    mocks.evidence.findMany.mockResolvedValue([
      { id: "ev_old", kind: "PROJECT", title: "note-compiler", organization: "GitHub" },
    ])
    mocks.capability.findMany.mockResolvedValue([
      { id: "cap_old", name: "TypeScript" },
      { id: "cap_old_2", name: "NodeJS" },
    ])

    const result = await scanCareerWebSource(
      form({ source: "github", url: "https://github.com/ada", confirm: "on" })
    )

    expect(result).toMatchObject({
      success: true,
      evidenceCreated: 0,
      evidenceSkipped: 1,
    })
    expect(mocks.evidence.create).not.toHaveBeenCalled()
  })

  it("turns a blocked target into user-facing copy", async () => {
    mocks.scanPortfolio.mockRejectedValue(
      new WebSourceError("BLOCKED_HOST", "Private and local addresses cannot be scanned.")
    )

    await expect(
      scanCareerWebSource(
        form({
          source: "portfolio",
          url: "http://127.0.0.1",
          confirm: "on",
        })
      )
    ).resolves.toEqual({ error: "Private and local addresses cannot be scanned." })
    expect(mocks.evidence.create).not.toHaveBeenCalled()
  })

  it("honours the rate limit", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    await expect(
      scanCareerWebSource(
        form({ source: "github", url: "https://github.com/ada", confirm: "on" })
      )
    ).resolves.toEqual({ error: "Too many attempts. Please try again later." })
    expect(mocks.scanGitHub).not.toHaveBeenCalled()
  })
})
