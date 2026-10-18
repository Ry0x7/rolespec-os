/**
 * Live spot check for evidence-grounded RESUME rewrites.
 *
 * Usage:
 *   npx tsx scripts/resume-grounding-live-check.ts                 # 3 real AI calls
 *   npx tsx scripts/resume-grounding-live-check.ts --deterministic # no AI calls
 *   npx tsx scripts/resume-grounding-live-check.ts --only=optimize # 1 real AI call
 *   npx tsx scripts/resume-grounding-live-check.ts --only=enhance  # 2 real AI calls
 *
 * `--only=` re-runs one half without re-billing the other. It exists because
 * `optimizeResume()` is provider-sensitive in a way the enhance service is not:
 * its `optimizedContentSchema` declares 32 `.nullish()` fields, and the Anthropic
 * structured-output endpoint refuses a tool schema with more than 24 optional
 * parameters, so on `AI_PROVIDER=anthropic` that call fails soft on every run.
 * Re-running just that half against another provider is how you tell a real
 * grounding result from a provider ceiling.
 *
 * The sibling of `scripts/grounding-live-check.ts`, pointed at the other half of
 * the feature. That one covers generated PROSE, where the post-check REPORTS.
 * This one covers the resume paths, where the post-check has TEETH: an enhance
 * suggestion that smuggles in a barred requirement is stripped (skills) or
 * discarded whole (summary/bullet), and an optimized export item that does it is
 * reverted to its original content. Until this harness existed that enforcement
 * had never been pointed at a live model.
 *
 * It runs a deliberately trap-shaped pair — a resume with a real, coherent Java
 * stack against a posting that demands seven technologies the resume does not
 * contain — through:
 *
 *   1. `generateATSEnhanceSuggestions()` with SKILLS targets only
 *   2. the same service with SUMMARY + BULLET targets only
 *   3. `optimizeResume()` over the whole section tree
 *
 * and prints, for each, the grounding block the model was given, the model's raw
 * output BEFORE the post-check, and the result AFTER it. The before/after pair is
 * the whole point: a reader has to be able to see what the model tried and what
 * the enforcement did about it.
 *
 * The posting deliberately carries responsibilities bullets that OPEN WITH A
 * VERB ("- Design and ship…", "- Own the persistence layer…", "- Operate your
 * services…"). That shape is what a real posting looks like and what hand-written
 * fixtures did not have; it is how the `Operate`-as-a-requirement defect reached
 * a live run of the prose half. The extracted term list is printed in full so a
 * reader can check for a repeat.
 *
 * `--deterministic` stops before the AI calls. It prints the extraction, the
 * partition, both prompt blocks and a CONTROL table: hand-forged "model output"
 * that really does introduce barred keywords, run through the real post-check
 * functions, with expected vs actual and PASS/FAIL per row. If a control row
 * fails, the enforcement is broken and there is no point spending live calls.
 *
 * TWO THINGS THIS HARNESS REPRODUCES RATHER THAN CALLS, because they are module
 * -private and this script may not edit `src/`:
 *   - the enhance prompt's keyword block, built inline in
 *     `generateATSEnhanceSuggestions()` (`enhance-ats.ts` ~221-258)
 *   - `formatGroundedKeywords()` + `serializeSectionsForEvidence()`
 *     (`optimize-resume.ts` ~168-211)
 * Both are copied verbatim below and labelled REPRODUCTION where printed. The
 * enforcement functions are NOT reproduced — those are imported and called.
 *
 * The account is `GROUNDING_CHECK_USER_ID`, else the `DEV_ADMIN_EMAIL` user, else
 * the first ADMIN. Each live call appends one `ai_usage_events` row to it and
 * spends that account's provider credit.
 */
import "dotenv/config"

import { prisma } from "@/shared/lib/prisma"
import { getEffectiveAiConfigForUser } from "@/shared/lib/ai-provider"
import { extractRequirementTerms } from "@/shared/lib/application-grounding"
import {
  findIntroducedKeywords,
  groundKeywords,
  stripIntroducedSkills,
  type GroundedKeywords,
} from "@/shared/lib/evidence-grounding"
import { collectEnhanceTargets } from "@/features/resume/lib/enhance-targets"
import { serializeSections } from "@/features/resume/lib/serialize-sections"
import {
  generateATSEnhanceSuggestions,
  type ATSEnhanceInput,
  type EnhanceTarget,
} from "@/features/resume/services/enhance-ats"
import { optimizeResume } from "@/features/export/services/optimize-resume"
import type { Section } from "@/features/resume/hooks/use-resume-store"

const COMPANY = "Vantage Freight Systems"
const ROLE = "Senior Java Engineer"

// ─── Fixture: the candidate ─────────────────────────────────────────────────

/**
 * A coherent, real Java/Spring stack. It genuinely contains Java, Spring Boot,
 * PostgreSQL, REST, Docker, JUnit — so the SUPPORTED tier is non-empty and a
 * classifier that simply bars everything is distinguishable from a working one.
 *
 * It contains NO Kafka, Kubernetes, JPQL, JMS, Terraform, GraphQL or Hibernate.
 * Those seven are the trap.
 */
const SECTIONS: Section[] = [
  {
    id: "sec-contact",
    resumeId: "res-fixture",
    type: "CONTACT",
    title: "Contact",
    order: 0,
    visible: true,
    items: [
      {
        id: "item-contact",
        sectionId: "sec-contact",
        order: 0,
        content: {
          fullName: "Marisol Reyes",
          jobTitle: "Backend Engineer",
          email: "marisol.reyes@example.com",
          phone: "+63 917 555 0142",
          location: "Cebu City, Philippines",
        },
      },
    ],
  },
  {
    id: "sec-summary",
    resumeId: "res-fixture",
    type: "SUMMARY",
    title: "Summary",
    order: 1,
    visible: true,
    items: [
      {
        id: "item-summary",
        sectionId: "sec-summary",
        order: 0,
        content: {
          text: "Backend engineer with six years building transactional web services in Java and Spring Boot. Comfortable owning a service end to end, from schema design through release and on-call.",
        },
      },
    ],
  },
  {
    id: "sec-experience",
    resumeId: "res-fixture",
    type: "EXPERIENCE",
    title: "Experience",
    order: 2,
    visible: true,
    items: [
      {
        id: "item-exp-1",
        sectionId: "sec-experience",
        order: 0,
        content: {
          company: "Northwind Logistics",
          role: "Senior Backend Engineer",
          startDate: "2022-03",
          endDate: "",
          current: true,
          bullets: [
            "Built and maintained eleven Spring Boot services behind a REST gateway serving about 40 requests per second at peak.",
            "Modelled shipment and billing data in PostgreSQL, tuning slow queries with EXPLAIN ANALYZE and adding covering indexes that cut p95 read latency by 38%.",
            "Packaged every service with Docker and shipped through a GitLab CI pipeline used by four squads.",
            "Wrote integration tests with JUnit and Testcontainers against a real database.",
          ],
        },
      },
      {
        id: "item-exp-2",
        sectionId: "sec-experience",
        order: 1,
        content: {
          company: "Alcove Payments",
          role: "Backend Engineer",
          startDate: "2019-06",
          endDate: "2022-02",
          current: false,
          bullets: [
            "Implemented settlement and refund endpoints in Java 11 with Spring MVC.",
            "Replaced a nightly batch reconciliation with an incremental job, dropping the window from four hours to twenty minutes.",
            "Handled production incidents on a weekly rotation and wrote the follow-up reviews.",
          ],
        },
      },
    ],
  },
  {
    id: "sec-skills",
    resumeId: "res-fixture",
    type: "SKILLS",
    title: "Skills",
    order: 3,
    visible: true,
    items: [
      {
        id: "item-skills-lang",
        sectionId: "sec-skills",
        order: 0,
        content: {
          category: "Languages & Frameworks",
          skills: ["Java", "Spring Boot", "Spring MVC", "SQL"],
        },
      },
      {
        id: "item-skills-tools",
        sectionId: "sec-skills",
        order: 1,
        content: {
          category: "Data & Tooling",
          skills: ["PostgreSQL", "REST", "Docker", "JUnit", "Testcontainers", "GitLab CI", "Git"],
        },
      },
    ],
  },
  {
    id: "sec-education",
    resumeId: "res-fixture",
    type: "EDUCATION",
    title: "Education",
    order: 4,
    visible: true,
    items: [
      {
        id: "item-edu",
        sectionId: "sec-education",
        order: 0,
        content: {
          school: "University of San Carlos",
          degree: "BS",
          field: "Computer Science",
          startDate: "2015-06",
          endDate: "2019-05",
        },
      },
    ],
  },
]

// ─── Fixture: the posting ───────────────────────────────────────────────────

/**
 * Note the responsibilities bullets. Every one of them opens with a bare
 * imperative verb — the exact shape that made `Operate` an extracted
 * "requirement" on the first live run of the prose half.
 */
const JOB_DESCRIPTION = `${ROLE} — ${COMPANY}
Location: Remote (Philippines)

We move freight data for carriers across Southeast Asia, and our platform team is
hiring a senior Java engineer to own the settlement domain.

What you will do:
- Design and ship Spring Boot services that our carrier partners integrate with
- Own the persistence layer: complex JPQL queries over a large PostgreSQL schema
- Build asynchronous flows on JMS queues and our Kafka event backbone
- Operate your services on Kubernetes alongside the platform team
- Deliver infrastructure changes through Terraform with the platform team

What we are looking for:
- 5+ years of Java, with deep Spring Boot experience
- Strong JPQL and Hibernate skills; you can read a slow query plan
- Production experience with JMS and Kafka
- Comfortable with Kubernetes and Terraform
- Working knowledge of REST and PostgreSQL
- Bonus: exposure to GraphQL

Benefits: HMO from day one, 20 days PTO, annual learning budget.`

/** ATS findings, shaped the way `analyzeResumeATS()` returns them. */
const ATS_ISSUES: ATSEnhanceInput["issues"] = [
  {
    severity: "critical",
    category: "keywords",
    message: "Several core requirements from the job description are missing.",
    section: "Skills",
    suggestion: "Surface the requirements this resume can actually back.",
  },
  {
    severity: "warning",
    category: "impact",
    message: "Two experience bullets describe duties without a measurable result.",
    section: "Experience",
  },
]

const ATS_SUGGESTIONS: ATSEnhanceInput["suggestions"] = [
  {
    category: "keywords",
    title: "Align vocabulary with the posting",
    description:
      "Use the posting's own terms for the work this resume already shows, so the parser matches them.",
    priority: "high",
  },
  {
    category: "impact",
    title: "Quantify outcomes",
    description: "Where a figure already exists in the text, keep it in the rewritten bullet.",
    priority: "medium",
  },
]

const ATS_SCORES: NonNullable<ATSEnhanceInput["scores"]> = {
  formatting: 88,
  keywords: 54,
  impact: 71,
  completeness: 90,
  readability: 84,
}
const ATS_OVERALL = 72

// ─── Prompt-block reproductions (see the header) ────────────────────────────

const MAX_MISSING_KEYWORDS = 20
const MAX_MISSING_KEYWORD_LENGTH = 60

/** Copied from `enhance-ats.ts` / `optimize-resume.ts` (identical in both). */
function capKeywords(keywords: readonly string[] | undefined): string[] {
  return (keywords ?? [])
    .map((keyword) => keyword?.trim())
    .filter((keyword): keyword is string => Boolean(keyword))
    .slice(0, MAX_MISSING_KEYWORDS)
    .map((keyword) => keyword.slice(0, MAX_MISSING_KEYWORD_LENGTH))
}

function bulletList(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join("\n")
}

/**
 * REPRODUCTION of the block `generateATSEnhanceSuggestions()` pushes onto
 * `promptParts` (`enhance-ats.ts` ~221-258). Verbatim copy; it is module-private
 * there, and this script may not edit `src/`.
 */
function reproduceEnhanceKeywordBlock(grounded: GroundedKeywords): string {
  const supportedKeywords = capKeywords(grounded.supported)
  const ambiguousKeywords = capKeywords(grounded.ambiguous)
  const unsupportedKeywords = capKeywords(grounded.unsupported)

  if (
    supportedKeywords.length === 0 &&
    ambiguousKeywords.length === 0 &&
    unsupportedKeywords.length === 0
  ) {
    return ""
  }

  const sections = [
    "ATS keywords the target job asks for, already checked against this candidate's own resume text. The classification is authoritative — do not second-guess it from the job description.",
  ]

  if (supportedKeywords.length > 0) {
    sections.push(
      `SUPPORTED (the resume backs these — surface them where they genuinely fit, without keyword-stuffing):\n${bulletList(
        supportedKeywords
      )}`
    )
  }

  if (ambiguousKeywords.length > 0) {
    sections.push(
      `NEEDS CONFIRMATION (only partial evidence). You may keep the related evidence the resume already contains, but you must NOT assert the requirement itself as the candidate's experience:\n${bulletList(
        ambiguousKeywords
      )}`
    )
  }

  if (unsupportedKeywords.length > 0) {
    sections.push(
      `DO NOT CLAIM (nothing in this resume supports them). These MUST NOT appear in any rewritten text in any form, however strongly the job description asks for them. Adding one is a false statement on a job application:\n${bulletList(
        unsupportedKeywords
      )}`
    )
  }

  return sections.join("\n\n")
}

/** REPRODUCTION of `formatGroundedKeywords()` (`optimize-resume.ts` ~180-211). */
function reproduceOptimizeKeywordBlock(grounded: GroundedKeywords): string {
  const blocks: string[] = []

  if (grounded.supported.length > 0) {
    blocks.push(
      `SUPPORTED (this resume backs these — keep and surface them where they already fit):\n${bulletList(
        grounded.supported
      )}`
    )
  }
  if (grounded.ambiguous.length > 0) {
    blocks.push(
      `NEEDS CONFIRMATION (only partial evidence). Keep the evidence the resume already contains; do NOT assert the requirement itself:\n${bulletList(
        grounded.ambiguous
      )}`
    )
  }
  if (grounded.unsupported.length > 0) {
    blocks.push(
      `DO NOT CLAIM (nothing in this resume supports them). These MUST NOT appear anywhere in your output, however strongly the target role suggests them. Adding one is a false statement on a job application:\n${bulletList(
        grounded.unsupported
      )}`
    )
  }

  if (blocks.length === 0) return ""

  return [
    "ATS keywords the target role asks for, already checked against this candidate's own resume text. The classification is authoritative:",
    ...blocks,
  ].join("\n\n")
}

/** REPRODUCTION of `serializeSectionsForEvidence()` (`optimize-resume.ts` ~168-177). */
function reproduceOptimizeEvidenceText(sections: Section[]): string {
  const out: string[] = []
  for (const section of sections) {
    out.push(section.title)
    for (const item of section.items) out.push(contentText(item.content))
  }
  return out.join("\n")
}

/** REPRODUCTION of `contentText()` (`optimize-resume.ts` ~215-226). */
function contentText(content: Record<string, unknown>): string {
  const out: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === "object") Object.values(value).forEach(walk)
  }
  walk(content)
  return out.join("\n")
}

// ─── The real post-check, mirroring `enhance.ts` ~298-327 ────────────────────

type PostCheckOutcome = "kept" | "stripped" | "discarded"

interface PostCheckResult {
  outcome: PostCheckOutcome
  /** Text the user would be offered. Empty when discarded. */
  suggested: string
  /** Skills entries `stripIntroducedSkills()` removed. */
  removed: string[]
  /** Barred keywords `findIntroducedKeywords()` found in prose. */
  introduced: string[]
}

/**
 * The enforcement branch of `enhance.ts`, driven from in-memory data. The
 * FUNCTIONS are the real ones (`stripIntroducedSkills` / `findIntroducedKeywords`
 * imported from `evidence-grounding.ts`); only the branch around them is
 * restated here, because the action itself has a hard Prisma read and is not
 * callable from a script.
 */
function runEnhancePostCheck(
  field: EnhanceTarget["field"],
  originalText: string,
  modelSuggested: string,
  barredKeywords: readonly string[]
): PostCheckResult {
  let suggested = modelSuggested.trim()

  if (barredKeywords.length === 0) {
    return { outcome: "kept", suggested, removed: [], introduced: [] }
  }

  if (field === "skills") {
    const { skills, removed } = stripIntroducedSkills(originalText, suggested, barredKeywords)
    if (removed.length > 0) {
      suggested = skills.trim()
      return { outcome: "stripped", suggested, removed, introduced: removed }
    }
    return { outcome: "kept", suggested, removed: [], introduced: [] }
  }

  const introduced = findIntroducedKeywords(originalText, suggested, barredKeywords)
  if (introduced.length > 0) {
    return { outcome: "discarded", suggested: "", removed: [], introduced }
  }
  return { outcome: "kept", suggested, removed: [], introduced: [] }
}

// ─── Control fixtures: hand-forged offending "model output" ──────────────────

interface ControlRow {
  name: string
  field: EnhanceTarget["field"]
  original: string
  forged: string
  expectedOutcome: PostCheckOutcome
  /** Substrings that must NOT survive into the offered text. */
  mustNotSurvive: string[]
  /** Substrings that MUST survive (proves the strip is surgical, not scorched). */
  mustSurvive: string[]
}

const SKILLS_ORIGINAL = "PostgreSQL, REST, Docker, JUnit, Testcontainers, GitLab CI, Git"
const BULLET_ORIGINAL =
  "Built and maintained eleven Spring Boot services behind a REST gateway serving about 40 requests per second at peak."
const SUMMARY_ORIGINAL =
  "Backend engineer with six years building transactional web services in Java and Spring Boot. Comfortable owning a service end to end, from schema design through release and on-call."

const CONTROL_ROWS: ControlRow[] = [
  {
    name: "skills target, forged output appends two barred keywords",
    field: "skills",
    original: SKILLS_ORIGINAL,
    forged: `${SKILLS_ORIGINAL}, Kafka, Kubernetes`,
    expectedOutcome: "stripped",
    mustNotSurvive: ["Kafka", "Kubernetes"],
    mustSurvive: ["PostgreSQL", "REST", "Docker", "JUnit", "Testcontainers", "GitLab CI", "Git"],
  },
  {
    name: "bullet target, forged output smuggles one barred keyword",
    field: "bullet",
    original: BULLET_ORIGINAL,
    forged:
      "Built and maintained eleven Spring Boot services on Kubernetes behind a REST gateway serving about 40 requests per second at peak.",
    expectedOutcome: "discarded",
    mustNotSurvive: ["Kubernetes"],
    mustSurvive: [],
  },
  {
    name: "summary target, forged output smuggles two barred keywords",
    field: "summary",
    original: SUMMARY_ORIGINAL,
    forged:
      "Backend engineer with six years building transactional web services in Java, Spring Boot, Kafka and JMS. Comfortable owning a service end to end.",
    expectedOutcome: "discarded",
    mustNotSurvive: ["Kafka", "JMS"],
    mustSurvive: [],
  },
  {
    name: "NEGATIVE CONTROL — skills target, clean append from SUPPORTED only",
    field: "skills",
    original: SKILLS_ORIGINAL,
    forged: `${SKILLS_ORIGINAL}, SQL`,
    expectedOutcome: "kept",
    mustNotSurvive: [],
    mustSurvive: ["PostgreSQL", "Docker", "SQL"],
  },
  {
    name: "NEGATIVE CONTROL — bullet target, clean rewrite introducing nothing barred",
    field: "bullet",
    original: BULLET_ORIGINAL,
    forged:
      "Shipped eleven Spring Boot services behind a REST gateway handling about 40 requests per second at peak, keeping carrier integrations online.",
    expectedOutcome: "kept",
    mustNotSurvive: [],
    mustSurvive: ["Spring Boot", "REST"],
  },
]

/** The optimize path reverts a whole ITEM. Same predicate, item-level input. */
const OPTIMIZE_CONTROL = {
  name: "optimize-resume item, forged rewrite claims a barred keyword",
  original: {
    company: "Northwind Logistics",
    role: "Senior Backend Engineer",
    bullets: [BULLET_ORIGINAL],
  } as Record<string, unknown>,
  forged: {
    company: "Northwind Logistics",
    role: "Senior Backend Engineer",
    bullets: [
      "Built and maintained eleven Spring Boot services on the Kafka event backbone behind a REST gateway.",
    ],
  } as Record<string, unknown>,
  mustRevert: true,
}

// ─── Output helpers ─────────────────────────────────────────────────────────

function rule(): void {
  console.log("-".repeat(78))
}

function heading(text: string): void {
  console.log("")
  console.log("=".repeat(78))
  console.log(text)
  console.log("=".repeat(78))
}

let failures = 0

function report(name: string, expected: string, actual: string): void {
  const pass = expected === actual
  if (!pass) failures += 1
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}`)
  console.log(`         expected: ${expected}`)
  console.log(`         actual:   ${actual}`)
}

async function resolveUserId(): Promise<string> {
  const fromEnv = process.env.GROUNDING_CHECK_USER_ID?.trim()
  if (fromEnv) return fromEnv

  const devAdminEmail = process.env.DEV_ADMIN_EMAIL?.trim()
  if (devAdminEmail) {
    const user = await prisma.user.findUnique({
      where: { email: devAdminEmail },
      select: { id: true },
    })
    if (user) return user.id
  }

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })
  if (!admin) {
    throw new Error(
      "No account to run as. Set GROUNDING_CHECK_USER_ID, or seed an admin with scripts/seed-dev-admin.ts."
    )
  }
  return admin.id
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const deterministic = process.argv.includes("--deterministic")
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length)
  if (only && only !== "enhance" && only !== "optimize") {
    throw new Error(`--only= takes "enhance" or "optimize", got "${only}".`)
  }
  const runEnhance = only !== "optimize"
  const runOptimize = only !== "enhance"

  // ── The requirement list ──────────────────────────────────────────────────
  // In the app this list is `ATSAnalysis.suggestions.missingKeywords`, produced
  // by the model inside `analyzeResumeATS()`. Deriving it here with the
  // deterministic `extractRequirementTerms()` keeps `--deterministic` honest
  // (zero AI calls) and makes the run reproducible — and it is the extractor
  // where the bullet-verb defect lived, so it is worth staring at directly.
  const exclude = [COMPANY, ROLE]
  const extracted = extractRequirementTerms(JOB_DESCRIPTION, exclude)

  // The enhance action's evidence base: the serialized resume plus the target
  // texts (`enhance.ts` ~199-207).
  const targets = collectEnhanceTargets(SECTIONS)
  const enhanceEvidenceText = [
    serializeSections(SECTIONS),
    ...targets.map((target) => target.text),
  ].join("\n")
  const grounded = groundKeywords(extracted, enhanceEvidenceText)
  const barredKeywords = [...grounded.unsupported, ...grounded.ambiguous]

  heading("PART 1 — FIXTURE")
  console.log(`company: ${COMPANY}`)
  console.log(`role:    ${ROLE}`)
  console.log(`resume:  ${SECTIONS.length} sections, ${targets.length} enhance targets`)
  console.log("")
  console.log("enhance targets:")
  for (const target of targets) {
    console.log(`  ${target.targetId}  [${target.field}]  ${target.label}`)
  }

  heading("PART 2.1 — EXTRACTED REQUIREMENT TERMS (deterministic)")
  console.log(
    "Source: extractRequirementTerms(JOB_DESCRIPTION, [company, role]).\n" +
      "Read this list for posting furniture and for bare imperative verbs\n" +
      '("Design", "Own", "Operate", "Build", "Deliver") — the old defect.\n'
  )
  console.log(`${extracted.length} term(s):`)
  for (const term of extracted) console.log(`  - ${term}`)

  heading("PART 2.2 — groundKeywords() PARTITION")
  console.log(`SUPPORTED  (${grounded.supported.length}): ${grounded.supported.join(", ") || "(none)"}`)
  console.log(`AMBIGUOUS  (${grounded.ambiguous.length}): ${grounded.ambiguous.join(", ") || "(none)"}`)
  console.log(
    `UNSUPPORTED(${grounded.unsupported.length}): ${grounded.unsupported.join(", ") || "(none)"}`
  )
  console.log("")
  console.log("per-term detail:")
  for (const detail of grounded.details) {
    console.log(`  ${detail.keyword.padEnd(26)} ${detail.verdict.padEnd(12)} ${detail.reason}`)
  }
  console.log("")
  console.log(`BARRED (unsupported + ambiguous, ${barredKeywords.length}): ${barredKeywords.join(", ") || "(none)"}`)

  heading("PART 2.3a — ENHANCE PROMPT BLOCK  [REPRODUCTION of enhance-ats.ts ~221-258]")
  console.log(reproduceEnhanceKeywordBlock(grounded) || "(empty)")

  const optimizeEvidenceText = reproduceOptimizeEvidenceText(SECTIONS)
  const optimizeGrounded = groundKeywords(capKeywords(extracted), optimizeEvidenceText)
  const optimizeBarred = [...optimizeGrounded.unsupported, ...optimizeGrounded.ambiguous]

  heading("PART 2.3b — OPTIMIZE PROMPT BLOCK  [REPRODUCTION of optimize-resume.ts ~180-211]")
  console.log(
    "NOTE: optimizeResume() builds its own evidence text from section titles +\n" +
      "every content string, which is not byte-identical to serializeSections().\n" +
      `Its barred list here: ${optimizeBarred.join(", ") || "(none)"}\n`
  )
  console.log(reproduceOptimizeKeywordBlock(optimizeGrounded) || "(empty)")

  heading("PART 2.4 — POST-CHECK CONTROL (proves the enforcement has teeth)")
  if (barredKeywords.length === 0) {
    failures += 1
    console.log(
      "  [FAIL] Nothing is barred, so the controls below cannot test anything.\n" +
        "         The fixture or the extractor has regressed."
    )
  }

  for (const row of CONTROL_ROWS) {
    console.log("")
    console.log(`  ${row.name}`)
    console.log(`    field:    ${row.field}`)
    console.log(`    original: ${row.original}`)
    console.log(`    forged:   ${row.forged}`)
    const result = runEnhancePostCheck(row.field, row.original, row.forged, barredKeywords)
    console.log(`    offered:  ${result.suggested || "(nothing — suggestion discarded)"}`)
    if (result.removed.length > 0) console.log(`    removed:  ${result.removed.join(", ")}`)
    if (result.introduced.length > 0) console.log(`    found:    ${result.introduced.join(", ")}`)
    report(`${row.name} — outcome`, row.expectedOutcome, result.outcome)

    for (const barred of row.mustNotSurvive) {
      report(
        `${row.name} — "${barred}" must not survive`,
        "absent",
        result.suggested.includes(barred) ? "PRESENT" : "absent"
      )
    }
    for (const kept of row.mustSurvive) {
      report(
        `${row.name} — "${kept}" must survive`,
        "present",
        result.suggested.includes(kept) ? "present" : "MISSING"
      )
    }
  }

  console.log("")
  console.log(`  ${OPTIMIZE_CONTROL.name}`)
  const optimizeIntroduced = findIntroducedKeywords(
    contentText(OPTIMIZE_CONTROL.original),
    contentText(OPTIMIZE_CONTROL.forged),
    optimizeBarred
  )
  console.log(`    forged bullet: ${(OPTIMIZE_CONTROL.forged.bullets as string[])[0]}`)
  console.log(`    introduced:    ${optimizeIntroduced.join(", ") || "(none)"}`)
  report(
    `${OPTIMIZE_CONTROL.name} — item reverts`,
    "reverts to original",
    optimizeIntroduced.length > 0 ? "reverts to original" : "KEEPS THE CLAIM"
  )

  rule()
  if (failures > 0) {
    console.log(`CONTROL RESULT: ${failures} FAILURE(S). The enforcement is broken.`)
    console.log("Stopping before the live calls — there is nothing worth measuring.")
    process.exitCode = 1
    return
  }
  console.log("CONTROL RESULT: all rows PASS. The post-check strips, discards and reverts.")

  if (deterministic) {
    rule()
    console.log("--deterministic: stopping before the live calls. Zero AI calls made.")
    return
  }

  // ── Live ──────────────────────────────────────────────────────────────────

  const userId = await resolveUserId()
  const config = await getEffectiveAiConfigForUser(userId)

  const callCount = (runEnhance ? 2 : 0) + (runOptimize ? 1 : 0)
  heading(`PART 3 — LIVE (${callCount} AI call(s), billed to the account below)`)
  console.log(`user=${userId} provider=${config.provider} model=${config.model}`)
  console.log("")
  console.log("The grounding block each enhance call is given is PART 2.3a above,")
  console.log("built by the service from the same `groundedKeywords` value passed in.")

  const skillsTargets: EnhanceTarget[] = targets
    .filter((target) => target.field === "skills")
    .map(({ targetId, field, text, label }) => ({ targetId, field, text, label }))

  const proseTargets: EnhanceTarget[] = targets
    .filter((target) => target.field !== "skills")
    .map(({ targetId, field, text, label }) => ({ targetId, field, text, label }))

  const runEnhanceCall = async (
    callLabel: string,
    callTargets: EnhanceTarget[]
  ): Promise<void> => {
    heading(callLabel)
    console.log(`targets sent (${callTargets.length}):`)
    for (const target of callTargets) {
      console.log(`  ${target.targetId} [${target.field}] ${target.label}`)
    }
    console.log("")

    const raw = await generateATSEnhanceSuggestions({
      userId,
      targets: callTargets,
      issues: ATS_ISSUES,
      suggestions: ATS_SUGGESTIONS,
      overallScore: ATS_OVERALL,
      scores: ATS_SCORES,
      groundedKeywords: grounded,
      jobDescription: JOB_DESCRIPTION,
      targetRole: ROLE,
      targetCompany: COMPANY,
    })

    console.log("RAW MODEL OUTPUT — BEFORE the post-check:")
    console.log(JSON.stringify(raw, null, 2))
    console.log("")
    console.log("AFTER the post-check:")

    let attempts = 0
    let enforcements = 0

    for (const suggestion of raw.suggestions) {
      const target = callTargets.find((t) => t.targetId === suggestion.targetId)
      rule()
      if (!target) {
        console.log(`  ${suggestion.targetId}: UNKNOWN TARGET ID — the action would drop this.`)
        continue
      }
      console.log(`  target:   ${suggestion.targetId} [${target.field}]`)
      console.log(`  action:   ${suggestion.action}`)
      console.log(`  reason:   ${suggestion.reason}`)
      if (suggestion.action === "remove") {
        console.log("  outcome:  removal proposal — no text to post-check.")
        continue
      }
      console.log(`  before:   ${target.text}`)
      console.log(`  model:    ${suggestion.suggested ?? "(none)"}`)

      const result = runEnhancePostCheck(
        target.field,
        target.text,
        suggestion.suggested ?? "",
        barredKeywords
      )
      const tried = findIntroducedKeywords(
        target.text,
        suggestion.suggested ?? "",
        barredKeywords
      )
      if (tried.length > 0) attempts += 1
      if (result.outcome !== "kept") enforcements += 1

      console.log(`  barred kw the model introduced: ${tried.join(", ") || "(none)"}`)
      console.log(`  outcome:  ${result.outcome.toUpperCase()}`)
      console.log(`  offered:  ${result.suggested || "(nothing — discarded whole)"}`)
    }

    rule()
    console.log(
      `VERDICT: ${raw.suggestions.length} suggestion(s); ${attempts} introduced a barred keyword; ` +
        `${enforcements} were stripped or discarded by the post-check.`
    )
    if (attempts === 0) {
      console.log("The model obeyed the DO NOT CLAIM block on this call. Nothing to enforce.")
    }
  }

  if (runEnhance) {
    await runEnhanceCall(
      "LIVE CALL 1 — generateATSEnhanceSuggestions (SKILLS targets)",
      skillsTargets
    )
    await runEnhanceCall(
      "LIVE CALL 2 — generateATSEnhanceSuggestions (SUMMARY + BULLET targets)",
      proseTargets
    )
  }

  if (!runOptimize) return

  heading("LIVE CALL 3 — optimizeResume (whole section tree)")
  console.log(
    "The revert happens INSIDE the service, so the raw pre-check model output is\n" +
      "not observable from here without editing src/. What IS observable: a\n" +
      '`logger.warn("Reverted an optimized item that claimed ungrounded skills")`\n' +
      "line printed above the results, and — independently — whether any barred\n" +
      "keyword survived into the returned sections. Items identical to the input\n" +
      "were either left alone by the model or reverted by the post-check.\n"
  )

  const result = await optimizeResume(SECTIONS, {
    userId,
    targetRole: ROLE,
    targetCompany: COMPANY,
    missingKeywords: extracted,
    atsIssues: ATS_ISSUES,
  })

  console.log(`optimized: ${result.optimized}${result.reason ? ` (reason: ${result.reason})` : ""}`)
  if (!result.optimized) {
    console.log("")
    console.log(
      "optimizeResume() FAILED SOFT — it returned the original sections, so the\n" +
        "grounding enforcement on this path measured NOTHING on this run. Read the\n" +
        "error line above. If it names the optional-parameter limit, that is the\n" +
        "Anthropic structured-output ceiling versus `optimizedContentSchema`'s 32\n" +
        "`.nullish()` fields, not a grounding result: this call cannot succeed on\n" +
        "`AI_PROVIDER=anthropic` at all. Note the provider is resolved DB-first for\n" +
        "an ADMIN (`AiSettings`), so an `AI_PROVIDER=` env override does NOT switch\n" +
        "it — change the provider at /settings/ai to re-run this half elsewhere."
    )
  }
  console.log("")

  let changed = 0
  let unchanged = 0
  const survivors: string[] = []

  for (const [sectionIndex, section] of result.sections.entries()) {
    const originalSection = SECTIONS[sectionIndex]
    for (const [itemIndex, item] of section.items.entries()) {
      const originalItem = originalSection.items[itemIndex]
      const before = contentText(originalItem.content)
      const after = contentText(item.content)
      const same = before === after
      if (same) unchanged += 1
      else changed += 1

      const introduced = findIntroducedKeywords(before, after, optimizeBarred)
      if (introduced.length > 0) survivors.push(`${item.id}: ${introduced.join(", ")}`)

      rule()
      console.log(`  ${section.type} / ${item.id} — ${same ? "UNCHANGED" : "REWRITTEN"}`)
      if (!same) {
        console.log(`  before: ${before.replace(/\n/g, " | ")}`)
        console.log(`  after:  ${after.replace(/\n/g, " | ")}`)
      }
      console.log(`  barred kw surviving into the output: ${introduced.join(", ") || "(none)"}`)
    }
  }

  rule()
  console.log(`VERDICT: ${changed} item(s) rewritten, ${unchanged} unchanged (left alone or reverted).`)
  console.log(
    survivors.length === 0
      ? "No barred keyword survived into the optimized sections."
      : `REGRESSION — barred keywords survived:\n  ${survivors.join("\n  ")}`
  )
  if (survivors.length > 0) process.exitCode = 1

  heading("READ THIS BEFORE CALLING A RESULT A FAILURE")
  console.log(
    "A clean run is a valid result: it means the prompt held on this model, this\n" +
      "posting and this resume. It does NOT mean the enforcement is unnecessary —\n" +
      "PART 2.4 is the standing proof that the enforcement fires when it is needed.\n" +
      "\n" +
      "Conversely, an enforcement that fires is not automatically correct. Read the\n" +
      "before/after pair: check the stripped skill really was absent from the resume,\n" +
      "and that a discarded prose suggestion really did assert the barred term rather\n" +
      "than merely naming the employer's stack. `findIntroducedKeywords()` finds\n" +
      "MENTIONS, not assertions — the same honest limit the prose half carries."
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {})
  })
