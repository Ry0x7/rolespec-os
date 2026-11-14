/**
 * Live AI quality harness for the resume ATS → enhance → rescore loop.
 *
 * Usage:
 *   npx tsx scripts/ats-quality-harness.ts [--iterations N] [--json]
 *
 * Runs in memory with no dev server and no resume/ATS rows written. It DOES make
 * real AI calls — one analyze plus (enhance + analyze) per iteration, so the
 * default run is 3 calls — and each of those appends one `ai_usage_events` row
 * under the `HARNESS_USER_ID` below.
 *
 * Each sample resume is deliberately mediocre (generic bullets, no metrics,
 * keywords missing versus the job description) so a pass has room to improve it.
 *
 * Every scenario in `SCENARIOS` is measured the same way, so the AI call count is
 * `scenarios * (1 + iterations * 2)`. Scenarios cover more than one career track
 * on purpose — enhance quality on a nursing resume is not implied by its quality
 * on a frontend one.
 */
import "dotenv/config"

import { getEffectiveAiConfig } from "@/shared/lib/ai-provider"
import { prisma } from "@/shared/lib/prisma"
import {
  analyzeResumeATS,
  type ATSAnalysisResult,
} from "@/features/resume/services/ats-analyze"
import { serializeSections } from "@/features/resume/lib/serialize-sections"
import { groundKeywords } from "@/shared/lib/evidence-grounding"
import {
  generateATSEnhanceSuggestions,
  type ATSEnhanceInput,
} from "@/features/resume/services/enhance-ats"
import {
  collectEnhanceTargets,
  skillsToText,
  type EnhanceTargetRef,
} from "@/features/resume/lib/enhance-targets"
import type { Section } from "@/features/resume/hooks/use-resume-store"

// ─── Args ───────────────────────────────────────────────────────────────────

interface Args {
  iterations: number
  json: boolean
}

function parseArgs(argv: string[]): Args {
  let iterations = 1
  let json = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--iterations") {
      const value = Number(argv[++i])
      iterations = Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
    } else if (arg === "--json") {
      json = true
    }
  }

  return { iterations, json }
}

// ─── Sample input ───────────────────────────────────────────────────────────

/**
 * Recorded on the `ai_usage_events` rows this harness writes, so harness traffic
 * is distinguishable from a real user's in the admin Usage tab.
 */
const HARNESS_USER_ID = "ats-quality-harness"

/** One measured persona: a target role, its job posting, and a weak resume. */
interface Scenario {
  name: string
  targetRole: string
  jobDescription: string
  buildSections: () => Section[]
}

const FRONTEND_TARGET_ROLE = "Senior Frontend Engineer"

const FRONTEND_JOB_DESCRIPTION = `Senior Frontend Engineer — Northwind Analytics (Remote, US)

We are looking for a Senior Frontend Engineer to own the customer-facing
analytics dashboard used by thousands of daily users.

Responsibilities:
- Build and maintain features in React and TypeScript on a Next.js App Router codebase.
- Own component architecture and a shared design system built with Tailwind CSS.
- Improve Core Web Vitals (LCP, CLS, INP) and overall page performance.
- Write unit and end-to-end tests (Jest/Vitest, Playwright) and keep CI green.
- Partner with design and product on accessibility (WCAG 2.1 AA).
- Integrate GraphQL and REST APIs; manage client state with React Query.
- Mentor mid-level engineers and lead technical design reviews.

Requirements:
- 5+ years building production web applications.
- Deep expertise in React, TypeScript, and modern build tooling (Vite, Webpack).
- Experience with server-side rendering, code splitting, and bundle optimization.
- Familiarity with CI/CD (GitHub Actions), Docker, and observability tooling.
- Track record of measurable impact on performance or conversion metrics.`

/** A deliberately weak resume: vague bullets, zero metrics, thin keywords. */
function buildFrontendSections(): Section[] {
  const resumeId = "harness-resume-frontend"

  return [
    {
      id: "sec-contact",
      resumeId,
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
            fullName: "Alex Morgan",
            email: "alex.morgan@example.com",
            phone: "555-0142",
            location: "Austin, TX",
            linkedin: "linkedin.com/in/alexmorgan-example",
            github: "github.com/alexmorgan-example",
          },
        },
      ],
    },
    {
      id: "sec-summary",
      resumeId,
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
            text: "Hard-working web developer with several years of experience. I am a team player who likes building websites and learning new things. Looking for a new opportunity where I can grow.",
          },
        },
      ],
    },
    {
      id: "sec-experience",
      resumeId,
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
            role: "Web Developer",
            company: "Brightline Software",
            startDate: "2022-03",
            endDate: null,
            current: true,
            bullets: [
              "Responsible for working on the company web app and fixing bugs.",
              "Helped the team with new features and attended daily standups.",
              "Worked with designers to make pages look like the mockups.",
              "Did code reviews for other developers on the team.",
            ],
          },
        },
        {
          id: "item-exp-2",
          sectionId: "sec-experience",
          order: 1,
          content: {
            role: "Junior Developer",
            company: "Cobalt Digital",
            startDate: "2019-08",
            endDate: "2022-02",
            current: false,
            bullets: [
              "Made pages for client websites using HTML, CSS and JavaScript.",
              "Assisted senior developers with various tasks and maintenance.",
              "Fixed issues reported by clients and updated content.",
            ],
          },
        },
      ],
    },
    {
      id: "sec-projects",
      resumeId,
      type: "PROJECTS",
      title: "Projects",
      order: 3,
      visible: true,
      items: [
        {
          id: "item-proj-1",
          sectionId: "sec-projects",
          order: 0,
          content: {
            name: "Team Dashboard",
            startDate: "2023-01",
            endDate: "2023-05",
            bullets: [
              "Built a dashboard that shows charts for team data.",
              "Used a component library and made it responsive.",
            ],
            technologies: ["React", "JavaScript"],
          },
        },
      ],
    },
    {
      id: "sec-education",
      resumeId,
      type: "EDUCATION",
      title: "Education",
      order: 4,
      visible: true,
      items: [
        {
          id: "item-edu-1",
          sectionId: "sec-education",
          order: 0,
          content: {
            degree: "B.S.",
            field: "Information Systems",
            school: "State University",
            startDate: "2015-09",
            endDate: "2019-05",
          },
        },
      ],
    },
    {
      id: "sec-skills",
      resumeId,
      type: "SKILLS",
      title: "Skills",
      order: 5,
      visible: true,
      items: [
        {
          id: "item-skills-lang",
          sectionId: "sec-skills",
          order: 0,
          content: {
            category: "Languages & Frameworks",
            skills: ["JavaScript", "HTML", "CSS", "React", "jQuery"],
          },
        },
        {
          id: "item-skills-tools",
          sectionId: "sec-skills",
          order: 1,
          content: {
            category: "Tools",
            skills: ["Git", "VS Code", "Jira"],
          },
        },
      ],
    },
  ]
}

const NURSE_TARGET_ROLE = "Registered Nurse — Med-Surg"

const NURSE_JOB_DESCRIPTION = `Registered Nurse — Medical-Surgical Unit — Cedar Valley Regional Hospital (Columbus, OH)

Cedar Valley Regional is hiring a full-time Registered Nurse for our 32-bed
medical-surgical/telemetry unit, night shift, three 12-hour shifts per week.

Responsibilities:
- Provide direct patient care for a 1:5 med-surg assignment, escalating to the
  rapid response team when a patient decompensates.
- Complete admission assessments, hourly rounding, and discharge teaching.
- Chart all assessments, medication administration, and I&O in Epic within the shift.
- Administer medications using barcode medication administration (BCMA) and
  follow the facility's high-alert medication policy.
- Monitor telemetry, interpret basic cardiac rhythms, and manage IV therapy.
- Support fall prevention, pressure injury prevention, CAUTI and CLABSI bundles.
- Give and receive bedside shift handoff using SBAR.
- Precept nursing students and new-graduate nurses.

Requirements:
- Active RN license (Ohio or compact) and BSN preferred.
- 2+ years of acute care experience; med-surg or telemetry strongly preferred.
- Current BLS and ACLS certification.
- Demonstrated experience with electronic health records (Epic preferred).
- Evidence of measurable quality improvement (HCAHPS, fall rate, infection rate).`

/** The same deliberate weakness as the frontend sample, in a clinical career. */
function buildNurseSections(): Section[] {
  const resumeId = "harness-resume-nurse"

  return [
    {
      id: "nurse-sec-contact",
      resumeId,
      type: "CONTACT",
      title: "Contact",
      order: 0,
      visible: true,
      items: [
        {
          id: "nurse-item-contact",
          sectionId: "nurse-sec-contact",
          order: 0,
          content: {
            fullName: "Dana Whitfield",
            email: "dana.whitfield@example.com",
            phone: "555-0177",
            location: "Columbus, OH",
            linkedin: "linkedin.com/in/danawhitfield-example",
          },
        },
      ],
    },
    {
      id: "nurse-sec-summary",
      resumeId,
      type: "SUMMARY",
      title: "Summary",
      order: 1,
      visible: true,
      items: [
        {
          id: "nurse-item-summary",
          sectionId: "nurse-sec-summary",
          order: 0,
          content: {
            text: "Caring and dedicated nurse with a few years of hospital experience. I work well under pressure and always put my patients first. Seeking a position where I can continue to help people and grow as a nurse.",
          },
        },
      ],
    },
    {
      id: "nurse-sec-experience",
      resumeId,
      type: "EXPERIENCE",
      title: "Experience",
      order: 2,
      visible: true,
      items: [
        {
          id: "nurse-item-exp-1",
          sectionId: "nurse-sec-experience",
          order: 0,
          content: {
            role: "Staff Nurse",
            company: "Maple Grove Hospital",
            startDate: "2022-01",
            endDate: null,
            current: true,
            bullets: [
              "Responsible for taking care of patients on the floor during my shift.",
              "Gave medications and did charting in the computer system.",
              "Helped doctors during rounds and answered call lights.",
              "Attended staff meetings and completed required training.",
            ],
          },
        },
        {
          id: "nurse-item-exp-2",
          sectionId: "nurse-sec-experience",
          order: 1,
          content: {
            role: "Licensed Practical Nurse",
            company: "Riverbend Care Center",
            startDate: "2019-06",
            endDate: "2021-12",
            current: false,
            bullets: [
              "Assisted residents with daily needs and personal care.",
              "Passed medications and reported changes to the supervising nurse.",
              "Did wound care and kept records up to date.",
            ],
          },
        },
      ],
    },
    {
      id: "nurse-sec-certifications",
      resumeId,
      type: "CERTIFICATIONS",
      title: "Certifications",
      order: 3,
      visible: true,
      items: [
        {
          id: "nurse-item-cert-1",
          sectionId: "nurse-sec-certifications",
          order: 0,
          content: {
            name: "Registered Nurse License",
            organization: "Ohio Board of Nursing",
            dateObtained: "2021-11",
          },
        },
        {
          id: "nurse-item-cert-2",
          sectionId: "nurse-sec-certifications",
          order: 1,
          content: {
            name: "Basic Life Support (BLS)",
            organization: "American Heart Association",
            dateObtained: "2024-02",
          },
        },
      ],
    },
    {
      id: "nurse-sec-education",
      resumeId,
      type: "EDUCATION",
      title: "Education",
      order: 4,
      visible: true,
      items: [
        {
          id: "nurse-item-edu-1",
          sectionId: "nurse-sec-education",
          order: 0,
          content: {
            degree: "A.D.N.",
            field: "Nursing",
            school: "Columbus Community College",
            startDate: "2019-09",
            endDate: "2021-06",
          },
        },
      ],
    },
    {
      id: "nurse-sec-skills",
      resumeId,
      type: "SKILLS",
      title: "Skills",
      order: 5,
      visible: true,
      items: [
        {
          id: "nurse-item-skills-clinical",
          sectionId: "nurse-sec-skills",
          order: 0,
          content: {
            category: "Clinical",
            skills: ["Patient care", "Vital signs", "IV insertion", "Wound care"],
          },
        },
        {
          id: "nurse-item-skills-other",
          sectionId: "nurse-sec-skills",
          order: 1,
          content: {
            category: "Other",
            skills: ["Charting", "Teamwork", "Time management"],
          },
        },
      ],
    },
  ]
}

/** Personas measured on every run, in report order. */
const SCENARIOS: Scenario[] = [
  {
    name: "Senior Frontend Engineer",
    targetRole: FRONTEND_TARGET_ROLE,
    jobDescription: FRONTEND_JOB_DESCRIPTION,
    buildSections: buildFrontendSections,
  },
  {
    name: "Registered Nurse — Med-Surg",
    targetRole: NURSE_TARGET_ROLE,
    jobDescription: NURSE_JOB_DESCRIPTION,
    buildSections: buildNurseSections,
  },
]

// ─── Applying suggestions (mirrors use-resume-store applyEnhanceSuggestion) ──

/** Mirrors the caps the enhance server action enforces on model output. */
const MAX_SUGGESTED_LENGTH: Record<EnhanceTargetRef["field"], number> = {
  summary: 500,
  bullet: 220,
  skills: 600,
}
const LEADING_GLYPHS = /^[\s\-–—•*·▪◦]+/

/** Same normalisation the store uses when writing a skills rewrite back. */
function parseSkillsText(text: string): string[] {
  const skills: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(",")) {
    const skill = raw.trim()
    if (!skill) continue
    const key = skill.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    skills.push(skill)
  }
  return skills
}

/**
 * Replaces a target's text in place, using the store's staleness rules: a
 * bullet must still hold the original text, a skills list must still render to
 * the original string. Returns false when the write was rejected.
 */
function applySuggestion(
  sections: Section[],
  target: EnhanceTargetRef,
  suggested: string
): boolean {
  const section = sections.find((s) => s.id === target.sectionId)
  const item = section?.items.find((i) => i.id === target.itemId)
  if (!item) return false

  if (target.field === "summary") {
    item.content = { ...item.content, text: suggested }
    return true
  }

  if (target.field === "skills") {
    const current = parseSkillsText(skillsToText((item.content as { skills?: unknown }).skills))
    if (current.join(", ") !== parseSkillsText(target.text).join(", ")) return false
    const skills = parseSkillsText(suggested)
    if (skills.length === 0) return false
    item.content = { ...item.content, skills }
    return true
  }

  const bullets = (item.content as { bullets?: unknown }).bullets
  if (!Array.isArray(bullets)) return false
  const hint = target.bulletIndex ?? -1
  const index =
    hint >= 0 && hint < bullets.length && bullets[hint] === target.text
      ? hint
      : bullets.indexOf(target.text)
  if (index === -1) return false
  const next = [...(bullets as unknown[])]
  next[index] = suggested
  item.content = { ...item.content, bullets: next }
  return true
}

// ─── Report shapes ──────────────────────────────────────────────────────────

type CategoryKey = keyof ATSAnalysisResult["scores"]

const CATEGORIES: CategoryKey[] = [
  "keywords",
  "impact",
  "formatting",
  "completeness",
  "readability",
]

interface ScenarioReport {
  name: string
  targetRole: string
  baseline: {
    overallScore: number
    scores: ATSAnalysisResult["scores"]
    issueCount: number
    missingKeywordCount: number
    missingKeywords: string[]
  }
  iterations: IterationReport[]
}

interface IterationReport {
  iteration: number
  suggestionsReturned: number
  suggestionsUsable: number
  suggestionsApplied: number
  overallScore: number
  scores: ATSAnalysisResult["scores"]
  issueCount: number
  missingKeywordCount: number
  appliedTargets: { targetId: string; field: string; before: string; after: string }[]
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

// ─── Main ───────────────────────────────────────────────────────────────────

/** Runs the full baseline → enhance → rescore loop for one persona. */
async function runScenario(scenario: Scenario, args: Args): Promise<ScenarioReport> {
  const sections = scenario.buildSections()

  // ── 1. Baseline analysis ──────────────────────────────────────────────────
  if (!args.json) console.log(`Analyzing baseline resume — ${scenario.name}…`)
  let analysis = await analyzeResumeATS(sections, {
    targetRole: scenario.targetRole,
    jobDescription: scenario.jobDescription,
    mode: "job-match" as const,
    userId: HARNESS_USER_ID,
  })

  const baseline = {
    overallScore: analysis.overallScore,
    scores: analysis.scores,
    issueCount: analysis.issues.length,
    missingKeywordCount: analysis.missingKeywords.length,
    missingKeywords: analysis.missingKeywords,
  }

  if (!args.json) {
    console.log(`  overall ${baseline.overallScore}`)
    console.log(
      `  ${CATEGORIES.map((c) => `${c} ${analysis.scores[c]}`).join("  ")}`
    )
    console.log(
      `  ${analysis.issues.length} issues, ${analysis.suggestions.length} suggestions, ${analysis.missingKeywords.length} missing keywords`
    )
    console.log("")
  }

  const iterations: IterationReport[] = []

  for (let i = 1; i <= args.iterations; i++) {
    // ── 2. Build the enhance input the way the server action does ───────────
    const targets = collectEnhanceTargets(sections)
    if (targets.length === 0) {
      throw new Error("No enhanceable targets in the sample resume")
    }

    const enhanceInput: ATSEnhanceInput = {
      userId: HARNESS_USER_ID,
      targets: targets.map((target) => ({
        targetId: target.targetId,
        field: target.field,
        text: target.text,
        label: target.label,
      })),
      issues: analysis.issues,
      suggestions: analysis.suggestions,
      groundedKeywords: groundKeywords(
        analysis.missingKeywords ?? [],
        serializeSections(sections)
      ),
      jobDescription: scenario.jobDescription,
      targetRole: scenario.targetRole,
      overallScore: analysis.overallScore,
      scores: analysis.scores,
    }

    if (!args.json) console.log(`Iteration ${i}: requesting enhance suggestions…`)
    const result = await generateATSEnhanceSuggestions(enhanceInput)

    // ── 3. Post-process + apply, same rules as the action and the store ─────
    const targetsById = new Map(targets.map((target) => [target.targetId, target]))
    const seen = new Set<string>()
    let usable = 0
    let applied = 0
    const appliedTargets: IterationReport["appliedTargets"] = []

    for (const candidate of result.suggestions) {
      const target = targetsById.get(candidate.targetId)
      if (!target) continue
      if (seen.has(candidate.targetId)) continue

      // Removal suggestions are an accept/reject UI affordance; this harness
      // measures the uplift from rewrites, so they are counted out here.
      if (candidate.action === "remove") continue

      let suggested = (candidate.suggested ?? "").trim()
      if (target.field === "bullet") suggested = suggested.replace(LEADING_GLYPHS, "")
      suggested = suggested.slice(0, MAX_SUGGESTED_LENGTH[target.field]).trim()
      if (!suggested) continue
      if (suggested === target.text) continue
      if (!candidate.reason.trim()) continue

      seen.add(candidate.targetId)
      usable++

      if (applySuggestion(sections, target, suggested)) {
        applied++
        appliedTargets.push({
          targetId: target.targetId,
          field: target.field,
          before: target.text,
          after: suggested,
        })
      }
    }

    if (!args.json) {
      console.log(
        `  ${result.suggestions.length} returned, ${usable} usable, ${applied} applied`
      )
      console.log("  Re-analyzing…")
    }

    // ── 4. Rescore ──────────────────────────────────────────────────────────
    analysis = await analyzeResumeATS(sections, {
      targetRole: scenario.targetRole,
      jobDescription: scenario.jobDescription,
      mode: "job-match" as const,
      userId: HARNESS_USER_ID,
    })

    iterations.push({
      iteration: i,
      suggestionsReturned: result.suggestions.length,
      suggestionsUsable: usable,
      suggestionsApplied: applied,
      overallScore: analysis.overallScore,
      scores: analysis.scores,
      issueCount: analysis.issues.length,
      missingKeywordCount: analysis.missingKeywords.length,
      appliedTargets,
    })

    if (!args.json) {
      console.log(
        `  overall ${analysis.overallScore} (${signed(analysis.overallScore - baseline.overallScore)} vs baseline)`
      )
      console.log("")
    }
  }

  return { name: scenario.name, targetRole: scenario.targetRole, baseline, iterations }
}

/** The per-persona RESULT block of the human-readable report. */
function printScenarioResult(report: ScenarioReport, args: Args) {
  const { baseline, iterations } = report
  const final = iterations[iterations.length - 1]
  const totalApplied = iterations.reduce((sum, it) => sum + it.suggestionsApplied, 0)
  const totalReturned = iterations.reduce((sum, it) => sum + it.suggestionsReturned, 0)

  console.log("─".repeat(60))
  console.log(`RESULT — ${report.name}`)
  console.log(
    `  overall  ${baseline.overallScore} → ${final.overallScore}  (${signed(final.overallScore - baseline.overallScore)})`
  )
  for (const category of CATEGORIES) {
    const before = baseline.scores[category]
    const after = final.scores[category]
    // Job-match runs always carry every sub-score; a quality analysis has no
    // keyword score, so there is nothing to diff.
    if (before === null || after === null) {
      console.log(`  ${category.padEnd(13)}n/a`)
      continue
    }
    console.log(
      `  ${category.padEnd(13)}${String(before).padStart(3)} → ${String(after).padStart(3)}  (${signed(after - before)})`
    )
  }
  console.log(
    `  issues   ${baseline.issueCount} → ${final.issueCount}   missing keywords ${baseline.missingKeywordCount} → ${final.missingKeywordCount}`
  )
  console.log(
    `  suggestions ${totalReturned} generated, ${totalApplied} applied across ${args.iterations} iteration(s)`
  )
  console.log("─".repeat(60))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const startedAt = Date.now()

  const config = await getEffectiveAiConfig()
  const callsPerScenario = 1 + args.iterations * 2
  if (!args.json) {
    console.log("ATS quality harness")
    console.log(
      `  provider=${config.provider} model=${config.model} source=${config.source}`
    )
    console.log(
      `  scenarios=${SCENARIOS.length} iterations=${args.iterations} (AI calls: ${SCENARIOS.length * callsPerScenario})`
    )
    console.log("")
  }

  const reports: ScenarioReport[] = []
  for (const scenario of SCENARIOS) {
    reports.push(await runScenario(scenario, args))
  }

  const elapsedMs = Date.now() - startedAt

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          config: {
            provider: config.provider,
            model: config.model,
            source: config.source,
          },
          scenarios: reports,
          elapsedMs,
          caveat:
            "LLM scoring is nondeterministic — this is a single sample, not a statistically meaningful measurement.",
        },
        null,
        2
      )
    )
    return
  }

  // ── 5. Report ─────────────────────────────────────────────────────────────
  for (const report of reports) printScenarioResult(report, args)

  console.log(`  elapsed ${(elapsedMs / 1000).toFixed(1)}s total`)
  console.log(
    "CAVEAT: LLM scoring is nondeterministic. This is a single sample — run it"
  )
  console.log(
    "several times before treating any delta as a real quality signal.")
}

main()
  .then(async () => {
    // getEffectiveAiConfig opens a Prisma pool; close it so the process exits.
    await prisma.$disconnect()
  })
  .catch(async (error: unknown) => {
    console.error("\n[ats-quality-harness] FAILED")
    if (error instanceof Error) {
      console.error(`  ${error.name}: ${error.message}`)
      if (error.cause) console.error("  cause:", error.cause)
      if (error.stack) console.error(error.stack)
    } else {
      console.error(error)
    }
    await prisma.$disconnect().catch(() => {})
    process.exitCode = 1
  })
