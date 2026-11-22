import { describe, expect, it } from "vitest"

import { buildCareerPath } from "../engine"
import type {
  CareerCapabilityDefinition,
  CareerPathCapabilityInput,
  CareerPathCatalog,
  CareerPathEvidenceInput,
  CareerPathProfileInput,
  CareerPathResult,
} from "../types"

const AS_OF = "2026-11-01T00:00:00.000Z"

const CAPABILITY_DEFINITIONS: CareerCapabilityDefinition[] = [
  {
    key: "communication",
    label: "Communication",
    aliases: ["written communication", "verbal communication"],
    learningStep: "Present a project outcome to a non-specialist audience and collect written feedback.",
  },
  {
    key: "customer-success",
    label: "Customer success",
    aliases: ["customer support", "client success", "csm"],
    learningStep: "Document one customer journey and the measurable outcome you improved.",
  },
  {
    key: "crm",
    label: "CRM",
    aliases: ["salesforce", "hubspot", "customer relationship management"],
    learningStep: "Build a small CRM pipeline and record three evidence-backed customer updates.",
  },
  {
    key: "onboarding",
    label: "Onboarding",
    aliases: ["customer onboarding", "client onboarding", "user onboarding"],
    learningStep: "Design and run a short onboarding checklist, then measure completion.",
  },
  {
    key: "stakeholder-management",
    label: "Stakeholder management",
    aliases: ["stakeholder management", "stakeholders"],
    learningStep: "Map the stakeholders on one project and record the decisions they shaped.",
  },
  {
    key: "negotiation",
    label: "Negotiation",
    aliases: ["contract negotiation", "commercial negotiation"],
    learningStep: "Practise a written commercial negotiation and record the agreed outcome.",
  },
  {
    key: "sales",
    label: "Sales",
    aliases: ["b2b sales", "quota carrying"],
    learningStep: "Run a small outreach sequence and document reply and conversion results.",
  },
  {
    key: "leadership",
    label: "Leadership",
    aliases: ["team leadership", "people management"],
    learningStep: "Lead a scoped team project and record the decisions, risks and outcomes.",
  },
  {
    key: "copywriting",
    label: "Copywriting",
    aliases: ["copy writing", "content writing"],
    learningStep: "Write three public pieces and attach their measured audience response.",
  },
  {
    key: "project-management",
    label: "Project management",
    aliases: ["campaign management", "program management", "project delivery"],
    learningStep: "Deliver a small project with a written plan, milestones and a retro.",
  },
  {
    key: "analytics-tools",
    label: "Analytics tools",
    aliases: ["google analytics", "mixpanel"],
    learningStep: "Build a dashboard for one real funnel and explain the decision it supports.",
  },
  {
    key: "content-strategy",
    label: "Content strategy",
    aliases: ["content strategy"],
    learningStep: "Produce a content map for one audience with a measurement plan.",
  },
  {
    key: "seo",
    label: "SEO",
    aliases: ["search engine optimization", "search engine optimisation"],
    learningStep: "Audit one public page and record the search changes you shipped.",
  },
  {
    key: "programming",
    label: "Programming",
    aliases: ["javascript", "typescript", "python", "go", "java", "software development"],
    learningStep: "Ship a small working feature and link its repository and tests.",
  },
  {
    key: "git",
    label: "Version control",
    aliases: ["github", "gitlab", "version control"],
    learningStep: "Contribute a reviewed change to a shared repository and link the commit.",
  },
  {
    key: "testing",
    label: "Testing",
    aliases: ["unit testing", "automated testing", "qa"],
    learningStep: "Add automated tests to an existing project and record the failure they prevent.",
  },
  {
    key: "react",
    label: "React",
    aliases: ["react js", "reactjs", "react 19"],
    learningStep: "Build and document one accessible React interface with tests.",
  },
  {
    key: "sql",
    label: "SQL",
    aliases: ["postgresql", "mysql", "sql queries"],
    learningStep: "Answer three real questions with SQL and record the queries and findings.",
  },
  {
    key: "data-analysis",
    label: "Data analysis",
    aliases: ["data analysis", "data analytics"],
    learningStep: "Analyse a public dataset and write the decision it would change.",
  },
  {
    key: "statistics",
    label: "Statistics",
    aliases: ["statistical analysis"],
    learningStep: "Run a small experiment and document the sampling and uncertainty.",
  },
  {
    key: "patient-care",
    label: "Patient care",
    aliases: ["clinical care"],
    learningStep: "Record a supervised care scenario and the outcome it produced.",
  },
  {
    key: "system-design",
    label: "System design",
    aliases: ["distributed systems", "software architecture", "systems design"],
    learningStep: "Write a design document for a small service, including trade-offs and failure modes.",
  },
  {
    key: "mentoring",
    label: "Mentoring",
    aliases: ["coaching", "mentorship"],
    learningStep: "Mentor one person through a shipped change and record the outcome.",
  },
]

const FIXTURE_CATALOG: CareerPathCatalog = {
  version: "fixture-2026.11",
  families: [
    { id: "customer", label: "Customer", summary: "Customer-facing roles." },
    { id: "marketing", label: "Marketing", summary: "Content and growth roles." },
    { id: "engineering", label: "Engineering", summary: "Software roles." },
    { id: "data", label: "Data", summary: "Analysis roles." },
    { id: "sales", label: "Sales", summary: "Revenue roles." },
    { id: "health", label: "Health", summary: "Clinical roles." },
  ],
  occupations: [
    {
      id: "csm",
      title: "Customer Success Manager",
      familyId: "customer",
      summary: "Owns customer outcomes after onboarding.",
      entryLevel: "MID",
      requirements: [
        { capabilityKey: "customer-success", weight: 3, critical: true },
        { capabilityKey: "communication", weight: 2, critical: true },
        { capabilityKey: "crm", weight: 2 },
        { capabilityKey: "onboarding", weight: 1 },
      ],
      preferred: [{ capabilityKey: "stakeholder-management", weight: 1 }],
      adjacentIds: [],
      growthIds: ["account-executive"],
      regions: ["GLOBAL"],
    },
    {
      id: "account-executive",
      title: "Account Executive",
      familyId: "sales",
      summary: "Runs commercial conversations and closes revenue.",
      entryLevel: "MID",
      requirements: [
        { capabilityKey: "communication", weight: 2, critical: true },
        { capabilityKey: "crm", weight: 2 },
        { capabilityKey: "sales", weight: 2 },
        { capabilityKey: "negotiation", weight: 2, critical: true },
      ],
      preferred: [{ capabilityKey: "customer-success", weight: 2 }],
      adjacentIds: ["csm"],
      growthIds: ["sales-manager"],
      regions: ["GLOBAL"],
    },
    {
      id: "sales-manager",
      title: "Sales Manager",
      familyId: "sales",
      summary: "Leads a small revenue team.",
      entryLevel: "SENIOR",
      requirements: [
        { capabilityKey: "leadership", weight: 3, critical: true },
        { capabilityKey: "sales", weight: 3 },
        { capabilityKey: "communication", weight: 2 },
      ],
      preferred: [{ capabilityKey: "negotiation", weight: 2 }],
      adjacentIds: [],
      growthIds: [],
      regions: ["GLOBAL"],
    },
    {
      id: "marketing-coordinator",
      title: "Marketing Coordinator",
      familyId: "marketing",
      summary: "Coordinates campaigns and writes customer-facing copy.",
      entryLevel: "ENTRY",
      requirements: [
        { capabilityKey: "communication", weight: 2 },
        { capabilityKey: "copywriting", weight: 3, critical: true },
        { capabilityKey: "project-management", weight: 2, critical: true },
      ],
      preferred: [{ capabilityKey: "analytics-tools", weight: 1 }],
      adjacentIds: [],
      growthIds: ["content-strategist"],
      regions: ["GLOBAL"],
    },
    {
      id: "content-strategist",
      title: "Content Strategist",
      familyId: "marketing",
      summary: "Plans content for an audience and measures it.",
      entryLevel: "MID",
      requirements: [
        { capabilityKey: "copywriting", weight: 3, critical: true },
        { capabilityKey: "content-strategy", weight: 3, critical: true },
        { capabilityKey: "seo", weight: 2 },
      ],
      preferred: [{ capabilityKey: "communication", weight: 1 }],
      adjacentIds: [],
      growthIds: [],
      regions: ["GLOBAL"],
    },
    {
      id: "junior-swe",
      title: "Junior Software Engineer",
      familyId: "engineering",
      summary: "Ships scoped software changes with review.",
      entryLevel: "ENTRY",
      requirements: [
        { capabilityKey: "programming", weight: 3, critical: true },
        { capabilityKey: "git", weight: 1 },
        { capabilityKey: "testing", weight: 2, critical: true },
        { capabilityKey: "communication", weight: 2 },
      ],
      preferred: [{ capabilityKey: "react", weight: 1 }],
      adjacentIds: ["data-analyst"],
      growthIds: ["senior-swe"],
      regions: ["GLOBAL"],
    },
    {
      id: "data-analyst",
      title: "Data Analyst",
      familyId: "data",
      summary: "Turns data into decisions.",
      entryLevel: "ENTRY",
      requirements: [
        { capabilityKey: "sql", weight: 3, critical: true },
        { capabilityKey: "data-analysis", weight: 2, critical: true },
        { capabilityKey: "communication", weight: 2 },
      ],
      preferred: [{ capabilityKey: "statistics", weight: 1 }],
      adjacentIds: [],
      growthIds: [],
      regions: ["GLOBAL"],
    },
    {
      id: "senior-swe",
      title: "Senior Software Engineer",
      familyId: "engineering",
      summary: "Leads technical design across systems.",
      entryLevel: "SENIOR",
      requirements: [
        { capabilityKey: "programming", weight: 3, critical: true },
        { capabilityKey: "system-design", weight: 3, critical: true },
        { capabilityKey: "leadership", weight: 2 },
        { capabilityKey: "communication", weight: 1 },
      ],
      preferred: [{ capabilityKey: "mentoring", weight: 1 }],
      adjacentIds: [],
      growthIds: [],
      regions: ["GLOBAL"],
    },
    {
      id: "us-sales",
      title: "US Sales Representative",
      familyId: "sales",
      summary: "A region-limited sales role used to test eligibility.",
      entryLevel: "ENTRY",
      requirements: [{ capabilityKey: "communication", weight: 1 }],
      preferred: [],
      adjacentIds: [],
      growthIds: [],
      regions: ["US"],
    },
    {
      id: "nurse",
      title: "Registered Nurse",
      familyId: "health",
      summary: "A licensed clinical role used to test credential handling.",
      entryLevel: "MID",
      requirements: [
        { capabilityKey: "patient-care", weight: 2, critical: true },
        { capabilityKey: "communication", weight: 2 },
      ],
      preferred: [],
      adjacentIds: [],
      growthIds: [],
      regions: ["US"],
      credentialGate: { label: "State nursing licence", regions: ["US"] },
    },
  ],
  capabilityDefinitions: CAPABILITY_DEFINITIONS,
  attribution: ["Fixture catalogue for unit tests."],
}

let capabilitySequence = 0
let linkSequence = 0

interface CapabilityOptions {
  selfAssessment?: CareerPathCapabilityInput["selfAssessment"]
  depth?: CareerPathCapabilityInput["links"][number]["depth"]
  evidenceIds?: readonly string[]
  lastUsed?: string | null
  measured?: boolean
  confirmed?: boolean
}

function cap(name: string, options: CapabilityOptions = {}): CareerPathCapabilityInput {
  capabilitySequence += 1
  const evidenceIds = options.evidenceIds ?? []
  return {
    id: `cap-${capabilitySequence}`,
    name,
    confirmed: options.confirmed ?? true,
    selfAssessment: options.selfAssessment ?? "COMPETENT",
    links: evidenceIds.map((evidenceId) => {
      linkSequence += 1
      return {
        id: `link-${linkSequence}`,
        evidenceId,
        depth: options.depth ?? "WORKING",
        hasMeasuredOutcome: options.measured ?? true,
        lastUsedAt: options.lastUsed === undefined ? "2025-06-01" : options.lastUsed,
      }
    }),
  }
}

function ev(
  id: string,
  title: string,
  overrides: Partial<CareerPathEvidenceInput> = {}
): CareerPathEvidenceInput {
  return {
    id,
    title,
    kind: "EXPERIENCE",
    status: "CONFIRMED",
    outcome: "Measured outcome recorded.",
    sourceUrl: null,
    ...overrides,
  }
}

function makeProfile(
  options: {
    experienceLevel?: CareerPathProfileInput["experienceLevel"]
    capabilities: CareerPathCapabilityInput[]
    evidence?: CareerPathEvidenceInput[]
    locations?: string[]
    workAuthorization?: string | null
    targetRoleTitles?: string[]
  }
): CareerPathProfileInput {
  return {
    experienceLevel: options.experienceLevel ?? "MID",
    locations: options.locations ?? [],
    workAuthorization: options.workAuthorization ?? null,
    requiresSponsorship: null,
    targetRoleTitles: options.targetRoleTitles ?? [],
    capabilities: options.capabilities,
    evidence: options.evidence ?? [],
  }
}

function run(profile: CareerPathProfileInput, catalog = FIXTURE_CATALOG): CareerPathResult {
  return buildCareerPath(profile, { catalog, asOf: AS_OF })
}

function allRecommendations(result: CareerPathResult) {
  return [
    ...result.groups.QUALIFIED_NOW,
    ...result.groups.ADJACENT,
    ...result.groups.GROWTH,
  ]
}

function find(result: CareerPathResult, title: string) {
  return allRecommendations(result).find((item) => item.title === title)
}

const CUSTOMER_SUPPORT_PROFILE = makeProfile({
  capabilities: [
    cap("Customer Support", { evidenceIds: ["ev-support"], depth: "DEEP", selfAssessment: "STRONG" }),
    cap("Communication", { evidenceIds: ["ev-comm"] }),
    cap("Salesforce", { evidenceIds: ["ev-crm"] }),
    cap("Customer Onboarding", { evidenceIds: ["ev-onboarding"] }),
  ],
  evidence: [
    ev("ev-support", "Resolved enterprise support escalations", {
      outcome: "Cut first-response time by 31%.",
      sourceUrl: "https://example.com/outcomes/support",
    }),
    ev("ev-comm", "Ran customer advisory sessions"),
    ev("ev-crm", "Rebuilt the Salesforce renewal pipeline"),
    ev("ev-onboarding", "Redesigned customer onboarding"),
  ],
})

const MARKETING_PROFILE = makeProfile({
  capabilities: [
    cap("Communication", { evidenceIds: ["ev-mk-comm"] }),
    cap("Copywriting", { evidenceIds: ["ev-mk-copy"], selfAssessment: "STRONG" }),
    cap("Campaign Management", { evidenceIds: ["ev-mk-campaign"] }),
    cap("Google Analytics", { evidenceIds: ["ev-mk-analytics"] }),
  ],
  evidence: [
    ev("ev-mk-comm", "Led weekly marketing reviews"),
    ev("ev-mk-copy", "Wrote the launch campaign copy"),
    ev("ev-mk-campaign", "Delivered a multi-channel campaign"),
    ev("ev-mk-analytics", "Built a campaign funnel dashboard"),
  ],
})

const GRAD_PROFILE = makeProfile({
  experienceLevel: "JUNIOR",
  capabilities: [
    cap("JavaScript", { evidenceIds: ["ev-grad-code"] }),
    cap("GitHub", { evidenceIds: ["ev-grad-git"] }),
    cap("Unit Testing", { evidenceIds: ["ev-grad-test"] }),
    cap("Communication", { evidenceIds: ["ev-grad-comm"] }),
  ],
  evidence: [
    ev("ev-grad-code", "Capstone booking application"),
    ev("ev-grad-git", "Reviewed pull requests in the capstone"),
    ev("ev-grad-test", "Added the capstone test suite"),
    ev("ev-grad-comm", "Presented the capstone to reviewers"),
  ],
})

describe("buildCareerPath", () => {
  it("qualifies a non-technical customer-support profile and keeps the next branch realistic", () => {
    const result = run(CUSTOMER_SUPPORT_PROFILE)

    expect(result.hasEnoughEvidence).toBe(true)
    expect(result.counts.QUALIFIED_NOW).toBeGreaterThan(0)

    const csm = find(result, "Customer Success Manager")
    expect(csm?.group).toBe("QUALIFIED_NOW")
    expect(csm?.entryFeasibility.status).toBe("FEASIBLE")
    expect(csm?.geography.status).toBe("ELIGIBLE")
    expect(csm?.salaryPotential).toBeNull()
    expect(csm?.matched.map((match) => match.key)).toEqual(
      expect.arrayContaining(["customer-success", "communication", "crm", "onboarding"])
    )
    expect(csm?.matched.every((match) => match.evidence.length > 0)).toBe(true)
    expect(csm?.matched.find((match) => match.key === "customer-success")?.evidence[0]?.sourceUrl)
      .toBe("https://example.com/outcomes/support")

    const accountExecutive = find(result, "Account Executive")
    expect(accountExecutive?.group).toBe("ADJACENT")
    expect(accountExecutive?.branch[0]).toBe("Customer Success Manager")
    expect(accountExecutive?.missing.some((match) => match.key === "negotiation")).toBe(true)

    const salesManager = find(result, "Sales Manager")
    expect(salesManager?.group).toBe("GROWTH")
    expect(salesManager?.entryFeasibility.status).toBe("STRETCH")
    expect(salesManager?.branch).toContain("Account Executive")
  })

  it("moves a marketing career changer into a qualified coordinator role and a content growth branch", () => {
    const result = run(MARKETING_PROFILE)

    const coordinator = find(result, "Marketing Coordinator")
    expect(coordinator?.group).toBe("QUALIFIED_NOW")
    expect(coordinator?.breakdown.requiredCoverage).toBe(100)
    expect(coordinator?.steps).toEqual([])

    const content = find(result, "Content Strategist")
    expect(content?.group).toBe("GROWTH")
    expect(content?.branch).toEqual(["Marketing Coordinator", "Content Strategist"])
    expect(content?.missing.map((match) => match.key)).toEqual(
      expect.arrayContaining(["content-strategy", "seo"])
    )
    expect(content?.steps.length).toBeGreaterThan(0)
  })

  it("qualifies a recent graduate with confirmed project evidence", () => {
    const result = run(GRAD_PROFILE)

    const junior = find(result, "Junior Software Engineer")
    expect(junior?.group).toBe("QUALIFIED_NOW")
    expect(junior?.confidence).toBe("HIGH")
    expect(junior?.evidenceBackedCapabilities).toBe(4)
    expect(junior?.entryFeasibility.status).toBe("FEASIBLE")
    expect(junior?.salaryPotential).toBeNull()

    expect(find(result, "Data Analyst")?.group).toBe("GROWTH")
    expect(find(result, "Senior Software Engineer")).toBeUndefined()
  })

  it("keeps a sparse profile empty and explains what is missing", () => {
    const profile = makeProfile({
      experienceLevel: "JUNIOR",
      capabilities: [cap("Communication")],
      evidence: [ev("ev-unrelated", "Degree certificate", { kind: "EDUCATION" })],
    })

    const result = run(profile)
    expect(result.hasEnoughEvidence).toBe(false)
    expect(result.counts).toEqual({ QUALIFIED_NOW: 0, ADJACENT: 0, GROWTH: 0 })
    expect(result.notices.length).toBeGreaterThan(0)
    expect(result.notices.join(" ")).toMatch(/two confirmed capabilities/i)
    expect(result.evaluatedCount).toBe(FIXTURE_CATALOG.occupations.length)
  })

  it("counts duplicate capability records once and reports the conflict", () => {
    const profile = makeProfile({
      experienceLevel: "JUNIOR",
      capabilities: [
        cap("JavaScript", { evidenceIds: ["ev-c-code"] }),
        cap("GitHub", { evidenceIds: ["ev-c-git"] }),
        cap("Unit Testing", { evidenceIds: ["ev-c-test"] }),
        cap("Communication", { evidenceIds: ["ev-c-comm"] }),
        cap("React 19", {
          selfAssessment: "EXPERT",
          depth: "DEEP",
          evidenceIds: ["ev-c-react"],
        }),
        cap("React", { selfAssessment: "LEARNING", evidenceIds: [] }),
      ],
      evidence: [
        ev("ev-c-code", "Shipped a booking app"),
        ev("ev-c-git", "Reviewed the booking app changes"),
        ev("ev-c-test", "Added the booking app tests"),
        ev("ev-c-comm", "Demoed the booking app"),
        ev("ev-c-react", "Built the booking app interface"),
      ],
    })

    const result = run(profile)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.capabilityKey).toBe("react")
    expect(result.conflicts[0]?.detail).toMatch(/40 and 95|95 and 40/)

    const junior = find(result, "Junior Software Engineer")
    const reactMatches = junior?.matched.filter((match) => match.key === "react") ?? []
    expect(reactMatches).toHaveLength(1)
    expect(reactMatches[0]?.strength).toBe(95)
    expect(junior?.breakdown.preferredCoverage).toBe(100)
  })

  it("does not let self-declared skills qualify a role", () => {
    const profile = makeProfile({
      experienceLevel: "JUNIOR",
      capabilities: [
        cap("JavaScript", { evidenceIds: [] }),
        cap("GitHub", { evidenceIds: [] }),
        cap("Unit Testing", { evidenceIds: [] }),
        cap("Communication", { evidenceIds: [] }),
      ],
      evidence: [ev("ev-declared", "Unrelated confirmed reference")],
    })

    const result = run(profile)
    expect(result.hasEnoughEvidence).toBe(true)
    expect(result.counts.QUALIFIED_NOW).toBe(0)
    expect(result.notices.join(" ")).toMatch(/self-declared/i)
    expect(find(result, "Junior Software Engineer")).toBeUndefined()
  })

  it("pushes a role with a missing critical requirement out of qualified", () => {
    const profile = makeProfile({
      experienceLevel: "JUNIOR",
      capabilities: [
        cap("JavaScript", { evidenceIds: ["ev-m-code"] }),
        cap("GitHub", { evidenceIds: ["ev-m-git"] }),
        cap("Communication", { evidenceIds: ["ev-m-comm"] }),
      ],
      evidence: [
        ev("ev-m-code", "Shipped a small service"),
        ev("ev-m-git", "Reviewed a shared change"),
        ev("ev-m-comm", "Wrote the service notes"),
      ],
    })

    const result = run(profile)
    const junior = find(result, "Junior Software Engineer")
    expect(junior?.group).toBe("ADJACENT")
    expect(junior?.breakdown.requiredCoverage).toBe(75)
    expect(junior?.missing.find((match) => match.key === "testing")?.critical).toBe(true)
    expect(junior?.reasons.join(" ")).toMatch(/Critical gap/i)
  })

  it("treats region limits and unverified credentials honestly", () => {
    const philippines = makeProfile({
      locations: ["Manila, Philippines"],
      workAuthorization: "Philippines",
      capabilities: [
        cap("Communication", { evidenceIds: ["ev-geo-comm"] }),
        cap("Customer Support", { evidenceIds: ["ev-geo-support"] }),
      ],
      evidence: [ev("ev-geo-comm", "Wrote customer updates"), ev("ev-geo-support", "Ran support shifts")],
    })

    const restricted = run(philippines)
    expect(find(restricted, "US Sales Representative")).toBeUndefined()

    const us = makeProfile({
      locations: ["Remote, US"],
      workAuthorization: "US",
      capabilities: [
        cap("Communication", { evidenceIds: ["ev-us-comm"] }),
        cap("Customer Support", { evidenceIds: ["ev-us-support"] }),
      ],
      evidence: [ev("ev-us-comm", "Wrote customer updates"), ev("ev-us-support", "Ran support shifts")],
    })

    const eligible = run(us)
    const usSales = find(eligible, "US Sales Representative")
    expect(usSales?.group).toBe("QUALIFIED_NOW")
    expect(usSales?.geography.status).toBe("ELIGIBLE")

    const nurse = makeProfile({
      locations: ["Boston, US"],
      workAuthorization: "US",
      capabilities: [
        cap("Communication", { evidenceIds: ["ev-nurse-comm"] }),
        cap("Patient Care", { evidenceIds: ["ev-nurse-care"] }),
      ],
      evidence: [ev("ev-nurse-comm", "Handover notes"), ev("ev-nurse-care", "Supervised care plan")],
    })
    const nurseResult = find(run(nurse), "Registered Nurse")
    expect(nurseResult?.entryFeasibility.status).toBe("UNKNOWN")
    expect(nurseResult?.entryFeasibility.explanation).toMatch(/State nursing licence/i)
  })

  it("omits roles that are more than one level out of reach", () => {
    const profile = makeProfile({
      experienceLevel: "JUNIOR",
      capabilities: [
        cap("JavaScript", { evidenceIds: ["ev-b-code"] }),
        cap("System Design", { evidenceIds: ["ev-b-design"] }),
        cap("Leadership", { evidenceIds: ["ev-b-lead"] }),
        cap("Communication", { evidenceIds: ["ev-b-comm"] }),
      ],
      evidence: [
        ev("ev-b-code", "Built a personal project"),
        ev("ev-b-design", "Wrote a project design note"),
        ev("ev-b-lead", "Led a study group"),
        ev("ev-b-comm", "Presented the project"),
      ],
      targetRoleTitles: ["Senior Software Engineer"],
    })

    const result = run(profile)
    expect(find(result, "Senior Software Engineer")).toBeUndefined()
    expect(allRecommendations(result).some((item) => item.title === "Senior Software Engineer")).toBe(false)
  })

  it("computes the documented score and coverage formula", () => {
    const result = run(GRAD_PROFILE)
    const junior = find(result, "Junior Software Engineer")

    expect(junior?.breakdown).toEqual({
      requiredCoverage: 100,
      preferredCoverage: 0,
      evidenceShare: 100,
      criticalPenalty: 0,
      total: 80,
    })
    expect(junior?.score).toBe(80)
    expect(junior?.coverage).toBe(94)
    expect(junior?.matched[0]?.strength).toBe(78)
  })

  it("is deterministic and sorts each group by score then title", () => {
    const profile = makeProfile({
      experienceLevel: "JUNIOR",
      capabilities: [
        cap("JavaScript", { evidenceIds: ["ev-d-code"] }),
        cap("GitHub", { evidenceIds: ["ev-d-git"] }),
        cap("Unit Testing", { evidenceIds: ["ev-d-test"] }),
        cap("Communication", { evidenceIds: ["ev-d-comm"] }),
        cap("SQL", { evidenceIds: ["ev-d-sql"] }),
        cap("Data Analysis", { evidenceIds: ["ev-d-analysis"] }),
        cap("Statistics", { evidenceIds: ["ev-d-stats"] }),
      ],
      evidence: [
        ev("ev-d-code", "Built the reporting app"),
        ev("ev-d-git", "Reviewed the reporting app"),
        ev("ev-d-test", "Tested the reporting app"),
        ev("ev-d-comm", "Presented the reporting app"),
        ev("ev-d-sql", "Wrote reporting queries"),
        ev("ev-d-analysis", "Analysed the reporting data"),
        ev("ev-d-stats", "Designed the reporting sample"),
      ],
      locations: ["Remote, US"],
      workAuthorization: "US",
    })

    const first = run(profile)
    const second = run(profile)
    expect(second).toEqual(first)

    expect(first.groups.QUALIFIED_NOW.map((item) => item.title)).toEqual([
      "Data Analyst",
      "US Sales Representative",
      "Junior Software Engineer",
    ])
    expect(first.groups.QUALIFIED_NOW[0]?.score).toBeGreaterThanOrEqual(
      first.groups.QUALIFIED_NOW[1]?.score ?? 0
    )
  })

  it("never produces a salary figure without regional data", () => {
    const result = run(CUSTOMER_SUPPORT_PROFILE)
    for (const recommendation of allRecommendations(result)) {
      expect(recommendation.salaryPotential).toBeNull()
    }
  })
})
