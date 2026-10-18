/**
 * Live spot check for the candidate's name in generated prose.
 *
 * Usage:
 *   npx tsx scripts/candidate-name-live-check.ts                 # 4 real AI calls
 *   npx tsx scripts/candidate-name-live-check.ts --deterministic # no AI calls
 *
 * Sibling of `grounding-live-check.ts`, and deliberately shaped differently from
 * it: that harness hands the generators a resume STRING whose first line is the
 * candidate's name, which is not the shape the app produces. The app builds
 * structured sections and runs them through `serializeResumeForCoverLetter()`,
 * which has no CONTACT case — so the real prompt never contained the name at all
 * and the model invented one (observed: a former employer, and a job title).
 *
 * This script therefore starts from `Section[]` with the name ONLY in the
 * contact item's `fullName`, then makes the same two calls the cover-letter
 * action makes — serialize for the prose, resolve the name separately — so the
 * name reaches the model exclusively through the new trusted parameter.
 *
 * Only the SUBJECT LINE and the last few lines are checked. The employer name
 * appears legitimately in a correct body (it is the candidate's own former
 * workplace), so scanning the whole draft for a wrong name reports false
 * failures.
 *
 * The account is `GROUNDING_CHECK_USER_ID`, else the `DEV_ADMIN_EMAIL` user,
 * else the first ADMIN. Each live call appends one `ai_usage_events` row to it
 * and spends that account's provider credit.
 */
import "dotenv/config"

import { prisma } from "@/shared/lib/prisma"
import { getEffectiveAiConfigForUser } from "@/shared/lib/ai-provider"
import { serializeResumeForCoverLetter } from "@/features/jobs/services/cover-letter.service"
import { resolveCandidateName } from "@/features/jobs/services/resume-text.service"
import {
  checkDraftSignature,
  checkSubjectNameSlot,
  signatureSlot,
} from "@/shared/lib/prompts/signature-check"
// The product filter. Printing only the raw check would make a finding the user
// never sees look identical to one they are warned about — which is the exact
// confusion this module exists to settle, so the harness reports both halves.
import { userFacingSignature } from "@/shared/lib/prompts/signature-visibility"
import { generateApplicationEmailAI } from "@/features/jobs/services/application-email.service"
import { generateColdEmailAI } from "@/features/jobs/services/cold-email.service"
import { generateReplyEmailAI } from "@/features/jobs/services/reply-email.service"
import type { Section } from "@/features/resume/hooks/use-resume-store"

const CANDIDATE_NAME = "Marisol Reyes"
const FORMER_EMPLOYER = "Northwind Logistics"
const COMPANY = "Vantage Freight Systems"
const ROLE = "Senior Java Engineer"

/**
 * The name lives in the contact item and nowhere else — no summary line, no
 * bullet. That is the shape the editor actually stores.
 */
function buildSections(options: { withName: boolean }): Section[] {
  const sections: Array<Record<string, unknown>> = [
    {
      id: "s0",
      resumeId: "r0",
      type: "CONTACT",
      title: "Contact",
      order: 0,
      visible: true,
      items: [
        {
          id: "i0",
          sectionId: "s0",
          order: 0,
          content: {
            fullName: options.withName ? CANDIDATE_NAME : "",
            email: "marisol.reyes@example.com",
            phone: "+63 917 555 0142",
            location: "Cebu City, Philippines",
          },
        },
      ],
    },
    {
      id: "s1",
      resumeId: "r0",
      type: "SUMMARY",
      title: "Summary",
      order: 1,
      visible: true,
      items: [
        {
          id: "i1",
          sectionId: "s1",
          order: 0,
          content: {
            text: "Backend engineer with six years building transactional web services in Java and Spring Boot. Comfortable owning a service end to end, from schema design through release and on-call.",
          },
        },
      ],
    },
    {
      id: "s2",
      resumeId: "r0",
      type: "EXPERIENCE",
      title: "Experience",
      order: 2,
      visible: true,
      items: [
        {
          id: "i2",
          sectionId: "s2",
          order: 0,
          content: {
            role: "Senior Backend Engineer",
            company: FORMER_EMPLOYER,
            startDate: "2022",
            current: true,
            bullets: [
              "Built and maintained eleven Spring Boot services behind a REST gateway serving about 40 requests per second at peak.",
              "Modelled shipment and billing data in PostgreSQL, tuning slow queries with EXPLAIN ANALYZE and adding covering indexes that cut p95 read latency by 38%.",
              "Packaged every service with Docker and shipped through a GitLab CI pipeline.",
            ],
          },
        },
        {
          id: "i3",
          sectionId: "s2",
          order: 1,
          content: {
            role: "Backend Engineer",
            company: "Alcove Payments",
            startDate: "2019",
            endDate: "2022",
            bullets: [
              "Implemented settlement and refund endpoints in Java 11 with Spring MVC.",
              "Replaced a nightly batch reconciliation with an incremental job, dropping the window from four hours to twenty minutes.",
            ],
          },
        },
      ],
    },
    {
      id: "s3",
      resumeId: "r0",
      type: "SKILLS",
      title: "Skills",
      order: 3,
      visible: true,
      items: [
        {
          id: "i4",
          sectionId: "s3",
          order: 0,
          content: {
            category: "Backend",
            skills: ["Java", "Spring Boot", "PostgreSQL", "REST", "Docker", "JUnit"],
          },
        },
      ],
    },
  ]
  return sections as unknown as Section[]
}

const JOB_DESCRIPTION = `${ROLE} — ${COMPANY}
Location: Remote (Philippines)

What you will do:
- Design and ship Spring Boot services that our carrier partners integrate with
- Own the persistence layer over a large PostgreSQL schema

What we are looking for:
- 5+ years of Java, with deep Spring Boot experience
- Comfortable operating your own services`

function rule() {
  console.log("-".repeat(72))
}

/**
 * Names that must never appear where the candidate's own name belongs. The
 * employer and the role are NOT in this list for the subject line — a subject
 * legitimately names the role, and the body legitimately names the candidate's
 * former workplace. They are only wrong inside the signature.
 */
const WRONG_PERSON_NAMES = ["Sam Ortiz", "Sam", "Alex", "Jo Cruz"]
const WRONG_IN_SIGNATURE = [...WRONG_PERSON_NAMES, FORMER_EMPLOYER, "Alcove Payments", ROLE]

function verdict(options: {
  label: string
  subject: string
  body: string
  expectNameInSubject: boolean
  expectNameInSignature: boolean
  /**
   * Whether this generator's subject has a name slot at all. True for the
   * application email alone — the cold-email prompt bars the name from the
   * subject and a reply subject is the sender's own "Re: …", so on those two
   * `checkSubjectNameSlot` is deliberately never run, exactly as in the
   * services. `subjectCandidateName` is whatever was passed to the generator.
   */
  checkSubject?: boolean
  subjectCandidateName?: string | null
  /**
   * Exactly what was handed to the generator as `candidateName`, printed so the
   * reader can tell a nameless call apart from a named one without inferring it
   * from the label.
   */
  generatorCandidateName?: string | null
}) {
  const { label, subject, body, expectNameInSubject, expectNameInSignature } = options
  // The slot parsing this harness used to do itself now lives in
  // `src/shared/lib/prompts/signature-check.ts`, so the live run and the
  // services in production read a draft exactly the same way.
  const signatureLines = signatureSlot(body)
  const signature = signatureLines.join(" / ")

  const wrongInSubject = WRONG_PERSON_NAMES.filter((n) => subject.includes(n))
  const wrongInSignature = WRONG_IN_SIGNATURE.filter((n) => signature.includes(n))
  const nameInSubject = subject.includes(CANDIDATE_NAME)
  const nameInSignature = signature.includes(CANDIDATE_NAME)

  const problems: string[] = []
  if (expectNameInSubject && !nameInSubject) problems.push("subject is missing the real name")
  if (!expectNameInSubject && nameInSubject) problems.push("subject carries a name it should not")
  if (expectNameInSignature && !nameInSignature) problems.push("signature is missing the real name")
  if (!expectNameInSignature && nameInSignature)
    problems.push("signature carries a name it should not")
  if (wrongInSubject.length) problems.push(`wrong name in subject: ${wrongInSubject.join(", ")}`)
  if (wrongInSignature.length)
    problems.push(`wrong name in signature: ${wrongInSignature.join(", ")}`)

  // The deterministic post-check that now runs inside every email service. It is
  // reported next to this harness's own fixture-specific verdict rather than
  // replacing it: the list above knows which wrong names to expect here, the
  // check knows only whether the real name is where it belongs.
  const check = checkDraftSignature({
    candidateName: expectNameInSignature ? CANDIDATE_NAME : null,
    body,
  })
  if (check) problems.push(`checkDraftSignature: ${check.issue}`)

  // The subject half of the same idea, imported from the same module for the
  // same reason: the harness and `application-email.service.ts` must read a
  // subject identically, or the live run stops proving anything about the
  // service.
  const subjectCheck = options.checkSubject
    ? checkSubjectNameSlot({
        candidateName: options.subjectCandidateName ?? null,
        subject,
      })
    : null
  if (subjectCheck) problems.push(`checkSubjectNameSlot: ${subjectCheck.issue}`)

  // What the product filter would let through. `null` here with a non-null
  // `check` above is the suppressed case — a finding that exists only in the
  // service's logger.warn.
  const visible = userFacingSignature(check)

  const rawSignatureVerdict = check
    ? `${check.issue} (offending: ${
        check.offending.length ? check.offending.map((l) => `"${l}"`).join(" / ") : "nothing signed"
      })`
    : expectNameInSignature
      ? "clean — the real name is in the sign-off slot"
      : "clean — no name was available and the draft signed none"

  console.log(`[${label}]`)
  console.log(
    `  candidate name passed to generator: ${JSON.stringify(
      options.generatorCandidateName ?? null
    )}`
  )
  console.log(`  SUBJECT (verbatim):          ${subject || "(none)"}`)
  console.log(`  SIGNATURE SLOT (verbatim):${signatureLines.length ? "" : "   (empty)"}`)
  for (const line of signatureLines) console.log(`    | ${line}`)
  console.log(`  signature check (raw):       ${rawSignatureVerdict}`)
  console.log(
    `  subject check (raw):         ${
      options.checkSubject
        ? subjectCheck
          ? `${subjectCheck.issue} (offending: "${subjectCheck.offending}")`
          : options.subjectCandidateName
            ? "clean — the real name is present in the subject"
            : "clean — no name was available, so the check is silent by design"
        : "not checked — this surface deliberately has no subject name slot"
    }`
  )
  console.log(
    `  WHAT THE USER SEES:          ${
      visible
        ? `SignatureNotice WARNING — ${visible.issue} (offending: ${
            visible.offending.map((l) => `"${l}"`).join(" / ") || "nothing signed"
          })`
        : check
          ? `nothing — SUPPRESSED (LOG ONLY): ${check.issue}`
          : "nothing — no signature finding to show"
    }`
  )
  if (options.checkSubject) {
    console.log(
      `  ...and for the subject:      ${
        subjectCheck
          ? `SignatureNotice WARNING — subject name slot ("${subjectCheck.offending}")`
          : "nothing — subject name slot is clean"
      }`
    )
  }
  console.log(
    `  fixture verdict:             ${problems.length === 0 ? "PASS" : `FAIL — ${problems.join("; ")}`}`
  )
  return { label, ok: problems.length === 0 }
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

async function main() {
  const userId = await resolveUserId()
  const config = await getEffectiveAiConfigForUser(userId)
  console.log(`user=${userId} provider=${config.provider} model=${config.model}`)
  rule()

  const named = buildSections({ withName: true })
  const anonymous = buildSections({ withName: false })

  const resumeText = serializeResumeForCoverLetter(named)
  const candidateName = await resolveCandidateName(userId, named)

  console.log("BEFORE-EVIDENCE — the resume text every prose generator receives:")
  console.log(resumeText)
  rule()
  console.log(`resumeText contains "${CANDIDATE_NAME}": ${resumeText.includes(CANDIDATE_NAME)}`)
  console.log(`resolveCandidateName() -> ${JSON.stringify(candidateName)}`)
  rule()

  // The subject-line post-check, exercised with no AI call at all. Only the
  // application email has a name slot in its subject, so these are the shapes
  // that surface reads — including the two failures actually observed.
  console.log("checkSubjectNameSlot — application-email subject shapes:")
  const subjectShapes: Array<{ subject: string; note: string }> = [
    {
      subject: `Application for ${ROLE} — ${CANDIDATE_NAME}`,
      note: "correct subject — must stay silent",
    },
    {
      subject: `Application for ${ROLE} — ${FORMER_EMPLOYER}`,
      note: "OBSERVED FAILURE: former employer in the name slot — must fire",
    },
    {
      subject: "Application for Staff Nurse — cebu nurse",
      note: "OBSERVED FAILURE: job description in the name slot — must fire",
    },
    {
      subject: `Application for ${ROLE}`,
      note: "no delimiter, name half dropped — refused structurally, must stay silent",
    },
    {
      subject: "Application for Senior Engineer — Platform",
      note: "ACCEPTED FALSE POSITIVE: the ROLE TITLE carries its own dash, so the slot parse reads 'Platform' as the name. Documented and accepted, not a new bug.",
    },
    {
      subject: `Application for ${ROLE} — ${CANDIDATE_NAME.split(" ")[0]}`,
      note: "ACCEPTED FALSE POSITIVE: signed with the FIRST NAME ONLY. The subject match is deliberately stricter than the sign-off check — accepting a bare first name would wave through the original invented \"Alex\".",
    },
  ]
  for (const { subject, note } of subjectShapes) {
    const found = checkSubjectNameSlot({ candidateName, subject })
    console.log(`  ${found ? `FIRES  ${found.issue} ("${found.offending}")` : "silent"}`)
    console.log(`         subject: ${subject}`)
    console.log(`         expected: ${note}`)
  }
  rule()

  if (process.argv.includes("--deterministic")) return

  const job = {
    companyName: COMPANY,
    jobTitle: ROLE,
    location: "Remote (Philippines)",
    jobDescription: JOB_DESCRIPTION,
  }

  const results: Array<{ label: string; ok: boolean }> = []

  console.log("LIVE CALL 1 — generateApplicationEmailAI, name available")
  const email = await generateApplicationEmailAI({
    userId,
    resumeText,
    candidateName,
    job,
  })
  console.log(email.body)
  results.push(
    verdict({
      label: "application/named",
      subject: email.subject,
      body: email.body,
      // The application email is the one generator whose subject may carry the name.
      expectNameInSubject: true,
      expectNameInSignature: true,
      checkSubject: true,
      subjectCandidateName: candidateName,
      generatorCandidateName: candidateName,
    })
  )
  rule()

  console.log("LIVE CALL 2 — generateApplicationEmailAI, NO name anywhere")
  const anonText = serializeResumeForCoverLetter(anonymous)
  const anonEmail = await generateApplicationEmailAI({
    userId,
    resumeText: anonText,
    candidateName: null,
    job,
  })
  console.log(anonEmail.body)
  results.push(
    verdict({
      label: "application/no-name",
      subject: anonEmail.subject,
      body: anonEmail.body,
      expectNameInSubject: false,
      expectNameInSignature: false,
      // Still the application-email surface, so the check still runs — with no
      // name it stays silent, which is the point of the nameless branch.
      checkSubject: true,
      subjectCandidateName: null,
      generatorCandidateName: null,
    })
  )
  rule()

  console.log("LIVE CALL 3 — generateColdEmailAI, name available")
  const cold = await generateColdEmailAI({
    userId,
    resumeText,
    candidateName,
    job: { companyName: COMPANY, jobTitle: ROLE, location: "Remote (Philippines)" },
  })
  console.log(cold.body)
  results.push(
    verdict({
      label: "cold/named",
      subject: cold.subject,
      body: cold.body,
      // The cold-email prompt bars the name from the subject on purpose.
      expectNameInSubject: false,
      expectNameInSignature: true,
      generatorCandidateName: candidateName,
    })
  )
  rule()

  console.log("LIVE CALL 4 — generateReplyEmailAI, name available")
  const reply = await generateReplyEmailAI({
    userId,
    surface: "app",
    resumeText,
    candidateName,
    receivedEmail:
      "Subject: Your application\n\nHi — thanks for applying to the Senior Java Engineer role. Are you still interested, and when could you take a 30-minute call this week?\n\nDana Reyes\nRecruiting, Vantage Freight Systems",
    job,
  })
  console.log(reply.body)
  results.push(
    verdict({
      label: "reply/named",
      subject: reply.subject,
      body: reply.body,
      // A reply subject is "Re: <their subject>".
      expectNameInSubject: false,
      expectNameInSignature: true,
      generatorCandidateName: candidateName,
    })
  )
  rule()

  const passed = results.filter((r) => r.ok).length
  console.log(`RESULT: ${passed}/${results.length} passed`)
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {})
  })
