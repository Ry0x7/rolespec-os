/**
 * Probe: does LinkedIn assist invent facts about the person?
 *
 * Usage:
 *   npx tsx scripts/linkedin-grounding-probe.ts     # 1 real AI call
 *
 * LinkedIn assist is the one generator the evidence-grounding line does not
 * cover. It consumes no employer text, so there is no requirement list and a
 * keyword partition is the wrong mechanism; its risk is the other one — facts
 * invented about the PERSON. This sends a deliberately SPARSE profile (no
 * figures anywhere, a short skills list, two plainly-worded positions) and
 * prints, for each generated field, which figures / skills / positions are NOT
 * traceable to the source. Career-neutral on purpose: the same bet that only
 * paid out in software is what PP0.5 had to undo.
 *
 * The account is `GROUNDING_CHECK_USER_ID`, else `DEV_ADMIN_EMAIL`, else the
 * first ADMIN. One `ai_usage_events` row and that account's provider credit.
 */
import "dotenv/config"

import { prisma } from "@/shared/lib/prisma"
import { getEffectiveAiConfigForUser } from "@/shared/lib/ai-provider"
import { generateLinkedinSuggestions } from "@/features/linkedin/services/linkedin-assist"
import { classifyKeywordEvidence } from "@/shared/lib/evidence-grounding"

/**
 * Contains NO digits at all except the employment years, and no tool or
 * credential beyond the four in Skills. Anything numeric or skill-shaped in the
 * output that is not here was invented.
 */
const NURSE_PROFILE = `Maria Dela Cruz
Staff Nurse at Cebu General Hospital
Cebu City, Philippines

About
Staff nurse on a medical-surgical ward. I look after adult patients through
admission, treatment and discharge, and I help orient new nurses onto the floor.

Experience
Staff Nurse
Cebu General Hospital
2021 - Present
Care for adult inpatients on a medical-surgical ward. Take handover at the start
of each shift, give medications, and escalate to the resident on duty when a
patient deteriorates. Help orient newly hired nurses to ward routine.

Staff Nurse
Mactan District Hospital
2019 - 2021
Worked on a general ward looking after adult patients. Assisted with admissions
and discharges, and kept patient charts up to date.

Skills
Patient care, Medication administration, Wound care, Charting

Education
Bachelor of Science in Nursing
University of San Carlos
2019`

/**
 * The same shape in software, where the inventable surface is much larger:
 * tool versions, cluster sizes, request rates, team sizes. Deliberately names
 * only four technologies and no figure except the years.
 */
const TECH_PROFILE = `Ramon Villanueva
Backend Developer at Harborline Systems
Cebu City, Philippines

About
Backend developer working on internal web services. I build and maintain APIs
that other teams in the company consume, and I help keep them running.

Experience
Backend Developer
Harborline Systems
2021 - Present
Build and maintain internal REST services in Python. Review teammates' pull
requests, fix production issues when they come up, and write the deployment
notes for each release. Work with the data team on reporting queries.

Junior Developer
Sunbelt Retail
2019 - 2021
Wrote small internal tools and fixed bugs in an existing PHP application. Helped
migrate reporting queries onto a new database.

Skills
Python, REST APIs, SQL, Git

Education
Bachelor of Science in Information Technology
University of Cebu
2019`

const PERSONAS = { nurse: NURSE_PROFILE, tech: TECH_PROFILE } as const

const persona = (process.argv.find((a) => a.startsWith("--persona="))?.split("=")[1] ??
  "nurse") as keyof typeof PERSONAS

const PROFILE = PERSONAS[persona] ?? NURSE_PROFILE

function rule() {
  console.log("-".repeat(72))
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
  if (!admin) throw new Error("No account to run as. Set GROUNDING_CHECK_USER_ID.")
  return admin.id
}

/** Every distinct numeric token, normalized so "50+" and "50%" both read as 50. */
function figures(text: string): string[] {
  const found = text.match(/\d[\d,.]*/g) ?? []
  return [...new Set(found.map((f) => f.replace(/[,.]+$/, "")))]
}

function reportProse(label: string, text: string) {
  const invented = figures(text).filter((f) => !figures(PROFILE).includes(f))
  console.log(`\n[${label}]`)
  console.log(text)
  console.log(
    invented.length > 0
      ? `  !! FIGURES NOT IN SOURCE: ${invented.join(", ")}`
      : "  figures: none unsupported"
  )
}

async function main() {
  const userId = await resolveUserId()
  const config = await getEffectiveAiConfigForUser(userId)
  console.log(`persona=${persona} user=${userId} provider=${config.provider} model=${config.model}`)
  console.log(`source figures: ${figures(PROFILE).join(", ")}`)
  rule()

  const s = await generateLinkedinSuggestions(PROFILE, userId)

  reportProse("headline.suggested", s.headline.suggested)
  console.log(`  headline.current: ${JSON.stringify(s.headline.current)}`)
  reportProse("about.suggested", s.about.suggested)

  rule()
  for (const exp of s.experience) {
    const verdict = classifyKeywordEvidence(exp.position, PROFILE)
    console.log(`\n[experience] ${exp.position}  -> position ${verdict.verdict}`)
    for (const b of exp.suggestedBullets) reportProse("  bullet", b)
  }

  rule()
  console.log("\n[skillsToAdd]")
  for (const skill of s.skillsToAdd) {
    const v = classifyKeywordEvidence(skill, PROFILE)
    console.log(`  ${v.verdict === "supported" ? "ok  " : "!!  "} ${skill} — ${v.verdict}`)
  }

  rule()
  console.log("\n[quickWins]")
  for (const q of s.quickWins) reportProse("  win", q)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
