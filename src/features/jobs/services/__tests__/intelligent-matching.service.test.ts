import { describe, expect, it } from "vitest"
import {
  computeIntelligentMatch,
  detectJobSeniority,
  type IntelligentMatchingJob,
  type IntelligentMatchingProfile,
} from "../intelligent-matching.service"

describe("detectJobSeniority", () => {
  it("detects senior from title", () => {
    expect(detectJobSeniority("Senior Full Stack Engineer")).toBe("SENIOR")
    expect(detectJobSeniority("Sr. Software Engineer")).toBe("SENIOR")
  })

  it("detects lead from title", () => {
    expect(detectJobSeniority("Tech Lead / Engineering Manager")).toBe("LEAD")
    expect(detectJobSeniority("Staff Software Engineer")).toBe("LEAD")
  })

  it("detects junior from title", () => {
    expect(detectJobSeniority("Junior Web Developer")).toBe("JUNIOR")
    expect(detectJobSeniority("Associate Engineer")).toBe("JUNIOR")
  })

  it("detects executive from title", () => {
    expect(detectJobSeniority("VP of Engineering")).toBe("EXECUTIVE")
    expect(detectJobSeniority("Director of Product")).toBe("EXECUTIVE")
  })

  it("returns null when no seniority words found", () => {
    expect(detectJobSeniority("Software Engineer")).toBeNull()
  })
})

describe("computeIntelligentMatch", () => {
  const profile: IntelligentMatchingProfile = {
    experienceLevel: "SENIOR",
    locations: ["Remote", "New York, NY"],
    workModes: ["REMOTE", "HYBRID"],
    requiresSponsorship: false,
    salaryMin: 130000,
    salaryCurrency: "USD",
    capabilities: [
      { name: "TypeScript", depth: "DEEP", confirmedCount: 3 },
      { name: "React", depth: "DEEP", confirmedCount: 2 },
      { name: "Node.js", depth: "WORKING", confirmedCount: 1 },
      { name: "GraphQL", depth: "EXPOSURE", confirmedCount: 0 },
    ],
  }

  it("ranks a high-match role strongly with explainable score", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: "We are looking for a Senior Engineer with TypeScript and React experience. Remote role.",
      workType: "REMOTE",
      salary: 150000,
      postedAt: new Date(),
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, profile)

    expect(result.compositeScore).toBeGreaterThanOrEqual(80)
    expect(result.priority).toBe("HIGH")
    expect(result.dimensions.skills.status).toBe("GOOD")
    expect(result.dimensions.experience.status).toBe("GOOD")
    expect(result.dimensions.locationAndWorkMode.status).toBe("GOOD")
    expect(result.dimensions.salary.status).toBe("GOOD")
    expect(result.dimensions.eligibility.status).toBe("GOOD")
    expect(result.strengths.length).toBeGreaterThan(0)
  })

  it("flags eligibility blocker when sponsorship required but not offered", () => {
    const sponsoredProfile: IntelligentMatchingProfile = {
      ...profile,
      requiresSponsorship: true,
    }
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: "Must be a US Citizen or permanent resident. No visa sponsorship provided.",
      workType: "REMOTE",
      requirementFlags: ["NO_SPONSORSHIP"],
    }

    const result = computeIntelligentMatch(job, sponsoredProfile)

    expect(result.compositeScore).toBe(0)
    expect(result.priority).toBe("INELIGIBLE")
    expect(result.dimensions.eligibility.status).toBe("BLOCKED")
    expect(result.gaps).toContain("No visa sponsorship available")
  })

  it("penalizes work mode mismatch and seniority difference", () => {
    const job: IntelligentMatchingJob = {
      title: "Junior Support Specialist",
      description: "Looking for an entry-level candidate. Onsite only.",
      workType: "ONSITE",
      salary: 50000,
      postedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days old
    }

    const result = computeIntelligentMatch(job, profile)

    expect(result.compositeScore).toBeLessThan(60)
    expect(result.dimensions.experience.status).toBe("CONCERN")
    expect(result.dimensions.locationAndWorkMode.status).toBe("CONCERN")
    expect(result.dimensions.salary.status).toBe("CONCERN")
    expect(result.dimensions.freshness.status).toBe("CONCERN")
  })
})
