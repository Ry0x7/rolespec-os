/**
 * Dev-only seed: builds the two resume + job pairs a BROWSER check of the
 * grounding and signature notices needs, idempotently, so verifying them stops
 * costing a session of hand-typing into the UI.
 *
 * Usage: npx tsx scripts/seed-qa-grounding-fixture.ts
 * Env:   DEV_ADMIN_PASSWORD (default "dev-admin-local-1234") — the password of
 *        the extra NAMELESS user this script creates. Run
 *        `npx tsx scripts/seed-dev-admin.ts` first; the NAMED scenario hangs off
 *        that account.
 *
 * Two scenarios, because the two components under test need different inputs:
 *
 *  NAMED    — dev-admin, a resume whose CONTACT section carries "Marisol Reyes"
 *             and a posting demanding Kafka / Kubernetes / JMS / Terraform, none
 *             of which the resume backs. Exercises `GroundingNotice` (the draft
 *             has to talk about the gaps) with a name that resolves correctly.
 *
 *  NAMELESS — a SEPARATE user, because `resolveCandidateName()` falls back to
 *             `User.name` and the dev admin's is "Dev Admin". Only a user with a
 *             null `name` AND a resume with no contact `fullName` reaches the
 *             generators' nameless path, where any name in the sign-off is an
 *             `unexpected_name` — one of the two `SignatureCheck` kinds that
 *             actually reach the DOM. The user is an ADMIN so it inherits the
 *             deployment AI credentials (a non-admin must bring its own key).
 *
 * Deterministically checked before it was written down: the NAMED posting sends
 * Kafka, consumer group tuning, partition strategy, Kubernetes, JMS, Terraform,
 * AWS and Grafana to DO NOT CLAIM, and Java, Spring Boot, PostgreSQL and REST to
 * SUPPORTED, via `groundEmployerRequirements()`.
 *
 * Rows are written with fixed ids and re-run clean, so the /jobs/<id> URLs it
 * prints stay stable across runs.
 *
 * NOTE: rows are inserted through Prisma directly, so the create-path
 * best-effort extractors (`assessJobRiskHeuristics`, `extractJobRequirements`,
 * `extractEmployerQuestions`) never run — the risk and requirement badges stay
 * empty on these fixtures. That is expected and out of scope here.
 */
import "dotenv/config"
import bcrypt from "bcryptjs"
import { prisma } from "@/shared/lib/prisma"

const DEV_ADMIN_EMAIL = "dev-admin@rolespec.local"
const NAMELESS_EMAIL = "dev-qa-nameless@rolespec.local"

const NAMED_RESUME_ID = "qa_grounding_resume_named"
const NAMED_JOB_ID = "qa_grounding_job_named"
const NAMELESS_RESUME_ID = "qa_grounding_resume_nameless"
const NAMELESS_JOB_ID = "qa_grounding_job_nameless"

/**
 * The posting for both scenarios. Requirement bullets deliberately avoid opening
 * on a capitalised non-skill word ("Infrastructure managed as code…",
 * "Clean REST API design") — the extractor's positional guard lets those through
 * as requirements, which would put "Infrastructure", "Clean" and "Exposure" in
 * DO NOT CLAIM and blur the signal this fixture exists to produce.
 */
const JOB_DESCRIPTION = `Northwind Data Systems is hiring a Senior Backend Engineer for our event platform team.

About the role:
You will own the services that move money-movement events between our core ledger and the reporting warehouse.

Requirements:
- 5+ years of production Java, with strong Spring Boot experience
- Hands-on production experience with Kafka, including consumer group tuning and partition strategy
- Comfortable operating services on Kubernetes at scale
- Working knowledge of JMS for our remaining legacy integrations
- Comfortable managing infrastructure as code with Terraform
- Strong PostgreSQL schema design and query tuning
- Solid REST service design and versioning

Nice to have:
- AWS certification
- Some exposure to Grafana dashboards

Benefits: unlimited PTO, twelve weeks parental leave, tuition reimbursement.`

type ItemSeed = { content: Record<string, unknown>; order: number }
type SectionSeed = {
  type: "CONTACT" | "SUMMARY" | "EXPERIENCE" | "EDUCATION" | "SKILLS"
  title: string
  order: number
  items: ItemSeed[]
}

/**
 * `contact` is the only difference between the two resumes that matters: the
 * NAMELESS one carries no `fullName`, so `resolveCandidateName()` falls through
 * to the account.
 */
function resumeSections(contact: Record<string, unknown>): SectionSeed[] {
  return [
    { type: "CONTACT", title: "Contact", order: 0, items: [{ content: contact, order: 0 }] },
    {
      type: "SUMMARY",
      title: "Summary",
      order: 1,
      items: [
        {
          order: 0,
          content: {
            text: "Backend engineer with seven years building transactional services in Java and Spring Boot. Comfortable owning a PostgreSQL schema end to end and shipping REST services other teams depend on.",
          },
        },
      ],
    },
    {
      type: "EXPERIENCE",
      title: "Experience",
      order: 2,
      items: [
        {
          order: 0,
          content: {
            role: "Senior Backend Engineer",
            company: "Larkfield Systems",
            startDate: "2021-03",
            endDate: "",
            current: true,
            bullets: [
              "Rebuilt the billing service in Spring Boot, cutting p95 checkout latency from 940ms to 310ms so support stopped fielding timeout tickets",
              "Redesigned the PostgreSQL ledger schema and added covering indexes, which let month-end close finish inside the batch window",
              "Wrote the REST contract the mobile team builds against, so client work stopped blocking on backend guesses",
            ],
          },
        },
        {
          order: 1,
          content: {
            role: "Backend Engineer",
            company: "Harbor Analytics",
            startDate: "2018-06",
            endDate: "2021-02",
            current: false,
            bullets: [
              "Migrated a monolithic reporting job to a Spring Boot service, cutting the nightly run from six hours to under one",
              "Added JUnit and Testcontainers coverage across the payments module so releases stopped needing a manual regression pass",
            ],
          },
        },
      ],
    },
    {
      type: "EDUCATION",
      title: "Education",
      order: 3,
      items: [
        {
          order: 0,
          content: {
            degree: "BS",
            field: "Computer Science",
            school: "University of Texas at Austin",
            startDate: "2014",
            endDate: "2018",
          },
        },
      ],
    },
    {
      type: "SKILLS",
      title: "Skills",
      order: 4,
      items: [
        {
          order: 0,
          content: {
            category: "Backend",
            skills: ["Java", "Spring Boot", "PostgreSQL", "REST", "JUnit", "Maven", "Testcontainers"],
          },
        },
        { order: 1, content: { category: "Tools", skills: ["Git", "IntelliJ", "Jira"] } },
      ],
    },
  ]
}

async function seedResume(input: {
  id: string
  userId: string
  title: string
  contact: Record<string, unknown>
}) {
  await prisma.resume.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      userId: input.userId,
      title: input.title,
      targetRole: "Senior Backend Engineer",
      status: "ACTIVE",
    },
    update: { userId: input.userId, title: input.title, status: "ACTIVE" },
  })

  // Sections carry generated ids, so a re-run replaces them wholesale rather
  // than trying to reconcile item by item.
  await prisma.resumeSection.deleteMany({ where: { resumeId: input.id } })

  for (const section of resumeSections(input.contact)) {
    await prisma.resumeSection.create({
      data: {
        resumeId: input.id,
        type: section.type,
        title: section.title,
        order: section.order,
        visible: true,
        items: {
          create: section.items.map((item) => ({
            content: item.content as never,
            order: item.order,
          })),
        },
      },
    })
  }
}

async function seedJob(input: { id: string; userId: string; jobTitle: string }) {
  // The readers go through the `job` relation, so the posting has to exist as
  // its own row or the fixture renders blank. It reuses the application's id,
  // which is both the script's fixed-id convention and exactly what the split's
  // backfill produced, so a re-run updates the existing posting instead of
  // orphaning it behind a new one.
  const jobId = input.id
  const posting = {
    userId: input.userId,
    companyName: "Northwind Data Systems",
    title: input.jobTitle,
    location: "Austin, TX",
    jobType: "FULL_TIME",
    workType: "HYBRID",
    description: JOB_DESCRIPTION,
  } as const

  await prisma.job.upsert({
    where: { id: jobId },
    create: { id: jobId, ...posting },
    update: posting,
  })

  await prisma.jobApplication.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      userId: input.userId,
      jobId,
      status: "INTERESTED",
      contact: "Dana Whitlock",
    },
    update: {
      userId: input.userId,
      jobId,
      contact: "Dana Whitlock",
    },
  })
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed QA fixtures in production")
  }

  const admin = await prisma.user.findUnique({
    where: { email: DEV_ADMIN_EMAIL },
    select: { id: true, name: true },
  })
  if (!admin) {
    throw new Error(
      `No ${DEV_ADMIN_EMAIL} user. Run \`npx tsx scripts/seed-dev-admin.ts\` first.`
    )
  }

  // --- NAMED -------------------------------------------------------------
  await seedResume({
    id: NAMED_RESUME_ID,
    userId: admin.id,
    title: "QA — Marisol Reyes (named)",
    contact: {
      fullName: "Marisol Reyes",
      email: "marisol.reyes@example.com",
      phone: "+1 512 555 0142",
      location: "Austin, TX",
    },
  })
  await seedJob({ id: NAMED_JOB_ID, userId: admin.id, jobTitle: "Senior Backend Engineer" })

  // --- NAMELESS ----------------------------------------------------------
  const password = process.env.DEV_ADMIN_PASSWORD ?? "dev-admin-local-1234"
  const hashedPassword = await bcrypt.hash(password, 12)

  const nameless = await prisma.user.upsert({
    where: { email: NAMELESS_EMAIL },
    // `name: null` is the whole point — with a name here the resume's missing
    // one would be papered over and the nameless prompt path never runs.
    create: { email: NAMELESS_EMAIL, name: null, password: hashedPassword, role: "ADMIN" },
    update: { name: null, password: hashedPassword, role: "ADMIN" },
    select: { id: true, email: true },
  })
  await prisma.playerProfile.upsert({
    where: { userId: nameless.id },
    create: { userId: nameless.id, onboardedAt: new Date() },
    update: {},
  })

  await seedResume({
    id: NAMELESS_RESUME_ID,
    userId: nameless.id,
    title: "QA — no name on file (nameless)",
    contact: {
      email: "backend.candidate@example.com",
      phone: "+1 512 555 0177",
      location: "Austin, TX",
    },
  })
  await seedJob({ id: NAMELESS_JOB_ID, userId: nameless.id, jobTitle: "Senior Backend Engineer" })

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100"

  console.log("Seeded QA grounding/signature fixtures.\n")
  console.log("NAMED     sign in as: %s", DEV_ADMIN_EMAIL)
  console.log("          resume:     %s (contact fullName = Marisol Reyes)", NAMED_RESUME_ID)
  console.log("          job:        %s/jobs/%s", base, NAMED_JOB_ID)
  console.log("")
  console.log("NAMELESS  sign in as: %s (password = DEV_ADMIN_PASSWORD)", nameless.email)
  console.log("          resume:     %s (no contact fullName, User.name is null)", NAMELESS_RESUME_ID)
  console.log("          job:        %s/jobs/%s", base, NAMELESS_JOB_ID)
  console.log("")
  console.log("Dev admin User.name is %o — the NAMED scenario resolves its name", admin.name)
  console.log("from the resume contact block, which wins over the account name.")
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
