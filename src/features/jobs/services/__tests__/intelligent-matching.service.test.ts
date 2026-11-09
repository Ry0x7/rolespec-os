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

const REQUIRED_SKILLS = `
Requirements:
- TypeScript
- React
- Node.js
- GraphQL
- Kubernetes
`

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

  it("ranks a well-evidenced role strongly and explains every scored factor", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: `${REQUIRED_SKILLS}\nWe are looking for a Senior Engineer with TypeScript and React experience. Remote role.`,
      workType: "REMOTE",
      salary: 150000,
      postedAt: new Date(),
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, profile)

    expect(result.compositeScore).toBeGreaterThanOrEqual(80)
    expect(result.priority).toBe("HIGH")
    expect(result.dimensions.skills.status).toBe("GOOD")
    expect(result.dimensions.skills.explanation).toContain("4 of 5 posting requirements")
    expect(result.dimensions.skills.explanation).toContain("Not evidenced: Kubernetes")
    expect(result.dimensions.experience.status).toBe("GOOD")
    expect(result.dimensions.locationAndWorkMode.status).toBe("GOOD")
    expect(result.dimensions.salary.status).toBe("GOOD")
    expect(result.dimensions.salary.explanation).toContain("150,000")
    // No eligibility restriction means eligibility is unknown, not a pass.
    expect(result.dimensions.eligibility.status).toBe("UNKNOWN")
    expect(result.dimensions.eligibility.score).toBeNull()
    expect(result.summary).toContain("Based on 6 of 7 factors")
    expect(result.summary).toContain("Eligibility & Authorization")
    expect(result.strengths).not.toContain("Meets stated eligibility and sponsorship criteria")
  })

  it("flags eligibility blocker when sponsorship is required and not offered", () => {
    const sponsoredProfile: IntelligentMatchingProfile = {
      ...profile,
      requiresSponsorship: true,
    }
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      workType: "REMOTE",
      requirementFlags: ["NO_SPONSORSHIP"],
    }

    const result = computeIntelligentMatch(job, sponsoredProfile)

    expect(result.compositeScore).toBe(0)
    expect(result.priority).toBe("INELIGIBLE")
    expect(result.dimensions.eligibility.status).toBe("BLOCKED")
    expect(result.gaps).toContain("No visa sponsorship available")
  })

  it("keeps no-sponsorship unknown when the profile has not answered", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: ["NO_SPONSORSHIP"],
    }

    const result = computeIntelligentMatch(job, { ...profile, requiresSponsorship: null })

    expect(result.dimensions.eligibility.status).toBe("UNKNOWN")
    expect(result.dimensions.eligibility.score).toBeNull()
    expect(result.dimensions.eligibility.explanation).toContain("has not answered")
    expect(result.gaps).not.toContain("No visa sponsorship available")
  })

  it("does not let a profile location stand in for US work authorization", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: ["US_ONLY"],
    }

    const result = computeIntelligentMatch(job, {
      ...profile,
      locations: ["New York, NY"],
      workAuthorization: null,
    })

    expect(result.dimensions.eligibility.status).toBe("UNKNOWN")
    expect(result.dimensions.eligibility.score).toBeNull()
    expect(result.dimensions.eligibility.explanation).toContain("not proof of authorization")
    expect(result.strengths.join(" ")).not.toContain("US work authorization")
  })

  it("scores a US-only posting from stated US work authorization", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: ["US_ONLY"],
    }

    const result = computeIntelligentMatch(job, {
      ...profile,
      workAuthorization: "US citizen, authorized to work in the United States",
    })

    expect(result.dimensions.eligibility.status).toBe("GOOD")
    expect(result.dimensions.eligibility.score).toBe(100)
  })

  it("does not let a negated US authorization statement satisfy the requirement", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: ["US_ONLY"],
    }

    for (const workAuthorization of [
      "Not authorized to work in the US",
      "I have no US work authorization",
      "Unable to work in the United States without sponsorship",
    ]) {
      const result = computeIntelligentMatch(job, { ...profile, workAuthorization })

      expect(result.dimensions.eligibility.status).toBe("UNKNOWN")
      expect(result.dimensions.eligibility.score).toBeNull()
      expect(result.strengths.join(" ")).not.toContain("US work authorization")
    }
  })

  it("reads a positive US authorization after a contrast", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: ["US_ONLY"],
    }

    const result = computeIntelligentMatch(job, {
      ...profile,
      workAuthorization: "Not a US citizen, but authorized to work in the US",
    })

    expect(result.dimensions.eligibility.status).toBe("GOOD")
  })

  it("does not let an unrelated earlier negation negate a later authorization", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: ["US_ONLY"],
    }

    const result = computeIntelligentMatch(job, {
      ...profile,
      workAuthorization: "I don't need sponsorship, authorized to work in the US",
    })

    expect(result.dimensions.eligibility.status).toBe("GOOD")
  })

  it("does not treat a negated citizenship statement as citizenship", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: ["CITIZENSHIP_REQUIRED"],
    }

    const result = computeIntelligentMatch(job, {
      ...profile,
      workAuthorization: "Not a US citizen",
    })

    expect(result.dimensions.eligibility.status).toBe("UNKNOWN")
    expect(result.dimensions.eligibility.score).toBeNull()
    expect(result.strengths.join(" ")).not.toContain("citizenship")
  })

  it("does not treat citizenship as a location question", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: ["CITIZENSHIP_REQUIRED"],
    }

    const result = computeIntelligentMatch(job, {
      ...profile,
      locations: ["New York, NY"],
      workAuthorization: null,
    })

    expect(result.dimensions.eligibility.status).toBe("UNKNOWN")
    expect(result.dimensions.eligibility.explanation).toContain("not proof of citizenship")
  })

  it("does not let a narrower capability claim a compound requirement", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: "Requirements:\nExperience with React Native is required.",
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, {
      capabilities: [{ name: "React", confirmedCount: 1 }],
    })

    expect(result.dimensions.skills.score).toBe(0)
    expect(result.dimensions.skills.status).toBe("CONCERN")
    expect(result.dimensions.skills.explanation).toContain("React Native")
  })

  it("penalizes work mode, seniority, pay and freshness mismatches", () => {
    const job: IntelligentMatchingJob = {
      title: "Junior Support Specialist",
      description: "Looking for an entry-level candidate. Onsite only.",
      workType: "ONSITE",
      salary: 50000,
      postedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    }

    const result = computeIntelligentMatch(job, profile)

    expect(result.compositeScore).toBeLessThan(60)
    expect(result.dimensions.experience.status).toBe("CONCERN")
    expect(result.dimensions.locationAndWorkMode.status).toBe("CONCERN")
    expect(result.dimensions.salary.status).toBe("CONCERN")
    expect(result.dimensions.freshness.status).toBe("CONCERN")
  })

  it("leaves freshness unknown when the posting date cannot be parsed", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      postedAt: new Date("not-a-date"),
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, profile)

    expect(result.dimensions.freshness.status).toBe("UNKNOWN")
    expect(result.dimensions.freshness.score).toBeNull()
    expect(result.dimensions.freshness.explanation).toContain("no usable")
    expect(result.strengths.join(" ")).not.toContain("Fresh posting")
  })

  it("annualizes an hourly posting before comparing it with a yearly minimum", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      salary: 50,
      salaryPeriod: "HOURLY",
      salaryCurrency: "USD",
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, profile)

    expect(result.dimensions.salary.status).toBe("CONCERN")
    expect(result.dimensions.salary.score).toBe(40)
    expect(result.dimensions.salary.explanation).toContain("104,000")
    expect(result.dimensions.salary.explanation).toContain("130,000")
  })

  it("refuses to compare salaries across currencies without a rate", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      salary: 100000,
      salaryPeriod: "YEARLY",
      salaryCurrency: "USD",
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, { ...profile, salaryCurrency: "PHP" })

    expect(result.dimensions.salary.status).toBe("UNKNOWN")
    expect(result.dimensions.salary.score).toBeNull()
    expect(result.dimensions.salary.explanation).toContain("currencies differ")
    expect(result.dimensions.salary.explanation).toContain("100,000")
  })

  it("leaves salary unknown rather than calling an unstated salary typical", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, profile)

    expect(result.dimensions.salary.status).toBe("UNKNOWN")
    expect(result.dimensions.salary.score).toBeNull()
    expect(result.strengths.join(" ")).not.toMatch(/salary|pay meets/i)
    expect(result.summary).toContain("Salary Alignment")
  })

  it("leaves work mode unknown when the posting or profile does not state one", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, profile)

    expect(result.dimensions.locationAndWorkMode.status).toBe("UNKNOWN")
    expect(result.dimensions.locationAndWorkMode.score).toBeNull()
    expect(result.dimensions.locationAndWorkMode.explanation).toContain("does not state")
  })

  it("leaves skills unknown when the posting names no requirements", () => {
    const job: IntelligentMatchingJob = {
      title: "Senior Full Stack Engineer",
      description: "We are a fast-growing team building useful things.",
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, profile)

    expect(result.dimensions.skills.status).toBe("UNKNOWN")
    expect(result.dimensions.skills.score).toBeNull()
    expect(result.dimensions.skills.explanation).toContain("does not name specific skills")
  })

  it("returns no composite at all when less than half the weight is known", () => {
    const job: IntelligentMatchingJob = {
      title: "Software Engineer",
      description: REQUIRED_SKILLS,
      requirementFlags: [],
    }

    const result = computeIntelligentMatch(job, {
      capabilities: [
        { name: "TypeScript", confirmedCount: 1 },
        { name: "React", confirmedCount: 0 },
      ],
    })

    expect(result.knownDimensions).toBe(2)
    expect(result.knownWeight).toBeCloseTo(0.4)
    expect(result.compositeScore).toBeNull()
    expect(result.priority).toBe("UNKNOWN")
    expect(result.summary).toContain("Not enough evidence")
  })
})
