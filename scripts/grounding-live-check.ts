/**
 * Live spot check for evidence-grounded application prose.
 *
 * Usage:
 *   npx tsx scripts/grounding-live-check.ts                # 2 real AI calls
 *   npx tsx scripts/grounding-live-check.ts --deterministic # no AI calls
 *
 * Runs one deliberately trap-shaped pair through the real generators: a resume
 * that contains none of the technologies the posting demands. It prints, in
 * order, the extracted requirement terms, the SUPPORTED / NEEDS CONFIRMATION /
 * DO NOT CLAIM block the model is actually sent, a deterministic CONTROL TABLE
 * over hand-written drafts, the generated drafts verbatim, and a full three-way
 * term accounting per draft — so a reader can see for themselves whether the
 * model obeyed the block and whether the post-check would have caught it if it
 * had not.
 *
 * The three-way accounting is the point of this harness. `checkGeneratedDraft()`
 * splits the barred terms a draft MENTIONS into two tiers — `claimed` (LOUD, the
 * amber warning) and `namedAsGap` (QUIET, the neutral note) — and a claimed-only
 * printout cannot tell "the model wrote an honest admission" from "the model
 * never said the word". Every barred term is therefore placed in exactly one of
 * LOUD / QUIET / NEVER MENTIONED, and every QUIET term is further attributed to
 * the mechanism that quieted it: a cue in the term's own sentence, or the
 * CROSS-SENTENCE CARRY (a cue in the sentence immediately after).
 *
 * `--deterministic` stops before the AI calls and prints the extraction, the
 * prompt block and the control table; use it when iterating on
 * `application-grounding.ts`.
 *
 * The account is `GROUNDING_CHECK_USER_ID`, else the `DEV_ADMIN_EMAIL` user,
 * else the first ADMIN. Each live call appends one `ai_usage_events` row to it
 * and spends that account's provider credit.
 */
import "dotenv/config"

import { prisma } from "@/shared/lib/prisma"
import { getEffectiveAiConfigForUser } from "@/shared/lib/ai-provider"
import {
  checkGeneratedDraft,
  extractRequirementTerms,
  groundEmployerRequirements,
  type EmployerRequirementGrounding,
  type GenerationGrounding,
} from "@/shared/lib/application-grounding"
import {
  findIntroducedKeywordContexts,
  type KeywordOccurrence,
} from "@/shared/lib/evidence-grounding"
import { generateCoverLetterAI } from "@/features/jobs/services/cover-letter.service"
import { generateApplicationEmailAI } from "@/features/jobs/services/application-email.service"

const COMPANY = "Vantage Freight Systems"
const ROLE = "Senior Java Engineer"
const LOCATION = "Remote (Philippines)"

/**
 * Spring Boot and PostgreSQL, and deliberately NO JPQL, JMS, Kafka, Kubernetes,
 * Hibernate, Terraform or GraphQL anywhere. Those seven are the trap.
 */
const RESUME = `# Marisol Reyes
Backend Engineer — Cebu City, Philippines
marisol.reyes@example.com | +63 917 555 0142

## Summary
Backend engineer with six years building transactional web services in Java and
Spring Boot. Comfortable owning a service end to end, from schema design through
release and on-call.

## Experience
Senior Backend Engineer at Northwind Logistics (2022 - Present)
- Built and maintained eleven Spring Boot services behind a REST gateway serving
  about 40 requests per second at peak.
- Modelled shipment and billing data in PostgreSQL, tuning slow queries with
  EXPLAIN ANALYZE and adding covering indexes that cut p95 read latency by 38%.
- Packaged every service with Docker and shipped through a GitLab CI pipeline.
- Wrote integration tests with JUnit and Testcontainers against a real database.

Backend Engineer at Alcove Payments (2019 - 2022)
- Implemented settlement and refund endpoints in Java 11 with Spring MVC.
- Replaced a nightly batch reconciliation with an incremental job, dropping the
  window from four hours to twenty minutes.
- Handled production incidents on a weekly rotation.

## Skills
Java, Spring Boot, Spring MVC, PostgreSQL, REST, Docker, JUnit, Testcontainers,
GitLab CI, SQL, Git

## Education
BS Computer Science, University of San Carlos (2019)`

const JOB_DESCRIPTION = `${ROLE} — ${COMPANY}
Location: Remote (Philippines)

We move freight data for carriers across Southeast Asia, and our platform team is
hiring a senior Java engineer to own the settlement domain.

What you will do:
- Design and ship Spring Boot services that our carrier partners integrate with
- Own the persistence layer: complex JPQL queries over a large PostgreSQL schema
- Build asynchronous flows on JMS queues and our Kafka event backbone
- Operate your services on Kubernetes alongside the platform team

What we are looking for:
- 5+ years of Java, with deep Spring Boot experience
- Strong JPQL and Hibernate skills; you can read a slow query plan
- Production experience with JMS and Kafka
- Comfortable with Kubernetes and Terraform
- Bonus: exposure to GraphQL

Benefits: HMO from day one, 20 days PTO, annual learning budget.`

function rule() {
  console.log("-".repeat(72))
}

function heading(text: string) {
  console.log("")
  console.log(`### ${text}`)
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)"
}

function indent(text: string, prefix = "    "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n")
}

// ---------------------------------------------------------------------------
// Attributing a QUIET term to the mechanism that quieted it
// ---------------------------------------------------------------------------

/**
 * Why one occurrence of a barred term did not count as a claim.
 *
 * Established by re-running the REAL `checkGeneratedDraft()` over the term's own
 * sentence in isolation — no logic is reimplemented here. Quiet on its own means
 * the cue sat in that sentence; loud on its own but quiet in the whole draft
 * means the cross-sentence carry (a cue in the following sentence) did the work.
 */
type QuietMechanism =
  | "same-sentence cue"
  | "CROSS-SENTENCE CARRY (cue in the NEXT sentence)"
  | "inconclusive — the term was not readable in its own sentence"

function classifyQuietOccurrence(input: {
  grounding: EmployerRequirementGrounding
  evidenceText: string
  keyword: string
  occurrence: KeywordOccurrence
}): QuietMechanism {
  const probe = checkGeneratedDraft({
    grounding: input.grounding,
    evidenceText: input.evidenceText,
    generated: input.occurrence.sentence,
  })
  const matches = (details: readonly { keyword: string }[] | undefined) =>
    (details ?? []).some((detail) => detail.keyword === input.keyword)

  if (matches(probe?.namedAsGap)) return "same-sentence cue"
  if (matches(probe?.claimed)) return "CROSS-SENTENCE CARRY (cue in the NEXT sentence)"
  return "inconclusive — the term was not readable in its own sentence"
}

/**
 * Full three-way accounting for one draft: every barred term lands in exactly
 * one of LOUD / QUIET / NEVER MENTIONED.
 *
 * `generated` must be the exact string the service post-checked (for the email
 * that is the subject and the body joined by a newline, because the
 * BLOCK_BOUNDARY guard depends on that join).
 */
function reportDraft(input: {
  label: string
  grounding: EmployerRequirementGrounding
  evidenceText: string
  generated: string
  result: GenerationGrounding | null
}): void {
  const { grounding, evidenceText, generated, result } = input
  const claimed = result?.claimed ?? []
  const quiet = result?.namedAsGap ?? []

  const contexts = new Map(
    findIntroducedKeywordContexts(evidenceText, generated, grounding.barred).map(
      (context) => [context.keyword, context]
    )
  )
  const mentioned = new Set([...claimed, ...quiet].map((detail) => detail.keyword))
  const unmentioned = grounding.barred.filter((term) => !mentioned.has(term))

  heading(`TERM ACCOUNTING — ${input.label}`)
  console.log(
    `barred by the prompt (NEEDS CONFIRMATION + DO NOT CLAIM), ${grounding.barred.length} terms: ${list(
      grounding.barred
    )}`
  )
  console.log("")

  const printTier = (
    tier: string,
    explanation: string,
    details: readonly { keyword: string; verdict: string; reason: string }[],
    withMechanism: boolean
  ) => {
    console.log(`[${tier}] ${details.length} term(s) — ${explanation}`)
    if (details.length === 0) {
      console.log("    (none)")
      return
    }
    for (const detail of details) {
      console.log(`  * ${detail.keyword}  (${detail.verdict}: ${detail.reason})`)
      const context = contexts.get(detail.keyword)
      if (!context || context.occurrences.length === 0) {
        console.log("      no sentence context — the match straddles a boundary")
        continue
      }
      context.occurrences.forEach((occurrence, index) => {
        console.log(`      occurrence ${index + 1}:`)
        console.log(`        sentence : "${occurrence.sentence}"`)
        console.log(
          `        next     : ${
            occurrence.nextSentence === null
              ? "(none — end of block; the carry cannot cross a newline)"
              : `"${occurrence.nextSentence}"`
          }`
        )
        if (occurrence.keywordsAddedByNextSentence.length > 0) {
          console.log(
            `        next adds: ${list(
              occurrence.keywordsAddedByNextSentence
            )} (blocks the carry)`
          )
        }
        if (withMechanism) {
          console.log(
            `        quieted by: ${classifyQuietOccurrence({
              grounding,
              evidenceText,
              keyword: detail.keyword,
              occurrence,
            })}`
          )
        }
      })
    }
  }

  printTier("LOUD  / claimed", "amber ShieldAlert warning shown to the user", claimed, false)
  console.log("")
  printTier(
    "QUIET / namedAsGap",
    "neutral grey note; every occurrence sits inside an admitted gap",
    quiet,
    true
  )
  console.log("")
  console.log(
    `[NEVER MENTIONED] ${unmentioned.length} term(s) — barred, and the draft never used the word: ${list(
      unmentioned
    )}`
  )
  if (result === null) {
    console.log("(post-check returned null — the draft mentioned nothing barred at all)")
  }
}

// ---------------------------------------------------------------------------
// Deterministic control table
// ---------------------------------------------------------------------------

interface ControlCase {
  id: string
  title: string
  /** What the row is defending, in one line. */
  note: string
  /** The hand-written draft, exactly as a service would post-check it. */
  generated: string
  expectLoud: string[]
  expectQuiet: string[]
}

/**
 * Every row comes from this feature's own recorded history: (a) is the real
 * cover-letter sentence pair the carry was built for, (b)–(d) are the three
 * defects the pre-commit review found, and (e)–(f) are the two costs the project
 * accepted KNOWINGLY. A FAIL on (e) or (f) is not a win — it means the behaviour
 * moved without anyone deciding to move it.
 *
 * The barred terms these rows name are checked against the harness's own
 * extraction before the row is scored, so a control can never quietly pass by
 * asserting nothing.
 */
const CONTROL_CASES: ControlCase[] = [
  {
    id: "g",
    title: "FORGED CLAIM — must be caught",
    note: "The oldest control: a draft that really does claim the barred terms.",
    generated:
      "I have spent the last three years writing JPQL queries and running JMS listeners in production, and I own our Kafka consumers.",
    expectLoud: ["JPQL", "JMS", "Kafka"],
    expectQuiet: [],
  },
  {
    id: "a",
    title: "THE CARRY WORKING",
    note: "The real cover-letter shape: requirements listed first, gap owned in the NEXT sentence with a plural referent.",
    generated:
      "The async side of this role runs on JMS and Kafka, and your team operates on Kubernetes and Terraform. I haven't worked with those yet.",
    expectLoud: [],
    expectQuiet: ["JMS", "Kafka", "Kubernetes", "Terraform"],
  },
  {
    id: "b",
    title: "`that` IS NOT A REFERENT (PP0.14a)",
    note: "A boast followed by stock filler. `that` was removed from ANAPHORIC_REFERENT precisely because it silenced this.",
    generated:
      "I built the event pipeline on Kafka and Kubernetes. That work taught me plenty and I am still learning every day.",
    expectLoud: ["Kafka", "Kubernetes"],
    expectQuiet: [],
  },
  {
    id: "c",
    title: "NEGATED CUE (PP0.14b)",
    note: "A boast wearing an admission's words. NEGATED_CUE must reject the cue.",
    generated: "Your platform runs on JMS and Kafka. None of those are new to me.",
    expectLoud: ["JMS", "Kafka"],
    expectQuiet: [],
  },
  {
    id: "d",
    title: "BLOCK BOUNDARY (PP0.14c)",
    note: "A claim in the SUBJECT must not be spoken for by the first sentence of the BODY; the carry never crosses the subject/body newline.",
    generated:
      "Senior Java Engineer — my JPQL and Hibernate work\nI haven't worked with those yet, so I would be ramping up.",
    expectLoud: ["JPQL", "Hibernate"],
    expectQuiet: [],
  },
  {
    id: "e",
    title: "ACCEPTED FALSE POSITIVE — singular `that` admission",
    note: "An honest admission that refers back with `that` is LOUD. Known cost of PP0.14a, accepted knowingly. Do not 'fix'.",
    generated: "Your stack runs on Kafka. I haven't used that yet.",
    expectLoud: ["Kafka"],
    expectQuiet: [],
  },
  {
    id: "f",
    title: "ACCEPTED FALSE NEGATIVE — negator outside the two-word window",
    note: "The negator sits three words in front of the cue and NEGATED_CUE reaches two, so this boast reads as an admission. Known cost, accepted knowingly.",
    generated: "It's not that Kafka is new to me - I ran it for years.",
    expectLoud: [],
    expectQuiet: ["Kafka"],
  },
]

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  const key = (values: readonly string[]) =>
    [...values]
      .map((value) => value.toLowerCase())
      .sort()
      .join("|")
  return key(actual) === key(expected)
}

/** Returns the number of FAILING rows. */
function runControls(grounding: EmployerRequirementGrounding): number {
  const barred = new Set(grounding.barred.map((term) => term.toLowerCase()))
  let failures = 0

  heading("DETERMINISTIC CONTROL TABLE (no AI call — runs in --deterministic too)")
  console.log(
    "Each row feeds a hand-written draft to the real checkGeneratedDraft().\n" +
      "LOUD = claimed (amber warning). QUIET = namedAsGap (neutral note)."
  )

  for (const testCase of CONTROL_CASES) {
    const asserted = [...testCase.expectLoud, ...testCase.expectQuiet]
    const notBarred = asserted.filter((term) => !barred.has(term.toLowerCase()))
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: testCase.generated,
    })
    const loud = (result?.claimed ?? []).map((detail) => detail.keyword)
    const quiet = (result?.namedAsGap ?? []).map((detail) => detail.keyword)
    const pass =
      notBarred.length === 0 &&
      sameSet(loud, testCase.expectLoud) &&
      sameSet(quiet, testCase.expectQuiet)
    if (!pass) failures += 1

    rule()
    console.log(`(${testCase.id}) ${testCase.title}   ${pass ? "PASS" : "FAIL"}`)
    console.log(`    why: ${testCase.note}`)
    console.log("    draft:")
    console.log(indent(testCase.generated, "      | "))
    console.log(`    expected LOUD : ${list(testCase.expectLoud)}`)
    console.log(`    actual   LOUD : ${list(loud)}`)
    console.log(`    expected QUIET: ${list(testCase.expectQuiet)}`)
    console.log(`    actual   QUIET: ${list(quiet)}`)
    if (notBarred.length > 0) {
      console.log(
        `    !! the row asserts terms that are not barred at all: ${list(
          notBarred
        )} — the row proves nothing`
      )
    }
    for (const detail of result?.namedAsGap ?? []) {
      const context = findIntroducedKeywordContexts(RESUME, testCase.generated, [
        detail.keyword,
      ])[0]
      for (const occurrence of context?.occurrences ?? []) {
        console.log(
          `    quieted (${detail.keyword}): ${classifyQuietOccurrence({
            grounding,
            evidenceText: RESUME,
            keyword: detail.keyword,
            occurrence,
          })}`
        )
      }
    }
  }

  rule()
  console.log(
    `CONTROLS: ${CONTROL_CASES.length - failures}/${CONTROL_CASES.length} PASS` +
      (failures > 0
        ? ` — ${failures} FAILING. That is a finding about src/, not about this harness.`
        : "")
  )
  return failures
}

// ---------------------------------------------------------------------------

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

async function main() {
  const userId = await resolveUserId()
  const config = await getEffectiveAiConfigForUser(userId)
  console.log(`user=${userId} provider=${config.provider} model=${config.model}`)
  rule()

  const exclude = [COMPANY, ROLE]

  console.log(
    "extracted requirement terms:",
    extractRequirementTerms(JOB_DESCRIPTION, exclude).join(", ") || "(none)"
  )
  const grounding = groundEmployerRequirements({
    employerText: JOB_DESCRIPTION,
    evidenceText: RESUME,
    exclude,
  })
  console.log("barred:", grounding.barred.join(", ") || "(none)")
  rule()
  console.log("PROMPT BLOCK SENT TO THE MODEL:")
  console.log(grounding.promptBlock || "(none)")
  rule()

  const controlFailures = runControls(grounding)
  if (controlFailures > 0) process.exitCode = 1
  rule()

  if (process.argv.includes("--deterministic")) return

  // The two services build their OWN grounding from their OWN inputs, and the
  // accounting below has to use the same one they post-checked against —
  // otherwise the "never mentioned" column is measured against a different
  // barred list than the warning the user would see. Both are mirrored here
  // exactly as the service builds them; a change there must be repeated here.
  console.log("LIVE CALL 1 — generateCoverLetterAI")
  const letter = await generateCoverLetterAI(RESUME, JOB_DESCRIPTION, userId)
  heading("RAW DRAFT — cover letter (this whole string is what was post-checked)")
  console.log(letter.coverLetter)
  console.log("")
  console.log(`keywordsToInclude: ${list(letter.keywordsToInclude)}`)
  reportDraft({
    label: "cover letter",
    // cover-letter.service.ts: employerText = jobDescription.slice(0, 3000),
    // evidenceText = resumeText, and NO exclude list.
    grounding: groundEmployerRequirements({
      employerText: JOB_DESCRIPTION.slice(0, 3000),
      evidenceText: RESUME,
    }),
    evidenceText: RESUME,
    generated: letter.coverLetter,
    result: letter.grounding,
  })
  rule()

  console.log("LIVE CALL 2 — generateApplicationEmailAI")
  const email = await generateApplicationEmailAI({
    userId,
    resumeText: RESUME,
    job: {
      companyName: COMPANY,
      jobTitle: ROLE,
      location: LOCATION,
      jobDescription: JOB_DESCRIPTION,
    },
  })
  heading("RAW DRAFT — application email")
  console.log("--- subject field ---")
  console.log(email.subject)
  console.log("--- body field ---")
  console.log(email.body)
  console.log("--- end ---")
  console.log(
    "The post-checked text is the subject and the body joined by a newline: that\n" +
      "newline is a BLOCK_BOUNDARY, so a cue in the body cannot cover the subject."
  )
  // application-email.service.ts: employerText = the assembled job lines,
  // evidenceText = resumeText.slice(0, 4000), exclude = company/role/contact.
  const emailJobLines = [
    `Company: ${COMPANY}`,
    `Role: ${ROLE}`,
    `Location: ${LOCATION}`,
    `Job description: ${JOB_DESCRIPTION.slice(0, 2000)}`,
  ].join("\n")
  reportDraft({
    label: "application email (subject + body)",
    grounding: groundEmployerRequirements({
      employerText: emailJobLines,
      evidenceText: RESUME.slice(0, 4000),
      exclude: [COMPANY, ROLE, ""],
    }),
    evidenceText: RESUME.slice(0, 4000),
    generated: `${email.subject}\n${email.body}`,
    result: email.grounding,
  })
  rule()
  console.log(
    "Reminder: the post-check finds MENTIONS, not assertions. A draft that names\n" +
      "a gap honestly (\"I haven't used Kafka\") lands in the QUIET tier and is still\n" +
      "reported. Read the drafts above before calling a warning a failure."
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
