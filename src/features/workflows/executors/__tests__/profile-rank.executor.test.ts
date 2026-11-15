import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  applicationFindFirst: vi.fn(),
  profileFindUnique: vi.fn(),
  readRankingProfile: vi.fn(),
  researchJob: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    jobApplication: { findFirst: mocks.applicationFindFirst },
    careerProfile: { findUnique: mocks.profileFindUnique },
  },
}))

vi.mock("@/features/ranking/services/ranking-profile.service", () => ({
  readRankingProfile: mocks.readRankingProfile,
}))

vi.mock("@/features/jobs/services/three-layer-research.service", () => ({
  researchJob: mocks.researchJob,
}))

import { discoveryExecutor } from "../discovery.executor"
import { profileExecutor } from "../profile.executor"
import { rankExecutor } from "../rank.executor"
import { researchExecutor } from "../research.executor"
import type { WorkflowExecutionContext, WorkflowStepName } from "../../types"

const NOW = new Date("2026-11-11T00:00:00.000Z")

function context(stepName: WorkflowStepName): WorkflowExecutionContext {
  return {
    runId: "run-1",
    stepId: "step-1",
    userId: "user-1",
    jobApplicationId: "app-1",
    input: { jobApplicationId: "app-1" },
    stepName,
    attempt: 1,
    signal: new AbortController().signal,
    now: NOW,
  }
}

const PROFILE = {
  locations: ["Philippines"],
  openToRelocation: false,
  workModes: ["REMOTE"],
  requiresSponsorship: null,
  experienceLevel: "SENIOR",
  salaryMin: null,
  salaryMax: null,
  salaryPeriod: null,
  salaryCurrency: "PHP",
  targetRoleTitles: ["Backend Engineer"],
  capabilities: [{ name: "TypeScript", confirmed: true }],
  evidence: [{ title: "Payments platform", details: "TypeScript", confirmed: true }],
}

const JOB = {
  id: "job-1",
  title: "Senior Backend Engineer",
  companyName: "Acme",
  description: "Build TypeScript services.",
  location: "Remote - Philippines",
  workType: "REMOTE",
  url: "https://acme.example/1",
  salary: null,
  salaryPeriod: null,
  salaryCurrency: "PHP",
  postedAt: new Date("2026-11-05T00:00:00.000Z"),
  requirementFlags: ["SPONSORSHIP_AVAILABLE"],
}

const APPLICATION = {
  id: "app-1",
  userId: "user-1",
  status: "INTERESTED",
  dateApplied: null,
  followUpAt: null,
  lastFollowedUpAt: null,
  resumeId: null,
  job: JOB,
}

const RESEARCH = {
  requirements: {
    required: ["3+ years TypeScript"],
    preferred: [],
    flags: ["SPONSORSHIP_AVAILABLE"],
    uncertainty: ["The posting does not state preferred qualifications."],
  },
  company: {
    companyName: "Acme",
    industry: null,
    headquarters: null,
    companySize: null,
    overview: "Acme is hiring.",
    keyProducts: [],
    statedMissionOrValues: [],
    techStack: ["TypeScript"],
    interviewTips: [],
    citations: [
      {
        title: "Acme posting",
        url: "https://acme.example/1",
        sourceType: "POSTING" as const,
        verified: true,
      },
    ],
    confidence: "LOW" as const,
    confidenceExplanation: "No independent company source could be fetched.",
    researchedAt: NOW.toISOString(),
  },
  culture: {
    signals: [
      { label: "Remote policy", value: null, state: "UNKNOWN" as const, citations: [] },
    ],
    confidence: "LOW" as const,
    explanation: "No independent company source could be fetched.",
    conflicts: [],
  },
  sourceSummary: { totalSources: 1, independentSources: 0, hosts: ["acme.example"] },
  researchedAt: NOW.toISOString(),
  cached: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.applicationFindFirst.mockResolvedValue(APPLICATION)
  mocks.profileFindUnique.mockResolvedValue({
    updatedAt: NOW,
    contactEmail: "me@example.com",
    contactPhone: null,
    salaryMin: null,
    salaryMax: null,
    targetRoles: [{ title: "Backend Engineer" }],
    capabilities: [
      { name: "TypeScript", confirmed: true },
      { name: "AWS", confirmed: false },
    ],
    evidence: [{ id: "e1" }],
  })
  mocks.readRankingProfile.mockResolvedValue(PROFILE)
  mocks.researchJob.mockResolvedValue(RESEARCH)
})

describe("profileExecutor", () => {
  it("asks for a target role instead of failing when the profile has none", async () => {
    mocks.profileFindUnique.mockResolvedValue({
      updatedAt: NOW,
      contactEmail: null,
      contactPhone: null,
      salaryMin: null,
      salaryMax: null,
      targetRoles: [],
      capabilities: [],
      evidence: [],
    })

    const result = await profileExecutor(context("PROFILE"))

    expect(result.status).toBe("WAITING_FOR_USER")
    if (result.status === "WAITING_FOR_USER") {
      expect(result.review.kind).toBe("MISSING_PROFILE_FACT")
      expect(result.review.question).toContain("role")
      expect(result.review.fallback).toContain("Career Profile")
    }
  })

  it("reports confirmed profile counts without writing the profile", async () => {
    const result = await profileExecutor(context("PROFILE"))

    expect(result.status).toBe("COMPLETED")
    if (result.status === "COMPLETED") {
      expect(result.output).toMatchObject({
        targetRoles: 1,
        confirmedCapabilities: 1,
        confirmedEvidence: 1,
        hasContactEmail: true,
        hasContactPhone: false,
      })
    }
  })
})

describe("discoveryExecutor", () => {
  it("skips without failing when there is no active role", async () => {
    mocks.profileFindUnique.mockResolvedValue({
      locations: [],
      workModes: [],
      experienceLevel: null,
      targetRoles: [],
      capabilities: [],
    })

    const result = await discoveryExecutor(context("DISCOVER"))

    expect(result.status).toBe("SKIPPED")
  })

  it("builds queries and board links from the profile", async () => {
    mocks.profileFindUnique.mockResolvedValue({
      locations: ["Philippines"],
      workModes: ["REMOTE"],
      experienceLevel: "SENIOR",
      targetRoles: [{ title: "Backend Engineer", priority: 0, active: true }],
      capabilities: [{ name: "TypeScript", confirmed: true }],
    })

    const result = await discoveryExecutor(context("DISCOVER"))

    expect(result.status).toBe("COMPLETED")
    if (result.status === "COMPLETED") {
      expect(result.output.queries).toEqual([
        { role: "Backend Engineer", keywords: ["TypeScript"] },
      ])
      expect(Array.isArray(result.output.links)).toBe(true)
      expect((result.output.links as unknown[]).length).toBe(3)
    }
  })
})

describe("rankExecutor", () => {
  it("stores the seven factors and never writes the job or application", async () => {
    const result = await rankExecutor(context("RANK"))

    expect(result.status).toBe("COMPLETED")
    if (result.status === "COMPLETED") {
      expect(result.output.score).toBeTypeOf("number")
      expect(result.output.factors).toHaveLength(7)
      expect(result.output.explanation).toBeInstanceOf(Array)
    }
    expect(mocks.applicationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "app-1", userId: "user-1" } })
    )
  })

  it("fails with a manual path when the application no longer exists", async () => {
    mocks.applicationFindFirst.mockResolvedValue(null)

    const result = await rankExecutor(context("RANK"))

    expect(result.status).toBe("FAILED")
    if (result.status === "FAILED") {
      expect(result.retryable).toBe(false)
      expect(result.fallback).toContain("tracker")
    }
  })
})

describe("researchExecutor", () => {
  it("completes with explicit uncertainty when the company layer is degraded", async () => {
    const result = await researchExecutor(context("RESEARCH"))

    expect(result.status).toBe("COMPLETED")
    if (result.status === "COMPLETED") {
      expect(result.output.companyConfidence).toBe("LOW")
      expect(result.output.independentSources).toBe(0)
      expect(result.output.uncertainty).toContain(
        "No independent company source could be fetched."
      )
    }
  })

  it("fails retryably with a real next action when research throws", async () => {
    mocks.researchJob.mockRejectedValue(new Error("provider exploded"))

    const result = await researchExecutor(context("RESEARCH"))

    expect(result.status).toBe("FAILED")
    if (result.status === "FAILED") {
      expect(result.retryable).toBe(true)
      expect(result.fallback).toContain("company research")
    }
  })
})
