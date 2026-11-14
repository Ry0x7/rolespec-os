// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resumeFindFirst: vi.fn(),
  extractCareerFacts: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    resume: { findFirst: mocks.resumeFindFirst },
  },
}))

vi.mock("@/features/career-profile/services/import-linkedin.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/career-profile/services/import-linkedin.service")
  >("@/features/career-profile/services/import-linkedin.service")
  return { ...actual, extractCareerFacts: mocks.extractCareerFacts }
})

import { AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { IntakeAdapterError } from "../../types"
import type { ContactPatchData, EvidencePatchData } from "../../types"
import { githubIntakeAdapter } from "../github.adapter"
import { linkedinIntakeAdapter } from "../linkedin.adapter"
import { resumeIntakeAdapter } from "../resume.adapter"
import { webIntakeAdapter } from "../web.adapter"

const RESUME_TEXT = [
  "Ada Lovelace",
  "ada@example.com | London",
  "",
  "EXPERIENCE",
  "Backend Engineer",
  "Acme",
  "2021 - 2023",
  "- Built the billing API.",
  "",
  "SKILLS",
  "TypeScript, PostgreSQL",
].join("\n")

function progress() {
  return vi.fn().mockResolvedValue(undefined)
}

function runInput(input: Record<string, unknown>) {
  return {
    input,
    userId: "user-1",
    runId: "run-1",
    sourceRunId: "src-1",
    signal: new AbortController().signal,
    reportProgress: progress(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("resume adapter", () => {
  it("maps text to contact, experience and skill drafts with provenance", async () => {
    const result = await resumeIntakeAdapter.run(
      runInput({ text: RESUME_TEXT, fileName: "ada-resume.pdf" })
    )

    const email = result.patches.find(
      (draft) =>
        draft.kind === "CONTACT" &&
        (draft.data as ContactPatchData).field === "contactEmail"
    )
    expect((email?.data as ContactPatchData).value).toBe("ada@example.com")

    const experience = result.patches.find(
      (draft) => draft.kind === "EVIDENCE"
    )
    expect((experience?.data as EvidencePatchData).title).toBe("Backend Engineer")
    expect(experience?.provenance.adapter).toBe("resume-text")
    expect(experience?.provenance.fileName).toBe("ada-resume.pdf")
    expect(experience?.provenance.locator).toMatch(/^experience:/)

    const skills = result.patches
      .filter((draft) => draft.kind === "SKILL")
      .map((draft) => (draft.data as { name: string }).name)
    expect(skills).toEqual(expect.arrayContaining(["TypeScript", "PostgreSQL"]))
  })

  it("rejects unreadable text instead of returning invented facts", async () => {
    await expect(
      resumeIntakeAdapter.run(runInput({ text: "   " }))
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })
})

describe("LinkedIn adapter", () => {
  it("falls back to the deterministic export read when AI has no key", async () => {
    mocks.extractCareerFacts.mockRejectedValue(new AiKeyRequiredError())
    const text = "Ada Lovelace\nada@example.com\nSKILLS\nTypeScript"

    const result = await linkedinIntakeAdapter.run(
      runInput({ text, fileName: "linkedin.pdf", useAi: true })
    )

    expect(mocks.extractCareerFacts).toHaveBeenCalledTimes(1)
    expect(result.meta).toMatchObject({ mode: "deterministic-fallback" })
    expect((result.warnings ?? []).join(" ")).toMatch(/API key/i)
    expect(
      result.patches.some(
        (draft) =>
          draft.kind === "CONTACT" &&
          (draft.data as ContactPatchData).field === "contactEmail"
      )
    ).toBe(true)
  })

  it("does not call AI when the export already has structured facts", async () => {
    const result = await linkedinIntakeAdapter.run(
      runInput({ text: RESUME_TEXT, useAi: true })
    )

    expect(mocks.extractCareerFacts).not.toHaveBeenCalled()
    expect(result.meta).toMatchObject({ mode: "deterministic" })
  })
})

describe("public web adapters", () => {
  it("blocks a private IP before any network request", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      webIntakeAdapter.run(runInput({ url: "http://127.0.0.1/", consent: true }))
    ).rejects.toMatchObject({ code: "RESTRICTED" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("requires consent before fetching a site", async () => {
    await expect(
      webIntakeAdapter.run(runInput({ url: "https://ada.dev" }))
    ).rejects.toBeInstanceOf(IntakeAdapterError)
  })

  it("requires consent before reading GitHub", async () => {
    await expect(
      githubIntakeAdapter.run(runInput({ url: "https://github.com/ada" }))
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })
})
