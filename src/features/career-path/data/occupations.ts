import type {
  CareerOccupation,
  CareerOccupationFamily,
  CareerPathCatalog,
} from "../types"
import { CAREER_PATH_CAPABILITY_DEFINITIONS } from "./capabilities"

/**
 * A small, locally written occupational crosswalk for Career Path Intelligence.
 *
 * This is not an import or redistribution of ESCO or O*NET. Titles,
 * descriptions and capability requirements are original to this project, and
 * the graph is intentionally small enough to audit. Upstream dataset versions,
 * licences and the reason the full datasets are not bundled are documented in
 * `docs/career-path-datasets.md`.
 */
const FAMILIES: readonly CareerOccupationFamily[] = [
  {
    id: "engineering",
    label: "Engineering",
    summary: "Building and operating software and the platforms it runs on.",
  },
  {
    id: "data",
    label: "Data",
    summary: "Turning raw data into decisions, models and reliable pipelines.",
  },
  {
    id: "product",
    label: "Product",
    summary: "Deciding what to build and why, with evidence from users and the business.",
  },
  {
    id: "design",
    label: "Design",
    summary: "Making interfaces and systems that people can understand and use.",
  },
  {
    id: "marketing",
    label: "Marketing",
    summary: "Reaching the right audience with content, campaigns and positioning.",
  },
  {
    id: "operations",
    label: "Operations",
    summary: "Keeping the work moving and keeping customers successful.",
  },
  {
    id: "people",
    label: "People",
    summary: "Hiring, onboarding and supporting the people who do the work.",
  },
  {
    id: "sales",
    label: "Sales",
    summary: "Finding buyers, earning trust and closing work.",
  },
  {
    id: "security",
    label: "Security",
    summary: "Finding, preventing and responding to security risk.",
  },
  {
    id: "writing",
    label: "Writing",
    summary: "Explaining complex products and processes clearly.",
  },
]

const OCCUPATIONS: readonly CareerOccupation[] = [
  {
    id: "junior-software-engineer",
    title: "Junior Software Engineer",
    familyId: "engineering",
    summary:
      "Builds small, well-scoped software changes with review and tests, and grows toward owning a feature end to end.",
    entryLevel: "ENTRY",
    requirements: [
      { capabilityKey: "programming", weight: 2, critical: true },
      { capabilityKey: "git", weight: 1 },
      { capabilityKey: "testing", weight: 1 },
      { capabilityKey: "communication", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "react", weight: 2 },
      { capabilityKey: "typescript", weight: 1 },
    ],
    adjacentIds: ["qa-automation-engineer", "frontend-engineer"],
    growthIds: ["software-engineer", "backend-engineer"],
    regions: ["GLOBAL"],
  },
  {
    id: "software-engineer",
    title: "Software Engineer",
    familyId: "engineering",
    summary:
      "Owns features through design, implementation, review and production support, and makes trade-offs visible.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "programming", weight: 3, critical: true },
      { capabilityKey: "system-design", weight: 2 },
      { capabilityKey: "testing", weight: 2 },
      { capabilityKey: "git", weight: 1 },
      { capabilityKey: "communication", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "cloud", weight: 2 },
      { capabilityKey: "mentoring", weight: 1 },
    ],
    adjacentIds: [
      "frontend-engineer",
      "backend-engineer",
      "qa-automation-engineer",
    ],
    growthIds: ["engineering-manager", "platform-engineer"],
    regions: ["GLOBAL"],
  },
  {
    id: "frontend-engineer",
    title: "Frontend Engineer",
    familyId: "engineering",
    summary:
      "Builds accessible, responsive interfaces and connects them to reliable application data.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "typescript", weight: 3, critical: true },
      { capabilityKey: "react", weight: 3 },
      { capabilityKey: "testing", weight: 2 },
      { capabilityKey: "accessibility", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "design-systems", weight: 2 },
      { capabilityKey: "api-design", weight: 1 },
    ],
    adjacentIds: ["software-engineer", "ux-designer", "backend-engineer"],
    growthIds: ["engineering-manager", "platform-engineer"],
    regions: ["GLOBAL"],
  },
  {
    id: "backend-engineer",
    title: "Backend Engineer",
    familyId: "engineering",
    summary:
      "Designs APIs, data access and background work that stay correct under real production load.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "programming", weight: 3, critical: true },
      { capabilityKey: "api-design", weight: 3 },
      { capabilityKey: "sql", weight: 2 },
      { capabilityKey: "testing", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "cloud", weight: 2 },
      { capabilityKey: "system-design", weight: 2 },
    ],
    adjacentIds: ["software-engineer", "data-engineer", "platform-engineer"],
    growthIds: ["engineering-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "platform-engineer",
    title: "Platform Engineer",
    familyId: "engineering",
    summary:
      "Makes deployment, infrastructure and reliability boring for the teams that depend on them.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "cloud", weight: 3, critical: true },
      { capabilityKey: "devops", weight: 3 },
      { capabilityKey: "linux", weight: 2 },
      { capabilityKey: "system-design", weight: 2 },
      { capabilityKey: "communication", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "programming", weight: 2 },
      { capabilityKey: "incident-response", weight: 1 },
    ],
    adjacentIds: ["backend-engineer", "security-analyst", "software-engineer"],
    growthIds: ["engineering-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "engineering-manager",
    title: "Engineering Manager",
    familyId: "engineering",
    summary:
      "Owns a team's delivery and health: direction, staffing, technical judgement and the conditions people need to do good work.",
    entryLevel: "SENIOR",
    requirements: [
      { capabilityKey: "leadership", weight: 3, critical: true },
      { capabilityKey: "mentoring", weight: 3 },
      { capabilityKey: "project-management", weight: 2 },
      { capabilityKey: "stakeholder-management", weight: 2 },
      { capabilityKey: "system-design", weight: 2 },
    ],
    preferred: [
      { capabilityKey: "communication", weight: 2 },
      { capabilityKey: "agile", weight: 1 },
    ],
    adjacentIds: ["platform-engineer"],
    growthIds: ["product-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "qa-automation-engineer",
    title: "QA Automation Engineer",
    familyId: "engineering",
    summary:
      "Finds the failures users would hit and turns them into fast, trustworthy checks.",
    entryLevel: "ENTRY",
    requirements: [
      { capabilityKey: "testing", weight: 3, critical: true },
      { capabilityKey: "qa-testing", weight: 3 },
      { capabilityKey: "programming", weight: 2 },
      { capabilityKey: "communication", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "ci-cd", weight: 2 },
      { capabilityKey: "git", weight: 1 },
    ],
    adjacentIds: ["junior-software-engineer", "software-engineer", "backend-engineer"],
    growthIds: ["security-analyst"],
    regions: ["GLOBAL"],
  },
  {
    id: "data-analyst",
    title: "Data Analyst",
    familyId: "data",
    summary:
      "Answers concrete business questions with clean queries, careful comparisons and honest visualisations.",
    entryLevel: "ENTRY",
    requirements: [
      { capabilityKey: "sql", weight: 3, critical: true },
      { capabilityKey: "excel-spreadsheets", weight: 2 },
      { capabilityKey: "data-analysis", weight: 2 },
      { capabilityKey: "data-visualization", weight: 2 },
      { capabilityKey: "communication", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "statistics", weight: 2 },
      { capabilityKey: "python", weight: 1 },
    ],
    adjacentIds: ["data-scientist", "data-engineer", "associate-product-manager"],
    growthIds: ["product-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "data-scientist",
    title: "Data Scientist",
    familyId: "data",
    summary:
      "Builds and evaluates models that answer a real question, with the limits of the evidence stated clearly.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "python", weight: 3, critical: true },
      { capabilityKey: "statistics", weight: 3 },
      { capabilityKey: "machine-learning", weight: 3 },
      { capabilityKey: "sql", weight: 2 },
      { capabilityKey: "communication", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "data-visualization", weight: 1 },
      { capabilityKey: "experimentation", weight: 1 },
    ],
    adjacentIds: ["data-analyst", "data-engineer"],
    growthIds: ["product-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "data-engineer",
    title: "Data Engineer",
    familyId: "data",
    summary:
      "Builds reliable pipelines and storage so analysis and models are not built on broken data.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "python", weight: 2 },
      { capabilityKey: "sql", weight: 3, critical: true },
      { capabilityKey: "cloud", weight: 2 },
      { capabilityKey: "data-pipelines", weight: 3 },
      { capabilityKey: "testing", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "devops", weight: 2 },
      { capabilityKey: "system-design", weight: 1 },
    ],
    adjacentIds: ["data-analyst", "backend-engineer"],
    growthIds: ["platform-engineer", "data-scientist"],
    regions: ["GLOBAL"],
  },
  {
    id: "associate-product-manager",
    title: "Associate Product Manager",
    familyId: "product",
    summary:
      "Turns user and business evidence into a clear, small next step, and keeps the team aligned on why it matters.",
    entryLevel: "ENTRY",
    requirements: [
      { capabilityKey: "communication", weight: 2, critical: true },
      { capabilityKey: "data-analysis", weight: 2 },
      { capabilityKey: "user-research", weight: 2 },
      { capabilityKey: "roadmapping", weight: 2 },
    ],
    preferred: [
      { capabilityKey: "project-management", weight: 1 },
      { capabilityKey: "stakeholder-management", weight: 1 },
    ],
    adjacentIds: ["ux-designer", "data-analyst"],
    growthIds: ["product-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "product-manager",
    title: "Product Manager",
    familyId: "product",
    summary:
      "Owns a problem area: decides what is worth building, sequences it, and measures whether it worked.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "product-discovery", weight: 3, critical: true },
      { capabilityKey: "roadmapping", weight: 3 },
      { capabilityKey: "experimentation", weight: 2 },
      { capabilityKey: "data-analysis", weight: 2 },
      { capabilityKey: "stakeholder-management", weight: 2 },
    ],
    preferred: [
      { capabilityKey: "communication", weight: 2 },
      { capabilityKey: "leadership", weight: 1 },
    ],
    adjacentIds: ["associate-product-manager", "product-marketing-manager"],
    growthIds: ["engineering-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "ux-designer",
    title: "UX Designer",
    familyId: "design",
    summary:
      "Studies how people actually work, then designs flows that make the next step obvious.",
    entryLevel: "ENTRY",
    requirements: [
      { capabilityKey: "user-research", weight: 3, critical: true },
      { capabilityKey: "figma", weight: 2 },
      { capabilityKey: "interaction-design", weight: 3 },
      { capabilityKey: "communication", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "accessibility", weight: 2 },
      { capabilityKey: "design-systems", weight: 1 },
    ],
    adjacentIds: ["product-designer", "frontend-engineer", "associate-product-manager"],
    growthIds: ["product-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "product-designer",
    title: "Senior Product Designer",
    familyId: "design",
    summary:
      "Owns an end-to-end product area and the system of components and rules that keeps it coherent.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "design-systems", weight: 3, critical: true },
      { capabilityKey: "user-research", weight: 2 },
      { capabilityKey: "interaction-design", weight: 3 },
      { capabilityKey: "figma", weight: 2 },
      { capabilityKey: "accessibility", weight: 2 },
    ],
    preferred: [
      { capabilityKey: "mentoring", weight: 1 },
      { capabilityKey: "communication", weight: 1 },
    ],
    adjacentIds: ["ux-designer", "frontend-engineer"],
    growthIds: ["product-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "marketing-coordinator",
    title: "Marketing Coordinator",
    familyId: "marketing",
    summary:
      "Keeps campaigns and content moving: writes, schedules, measures and reports what actually happened.",
    entryLevel: "ENTRY",
    requirements: [
      { capabilityKey: "communication", weight: 2, critical: true },
      { capabilityKey: "copywriting", weight: 2 },
      { capabilityKey: "project-management", weight: 2 },
      { capabilityKey: "data-analysis", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "social-media", weight: 2 },
      { capabilityKey: "analytics-tools", weight: 1 },
      { capabilityKey: "stakeholder-management", weight: 1 },
    ],
    adjacentIds: ["content-strategist", "growth-marketer"],
    growthIds: ["product-marketing-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "content-strategist",
    title: "Content Strategist",
    familyId: "marketing",
    summary:
      "Decides what content should exist, who it serves and how it stays findable and coherent over time.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "copywriting", weight: 3, critical: true },
      { capabilityKey: "content-strategy", weight: 3 },
      { capabilityKey: "seo", weight: 2 },
      { capabilityKey: "information-architecture", weight: 1 },
      { capabilityKey: "editing", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "data-analysis", weight: 1 },
      { capabilityKey: "project-management", weight: 1 },
    ],
    adjacentIds: ["marketing-coordinator", "growth-marketer", "technical-writer"],
    growthIds: ["product-marketing-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "growth-marketer",
    title: "Growth Marketer",
    familyId: "marketing",
    summary:
      "Runs measurable acquisition and retention experiments and stops the ones that do not work.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "analytics-tools", weight: 3, critical: true },
      { capabilityKey: "experimentation", weight: 2 },
      { capabilityKey: "seo", weight: 2 },
      { capabilityKey: "email-marketing", weight: 2 },
      { capabilityKey: "copywriting", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "data-analysis", weight: 2 },
      { capabilityKey: "social-media", weight: 1 },
    ],
    adjacentIds: ["marketing-coordinator", "content-strategist"],
    growthIds: ["product-marketing-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "product-marketing-manager",
    title: "Product Marketing Manager",
    familyId: "marketing",
    summary:
      "Connects a product's real advantage to the audience that cares, and measures whether the message landed.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "communication", weight: 2, critical: true },
      { capabilityKey: "copywriting", weight: 2 },
      { capabilityKey: "analytics-tools", weight: 2 },
      { capabilityKey: "experimentation", weight: 2 },
      { capabilityKey: "stakeholder-management", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "content-strategy", weight: 2 },
      { capabilityKey: "sales", weight: 1 },
    ],
    adjacentIds: ["content-strategist", "growth-marketer"],
    growthIds: ["product-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "operations-coordinator",
    title: "Operations Coordinator",
    familyId: "operations",
    summary:
      "Keeps recurring work predictable by owning requests, hand-offs, vendors and the small details that block delivery.",
    entryLevel: "ENTRY",
    requirements: [
      { capabilityKey: "operations", weight: 2, critical: true },
      { capabilityKey: "project-management", weight: 2 },
      { capabilityKey: "communication", weight: 2 },
      { capabilityKey: "excel-spreadsheets", weight: 2 },
    ],
    preferred: [
      { capabilityKey: "process-improvement", weight: 2 },
      { capabilityKey: "stakeholder-management", weight: 1 },
    ],
    adjacentIds: ["customer-success-manager", "marketing-coordinator"],
    growthIds: ["people-operations-specialist"],
    regions: ["GLOBAL"],
  },
  {
    id: "customer-success-manager",
    title: "Customer Success Manager",
    familyId: "operations",
    summary:
      "Helps customers reach the outcome they bought, and turns recurring friction into a product or process fix.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "customer-success", weight: 3, critical: true },
      { capabilityKey: "communication", weight: 2 },
      { capabilityKey: "crm", weight: 2 },
      { capabilityKey: "onboarding", weight: 2 },
    ],
    preferred: [
      { capabilityKey: "stakeholder-management", weight: 1 },
      { capabilityKey: "data-analysis", weight: 1 },
    ],
    adjacentIds: ["account-executive", "people-operations-specialist", "operations-coordinator"],
    growthIds: ["product-marketing-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "people-operations-specialist",
    title: "People Operations Specialist",
    familyId: "people",
    summary:
      "Makes hiring, onboarding and the everyday employee experience work without relying on memory.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "people-ops", weight: 3, critical: true },
      { capabilityKey: "onboarding", weight: 2 },
      { capabilityKey: "communication", weight: 2 },
      { capabilityKey: "excel-spreadsheets", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "recruiting", weight: 2 },
      { capabilityKey: "project-management", weight: 1 },
      { capabilityKey: "process-improvement", weight: 1 },
    ],
    adjacentIds: ["operations-coordinator"],
    growthIds: ["customer-success-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "sales-development-representative",
    title: "Sales Development Representative",
    familyId: "sales",
    summary:
      "Finds plausible buyers, opens honest conversations and hands qualified opportunities to the account team.",
    entryLevel: "ENTRY",
    requirements: [
      { capabilityKey: "communication", weight: 2, critical: true },
      { capabilityKey: "sales", weight: 3 },
      { capabilityKey: "crm", weight: 2 },
      { capabilityKey: "data-analysis", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "negotiation", weight: 1 },
      { capabilityKey: "email-marketing", weight: 1 },
    ],
    adjacentIds: ["customer-success-manager"],
    growthIds: ["account-executive"],
    regions: ["GLOBAL"],
  },
  {
    id: "account-executive",
    title: "Account Executive",
    familyId: "sales",
    summary:
      "Owns a deal from first serious conversation to signature, with a clear view of the buyer's actual risk.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "sales", weight: 3, critical: true },
      { capabilityKey: "negotiation", weight: 3 },
      { capabilityKey: "crm", weight: 2 },
      { capabilityKey: "communication", weight: 2 },
      { capabilityKey: "stakeholder-management", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "data-analysis", weight: 1 },
      { capabilityKey: "email-marketing", weight: 1 },
    ],
    adjacentIds: ["sales-development-representative", "customer-success-manager"],
    growthIds: ["product-marketing-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "security-analyst",
    title: "Security Analyst",
    familyId: "security",
    summary:
      "Looks for real exposure, ranks it by consequence and helps the team respond when something goes wrong.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "cybersecurity", weight: 3, critical: true },
      { capabilityKey: "incident-response", weight: 2 },
      { capabilityKey: "networking", weight: 2 },
      { capabilityKey: "linux", weight: 1 },
      { capabilityKey: "communication", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "cloud", weight: 2 },
      { capabilityKey: "programming", weight: 2 },
    ],
    adjacentIds: ["platform-engineer", "backend-engineer"],
    growthIds: ["engineering-manager"],
    regions: ["GLOBAL"],
  },
  {
    id: "technical-writer",
    title: "Technical Writer",
    familyId: "writing",
    summary:
      "Turns how a product actually works into documentation a new user can follow without help.",
    entryLevel: "MID",
    requirements: [
      { capabilityKey: "technical-writing", weight: 3, critical: true },
      { capabilityKey: "documentation", weight: 3 },
      { capabilityKey: "information-architecture", weight: 2 },
      { capabilityKey: "editing", weight: 2 },
      { capabilityKey: "communication", weight: 1 },
    ],
    preferred: [
      { capabilityKey: "programming", weight: 2 },
      { capabilityKey: "project-management", weight: 1 },
    ],
    adjacentIds: ["content-strategist", "product-marketing-manager"],
    growthIds: ["product-manager"],
    regions: ["GLOBAL"],
  },
]

export const CAREER_PATH_CATALOG: CareerPathCatalog = {
  version: "career-path-seed-2026.11.1",
  families: FAMILIES,
  occupations: OCCUPATIONS,
  capabilityDefinitions: CAREER_PATH_CAPABILITY_DEFINITIONS,
  attribution: [
    "Career Path Intelligence uses a locally curated occupational crosswalk seed; ESCO and O*NET datasets are not bundled or redistributed.",
    "Upstream dataset versions, licences and the evaluation behind this seed are documented in docs/career-path-datasets.md.",
    "Occupation descriptions, capability requirements and role transitions here are original to this project.",
    "No salary data is included. Salary potential is shown only when a trustworthy regional series is supplied.",
    "Recommendations are computed from confirmed Career Profile evidence; the catalogue never writes to or alters evidence.",
  ],
}
