/**
 * Is the model's ATS keyword work replaceable by deterministic code?
 *
 * Usage:
 *   npx tsx scripts/ats-keyword-determinism-check.ts --deterministic  # no AI calls
 *   npx tsx scripts/ats-keyword-determinism-check.ts                  # CLEAN, 5 live
 *   npx tsx scripts/ats-keyword-determinism-check.ts --hard           # HARD, 3 live
 *   npx tsx scripts/ats-keyword-determinism-check.ts --hard --deterministic
 *   npx tsx scripts/ats-keyword-determinism-check.ts --refresh        # re-bill
 *
 * TWO REGIMES. `FIXTURES` is the CLEAN regime — five short, cleanly bulleted
 * postings, one per career, taken verbatim from `grounding-coverage-check.ts`.
 * `HARD_FIXTURES` (`--hard`) is the production shape: long, boilerplate-heavy,
 * inconsistently capitalised postings with requirements buried in prose and
 * duplicated across sections. The clean regime alone cannot answer whether a
 * model degrades on real input, which is the whole question.
 *
 * The live side runs the REAL `analyzeResumeATS()` once per fixture and caches
 * the result to `--cache <path>` (default: the OS temp dir), so a re-run costs
 * nothing. `--refresh` discards the cache and re-bills. Pass a different
 * `--cache` per regime to keep the two sets of live results apart.
 *
 * THE HEADLINE METRIC. `missingKeywords` is a claim that can be checked without
 * a human: a term is "missing" only if the resume does not contain it. So both
 * sides are scored on:
 *
 *   PROVABLE FALSE POSITIVES — listed as missing while the resume contains the
 *     term as a whole token, case-insensitively. An outright error either way.
 *   PROVABLE MISSES — a real requirement of the posting that the resume does
 *     NOT contain, and that the side failed to list. Ground truth is the
 *     hand-written `real[]` list per posting, lifted verbatim from
 *     `scripts/grounding-coverage-check.ts`, so it is independent of both sides.
 *
 * Read the FP column honestly: the deterministic side decides "missing" with
 * the SAME whole-token predicate the metric uses, so its zero is true by
 * construction. That is the guarantee being bought, not evidence of a contest.
 * The column measures the MODEL. The non-circular comparison is PROVABLE
 * MISSES, which is scored against the independent `real[]` fixtures.
 *
 * BOILERPLATE is the third measure, hard regime only: a listed term that hits
 * the fixture's `noise[]` list (benefits, EEO language, the company's own name)
 * is furniture mistaken for a requirement — a failure a long posting invites and
 * a short one cannot produce.
 *
 * Every `real[]` and `noise[]` list is written BEFORE that posting is sent to a
 * model, and is not edited afterwards. MISS and BOILERPLATE are the only
 * non-circular metrics here and that ordering is what keeps them honest.
 *
 * The resumes are written here, one per posting, each deliberately covering only
 * part of its posting's requirements.
 */
import "dotenv/config"

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import { prisma } from "@/shared/lib/prisma"
import { getEffectiveAiConfigForUser } from "@/shared/lib/ai-provider"
import { classifyKeywordEvidence } from "@/shared/lib/evidence-grounding"
import {
  analyzeResumeATS,
  type ATSAnalysisResult,
} from "@/features/resume/services/ats-analyze"
import { scoreKeywords } from "./ats-keyword-score"
import { serializeSections } from "@/features/resume/lib/serialize-sections"
import type { Section } from "@/features/resume/hooks/use-resume-store"

// ─── Fixture plumbing ───────────────────────────────────────────────────────

interface ResumeSpec {
  name: string
  email: string
  phone: string
  location: string
  summary: string
  experience: {
    role: string
    company: string
    startDate: string
    endDate: string | null
    current?: boolean
    bullets: string[]
  }[]
  education: { degree: string; field: string; school: string; startDate: string; endDate: string }[]
  skills: { category: string; skills: string[] }[]
  certifications?: { name: string; organization: string; dateObtained: string }[]
}

function buildSections(id: string, spec: ResumeSpec): Section[] {
  const sections: Section[] = []
  let order = 0
  const push = (
    type: Section["type"],
    title: string,
    contents: Record<string, unknown>[]
  ) => {
    if (contents.length === 0) return
    const sectionId = `${id}-sec-${order}`
    sections.push({
      id: sectionId,
      resumeId: id,
      type,
      title,
      order: order++,
      visible: true,
      items: contents.map((content, index) => ({
        id: `${sectionId}-item-${index}`,
        sectionId,
        order: index,
        content,
      })),
    })
  }

  push("CONTACT", "Contact", [
    {
      fullName: spec.name,
      email: spec.email,
      phone: spec.phone,
      location: spec.location,
    },
  ])
  push("SUMMARY", "Summary", [{ text: spec.summary }])
  push("EXPERIENCE", "Experience", spec.experience.map((e) => ({ ...e })))
  push("EDUCATION", "Education", spec.education.map((e) => ({ ...e })))
  push("SKILLS", "Skills", spec.skills.map((s) => ({ ...s })))
  push("CERTIFICATIONS", "Certifications", (spec.certifications ?? []).map((c) => ({ ...c })))
  return sections
}

interface Fixture {
  career: string
  targetRole: string
  /** Clean regime: verbatim from scripts/grounding-coverage-check.ts. */
  jobDescription: string
  /**
   * The posting's real requirements. GROUND TRUTH, and the only non-circular
   * metric here, so it is written BEFORE the posting is ever sent to a model
   * and is never edited afterwards to suit a result.
   */
  real: string[]
  /**
   * Hard regime only: benefits, EEO language, company/product names and other
   * posting furniture. Listing any of these as a "missing requirement" is a
   * boilerplate error — the failure mode a long messy posting invites and a
   * short clean one cannot.
   */
  noise?: string[]
  resume: ResumeSpec
}

// ─── The five careers ───────────────────────────────────────────────────────

const FIXTURES: Fixture[] = [
  {
    career: "Software engineer",
    targetRole: "Senior Java Engineer",
    jobDescription: `Senior Java Engineer
What we are looking for:
- 5+ years of Java, with deep Spring Boot experience
- Strong JPQL and Hibernate skills
- Production experience with JMS and Kafka
- Comfortable with Kubernetes and Terraform`,
    real: ["Java", "Spring Boot", "JPQL", "Hibernate", "JMS", "Kafka", "Kubernetes", "Terraform"],
    resume: {
      name: "Marisol Reyes",
      email: "marisol.reyes@example.com",
      phone: "555-0142",
      location: "Austin, TX",
      summary:
        "Backend engineer with six years building transactional services in Java and Spring Boot, from schema design through release and on-call.",
      experience: [
        {
          role: "Senior Java Engineer",
          company: "Northwind Logistics",
          startDate: "2022-03",
          endDate: null,
          current: true,
          bullets: [
            "Built and maintained eleven Spring Boot services behind a REST gateway serving 40 requests per second at peak.",
            "Modelled shipment and billing data in PostgreSQL, cutting p95 read latency by 38% with covering indexes.",
            "Ran the services on Kubernetes and shipped through a GitLab CI pipeline.",
            "Wrote integration tests with JUnit and Testcontainers against a real database.",
          ],
        },
        {
          role: "Backend Engineer",
          company: "Alcove Payments",
          startDate: "2019-08",
          endDate: "2022-02",
          bullets: [
            "Implemented settlement and refund endpoints in Java 11 with Spring MVC.",
            "Replaced a nightly batch reconciliation with an incremental job, cutting the window from four hours to twenty minutes.",
          ],
        },
      ],
      education: [
        {
          degree: "B.S.",
          field: "Computer Science",
          school: "State University",
          startDate: "2015-09",
          endDate: "2019-05",
        },
      ],
      skills: [
        {
          category: "Languages & Frameworks",
          skills: ["Java", "Spring Boot", "Spring MVC", "SQL"],
        },
        { category: "Platforms", skills: ["PostgreSQL", "Docker", "Kubernetes", "GitLab CI"] },
      ],
    },
  },
  {
    career: "Registered nurse",
    targetRole: "Registered Nurse",
    jobDescription: `Registered Nurse — Medical/Surgical Unit
What we are looking for:
- 2+ years of acute care experience in a hospital setting
- Current BLS and ACLS certification
- Proficiency in venipuncture, wound care and catheter insertion
- Experience with electronic health records and medication administration
- Comfortable with patient triage and discharge planning`,
    real: [
      "acute care", "BLS", "ACLS", "venipuncture", "wound care", "catheter insertion",
      "electronic health records", "medication administration", "triage", "discharge planning",
    ],
    resume: {
      name: "Dana Whitfield",
      email: "dana.whitfield@example.com",
      phone: "555-0177",
      location: "Columbus, OH",
      summary:
        "Registered Nurse with four years of acute care experience on a 32-bed medical-surgical unit, currently precepting new-graduate nurses.",
      experience: [
        {
          role: "Registered Nurse",
          company: "Cedar Valley Regional Hospital",
          startDate: "2022-01",
          endDate: null,
          current: true,
          bullets: [
            "Carried a 1:5 med-surg assignment on nights, escalating to the rapid response team on decompensation.",
            "Completed admission assessments, hourly rounding and patient triage across a 32-bed unit.",
            "Charted every assessment and medication administration in Epic within the shift.",
            "Performed wound care and dressing changes, cutting unit pressure-injury rate by 22%.",
          ],
        },
        {
          role: "Staff Nurse",
          company: "Riverbend Community Hospital",
          startDate: "2020-06",
          endDate: "2021-12",
          bullets: [
            "Delivered direct patient care on a 24-bed telemetry floor.",
            "Gave and received bedside shift handoff using SBAR.",
          ],
        },
      ],
      education: [
        {
          degree: "B.S.N.",
          field: "Nursing",
          school: "State University",
          startDate: "2016-09",
          endDate: "2020-05",
        },
      ],
      skills: [
        { category: "Clinical", skills: ["acute care", "wound care", "IV therapy", "patient triage"] },
        { category: "Systems", skills: ["Epic", "medication administration"] },
      ],
      certifications: [
        { name: "BLS", organization: "American Heart Association", dateObtained: "2024-03" },
        { name: "RN License (Ohio)", organization: "Ohio Board of Nursing", dateObtained: "2020-07" },
      ],
    },
  },
  {
    career: "Staff accountant",
    targetRole: "Staff Accountant",
    jobDescription: `Staff Accountant
What we are looking for:
- 3+ years of experience with accounts payable and accounts receivable
- Strong knowledge of month-end close and bank reconciliation
- Proficiency in general ledger maintenance and journal entries
- Experience with payroll processing and sales tax filings
- Advanced Excel; QuickBooks a plus`,
    real: [
      "accounts payable", "accounts receivable", "month-end close", "bank reconciliation",
      "general ledger", "journal entries", "payroll processing", "sales tax", "Excel", "QuickBooks",
    ],
    resume: {
      name: "Priya Raman",
      email: "priya.raman@example.com",
      phone: "555-0119",
      location: "Denver, CO",
      summary:
        "Staff Accountant with five years owning accounts payable for a 200-person manufacturer, closing the books alongside a two-person team.",
      experience: [
        {
          role: "Staff Accountant",
          company: "Ridgeline Manufacturing",
          startDate: "2021-04",
          endDate: null,
          current: true,
          bullets: [
            "Owned accounts payable end to end for roughly 400 vendor invoices a month, cutting late payments by 60%.",
            "Posted each recurring journal entry and maintained the general ledger through the close.",
            "Ran bank reconciliation for four operating accounts, clearing variances within two business days.",
            "Rebuilt the depreciation schedule in Excel, removing eight hours of manual work per period.",
          ],
        },
        {
          role: "Accounting Clerk",
          company: "Harborview Supply",
          startDate: "2018-09",
          endDate: "2021-03",
          bullets: [
            "Coded and entered vendor invoices and expense reports.",
            "Assisted with fixed-asset tracking and audit support requests.",
          ],
        },
      ],
      education: [
        {
          degree: "B.S.",
          field: "Accounting",
          school: "State University",
          startDate: "2014-09",
          endDate: "2018-05",
        },
      ],
      skills: [
        { category: "Accounting", skills: ["accounts payable", "general ledger", "bank reconciliation", "fixed assets"] },
        { category: "Tools", skills: ["Excel", "NetSuite"] },
      ],
    },
  },
  {
    career: "Line cook",
    targetRole: "Line Cook",
    jobDescription: `Line Cook — Fine Dining
What we are looking for:
- 2 years on a hot line in a high-volume kitchen
- Skilled in butchery, sauce work and pastry
- Experience with a la carte service and banquet plating
- Knowledge of food safety and inventory control
- ServSafe certification preferred`,
    real: [
      "hot line", "butchery", "sauce work", "pastry", "a la carte", "banquet plating",
      "food safety", "inventory control", "ServSafe",
    ],
    resume: {
      name: "Tomas Iglesias",
      email: "tomas.iglesias@example.com",
      phone: "555-0163",
      location: "Chicago, IL",
      summary:
        "Line Cook with three years on the hot line of a 180-cover neighbourhood kitchen, running saute and grill through full weekend service.",
      experience: [
        {
          role: "Line Cook",
          company: "Halsted House",
          startDate: "2022-05",
          endDate: null,
          current: true,
          bullets: [
            "Ran saute and grill on the hot line through 180-cover Friday and Saturday services.",
            "Handled whole-animal butchery for the weekly special, lifting protein yield by about 15%.",
            "Kept the station to food safety standards through two unannounced health inspections with no violations.",
            "Ran weekly inventory control counts and cut walk-in spoilage by a third.",
          ],
        },
        {
          role: "Prep Cook",
          company: "Wicker Park Tavern",
          startDate: "2020-08",
          endDate: "2022-04",
          bullets: [
            "Prepped stocks, braises and mise en place for a six-station kitchen.",
            "Received deliveries and rotated stock on a FIFO schedule.",
          ],
        },
      ],
      education: [
        {
          degree: "Certificate",
          field: "Culinary Arts",
          school: "City Community College",
          startDate: "2019-01",
          endDate: "2020-06",
        },
      ],
      skills: [
        { category: "Kitchen", skills: ["hot line", "butchery", "grill", "saute", "food safety", "inventory control"] },
      ],
      certifications: [
        { name: "ServSafe Food Handler", organization: "National Restaurant Association", dateObtained: "2023-02" },
      ],
    },
  },
  {
    career: "Warehouse / logistics",
    targetRole: "Warehouse Associate",
    jobDescription: `Warehouse Associate
What we are looking for:
- Experience with forklift operation and pallet jacks
- Knowledge of inventory control and cycle counting
- Comfortable with order picking and shipping documentation
- Familiarity with cold chain handling
- OSHA certification a plus`,
    real: [
      "forklift operation", "pallet jacks", "inventory control", "cycle counting",
      "order picking", "shipping documentation", "cold chain", "OSHA",
    ],
    resume: {
      name: "Andre Boucher",
      email: "andre.boucher@example.com",
      phone: "555-0188",
      location: "Memphis, TN",
      summary:
        "Warehouse Associate with four years in a 240,000 sq ft distribution centre, certified on sit-down and reach forklifts.",
      experience: [
        {
          role: "Warehouse Associate",
          company: "Delta Freight Distribution",
          startDate: "2021-07",
          endDate: null,
          current: true,
          bullets: [
            "Handled forklift operation on sit-down and reach trucks across receiving and putaway, with no recordable incidents in four years.",
            "Moved staged freight with a pallet jack through a 300-order peak day.",
            "Held inventory control accuracy above 99.4% across a 6,000-SKU footprint.",
            "Ran order picking on an RF scanner at roughly 140 lines an hour.",
          ],
        },
        {
          role: "Material Handler",
          company: "Southline Logistics",
          startDate: "2019-03",
          endDate: "2021-06",
          bullets: [
            "Loaded and unloaded trailers on a two-dock inbound operation.",
            "Kept the yard and staging lanes to OSHA housekeeping standards.",
          ],
        },
      ],
      education: [
        {
          degree: "High School Diploma",
          field: "General Studies",
          school: "Central High School",
          startDate: "2014-08",
          endDate: "2018-05",
        },
      ],
      skills: [
        { category: "Operations", skills: ["forklift operation", "inventory control", "order picking", "RF scanning"] },
        { category: "Safety", skills: ["OSHA 10", "lockout/tagout"] },
      ],
    },
  },
]

// ─── The hard regime ────────────────────────────────────────────────────────

/**
 * The five fixtures above are the regime the first measurement covered: short,
 * cleanly bulleted postings where every requirement sits in one list. That is
 * not what a real posting looks like, and the first measurement's conclusion was
 * explicitly limited to it.
 *
 * These three are the production shape — 4-8k characters, an "About us" blurb, a
 * benefits list, an EEO block, requirements duplicated between "Requirements"
 * and "Nice to have", several requirements buried in prose instead of bullets,
 * and inconsistent capitalisation (`kubernetes` lowercase in one place and
 * `Kubernetes` in another, `React.js` in one section and `React` in the next).
 * Two of the three are deliberately NOT software: a capitalisation- or
 * tech-shaped bet has to be checked outside software, because this feature line
 * once silently protected nobody outside it.
 *
 * Both postings are kept under the 6000-character cap `analyzeResumeATS()`
 * applies to the job description, so the model and the deterministic scorer see
 * the SAME text. Any difference is then the reading, not the truncation.
 */
const HARD_FIXTURES: Fixture[] = [
  {
    career: "HARD software",
    targetRole: "Senior Platform Engineer",
    jobDescription: `Senior Platform Engineer — Meridian Pay

About Us
Meridian Pay is a Series C payments company processing just over $9B a year for
marketplaces across North America and Europe. We were founded in 2018 by two
former treasury engineers who were tired of reconciliation spreadsheets, and we
have grown to 340 people across Austin, Toronto and Lisbon. Our culture is
written down, argued about, and revised every quarter. We believe in small teams,
long-form writing over meetings, and shipping on Fridays because we trust our
tests. We have been profitable since the second half of last year, which means we
get to make decisions on a multi-year horizon instead of a runway.

The Role
The Platform team owns the substrate every product team at Meridian builds on:
our compute layer, our deploy tooling, our observability story, and the internal
developer platform that ties them together. You will spend a good part of your
first quarter inside our infrastructure-as-code repository, where every
environment is described in Terraform, and inside Datadog, which is where we find
out what is actually happening in production before a customer tells us. This is
not a firefighting role — we run a healthy on-call with a documented escalation
path and a genuine follow-the-sun rotation, and last quarter the median engineer
was paged twice.

What you'll do
- Own and evolve our multi-tenant compute platform, which runs on kubernetes
  across three regions and about 900 nodes at peak
- Write and review services in Go, our default language for anything that sits on
  the request path
- Build tooling in Python for the deploy pipeline and for the migration scripts
  the product teams run against PostgreSQL
- Instrument services so that an SLO breach pages a human with enough context to
  act, and cut the noise out of the alerts that already exist
- Partner with product teams on the internal developer platform surface, which is
  a React.js single-page app we all maintain together
- Take part in design review, where we argue about interfaces before we build them

Our Stack
Most of the request path is Go. Data lives in PostgreSQL, with a small amount of
Redis in front of the hottest reads. Async work moves over a queue we are
actively migrating. The frontend is React with TypeScript. Everything is built
and shipped by our CI/CD pipeline, which we maintain ourselves and which is one
of the first things you will be asked to improve.

Requirements
- 6+ years building and operating backend systems in production
- Strong Go and Python
- Deep, hands-on Kubernetes experience — not just "I have run kubectl once"
- Production experience with PostgreSQL, including schema migration under load
- Comfort with observability tooling and a real, working understanding of SLOs
- Experience with CI/CD pipelines and a bias toward automating the boring parts
- Excellent written communication; we are a writing culture and it is not optional

Nice to have
- Terraform at scale, especially module design across many environments
- Kafka or another event streaming platform
- gRPC for service-to-service communication
- Experience with React or another modern frontend framework
- Prior work in payments, fintech or another regulated domain
- Contributions to open source infrastructure projects

How We Hire
A 30-minute call with a recruiter, a 60-minute technical conversation with a
platform engineer, a take-home you are paid for or a live pairing session — your
choice — and a final round of three conversations. We give a decision within five
business days of the final round, every time.

Benefits and Perks
- Competitive salary plus meaningful equity in a Series C company
- 401(k) with a 4% match, vested immediately
- Full medical, dental and vision; HSA and FSA options
- Unlimited PTO with a four-week minimum we actually enforce
- $2,000 annual learning budget and a conference of your choice
- Home office stipend and a new laptop on day one
- Twelve weeks parental leave for all parents

Equal Employment Opportunity
Meridian Pay is an Equal Opportunity Employer. We do not discriminate on the
basis of race, color, religion, sex, sexual orientation, gender identity,
national origin, age, disability, veteran status, or any other protected
characteristic. We are committed to building a diverse team and to providing
reasonable accommodation to applicants with disabilities. If you need an
accommodation during the interview process, please tell your recruiter.

Meridian Pay participates in E-Verify. This posting is not an offer of
employment. Compensation range: $185,000 - $235,000 depending on location and
level.`,
    real: [
      "Go", "Python", "Kubernetes", "PostgreSQL", "CI/CD", "observability", "SLOs",
      "Terraform", "Kafka", "gRPC", "React.js", "Redis", "TypeScript",
    ],
    noise: [
      "401(k)", "HSA", "FSA", "PTO", "equity", "parental leave", "E-Verify",
      "Equal Opportunity", "Meridian Pay", "learning budget", "home office stipend",
      "dental", "vision", "medical", "conference", "laptop", "recruiter",
    ],
    resume: {
      name: "Ines Okafor",
      email: "ines.okafor@example.com",
      phone: "555-0231",
      location: "Austin, TX",
      summary:
        "Senior Platform Engineer with eight years operating multi-region backend infrastructure. I own compute platforms end to end, from the Go services on the request path to the Kubernetes they run on and the Datadog dashboards that tell us when they are unhappy.",
      experience: [
        {
          role: "Senior Platform Engineer",
          company: "Cartwright Systems",
          startDate: "2021-06",
          endDate: null,
          current: true,
          bullets: [
            "Owned a multi-tenant Kubernetes platform spanning two regions and roughly 600 nodes, cutting median deploy time from 18 minutes to 4.",
            "Wrote and reviewed request-path services in Go, including the rate limiter that now fronts every public endpoint.",
            "Built the deploy tooling and migration runners in Python that product teams use against PostgreSQL, removing a standing DBA bottleneck.",
            "Rebuilt alerting around an explicit SLO per service in Datadog, dropping paged-but-no-action alerts by 71%.",
            "Maintained the CI/CD pipeline and cut the median pull-request feedback loop from 22 minutes to 9.",
          ],
        },
        {
          role: "Platform Engineer",
          company: "Halden Freight",
          startDate: "2018-02",
          endDate: "2021-05",
          bullets: [
            "Migrated 40 services off hand-rolled VMs onto containers, standardising build and release across six teams.",
            "Introduced structured logging and distributed tracing, giving the on-call a first real observability story.",
            "Ran schema migrations against a 4TB PostgreSQL cluster under live load with no customer-visible downtime.",
            "Shared the on-call rotation and wrote the escalation runbook the team still uses.",
          ],
        },
        {
          role: "Site Reliability Engineer",
          company: "Corvid Analytics",
          startDate: "2016-08",
          endDate: "2018-01",
          bullets: [
            "Automated capacity checks and cluster upgrades that had previously been a monthly manual weekend.",
            "Instrumented the ingestion pipeline with Prometheus metrics and built the first dashboards the team trusted.",
          ],
        },
      ],
      education: [
        {
          degree: "B.S.",
          field: "Computer Engineering",
          school: "State University",
          startDate: "2012-09",
          endDate: "2016-05",
        },
      ],
      skills: [
        { category: "Languages", skills: ["Go", "Python", "SQL", "Bash"] },
        { category: "Platform", skills: ["Kubernetes", "Docker", "PostgreSQL", "CI/CD"] },
        { category: "Observability", skills: ["Datadog", "Prometheus", "distributed tracing", "observability"] },
      ],
    },
  },
  {
    career: "HARD nurse",
    targetRole: "Registered Nurse",
    jobDescription: `Registered Nurse — Intensive Care Unit (Nights) — Cedar Ridge Health

About Cedar Ridge
Cedar Ridge Health is a 480-bed Magnet-designated regional medical centre serving
four counties. We opened our doors in 1961 and have been recognised for nursing
excellence in each of the last three review cycles. Our ICU is a 24-bed mixed
medical-surgical unit with a dedicated intensivist in house around the clock, a
2:1 ratio on the sickest assignments, and a nurse-driven mobility programme that
our own staff designed and now presents at conference.

About the Unit and the Role
This is a night-shift position, three twelve-hour shifts a week, with every third
weekend. You will be caring for the most complex patients in the building:
post-operative cardiothoracic recoveries, septic shock, respiratory failure and
multi-organ dysfunction. Our unit charts in Epic, and every nurse is expected to
be fluent in it by the end of orientation — we will not hand you a workflow you
have not been trained on. Our orientation is twelve weeks with a dedicated
preceptor, longer if you need it, and nobody has ever been pushed off it early.

What you will do
- Manage a 1:2 critical care assignment, escalating through our rapid response
  pathway when a patient begins to deteriorate
- Provide ventilator management for intubated patients in partnership with
  respiratory therapy, including weaning trials and extubation readiness
- Titrate vasoactive drips against ordered haemodynamic targets and document the
  response every hour
- Perform and interpret hemodynamic monitoring, including arterial lines and
  central venous pressure
- Run our sepsis bundle inside the required window, and own the documentation
  that proves we did
- Support CLABSI and CAUTI prevention bundles, daily line necessity review, and
  our oral care protocol
- Give and receive structured handoff at the bedside using SBAR
- Precept new-graduate nurses and nursing students once you are off orientation

Requirements
- Active RN license in this state or a compact state
- BSN required, or an active enrolment with a completion date within two years
- 2+ years of recent critical care experience in an adult ICU
- Current BLS and ACLS certification, both required on day one
- Demonstrated competence with ventilator management and titration of vasoactive
  medications
- Comfortable with an electronic health record; Epic experience strongly preferred
- Evidence of participation in a measurable quality improvement effort

Preferred / Nice to have
- CCRN certification, or eligibility and intent to sit it within eighteen months
- CRRT experience — we run continuous renal replacement on the unit and are
  always short of trained staff
- Experience with arterial lines and Swan-Ganz catheters
- Prior charge nurse or preceptor experience
- NIHSS certification for our stroke pathway
- Experience with hemodynamic monitoring in a cardiothoracic population

Compensation and Benefits
- Competitive base plus a night-shift differential and a weekend differential
- $12,000 sign-on bonus for candidates with two or more years of ICU experience
- 403(b) with employer match after ninety days
- Medical, dental and vision from the first of the month after hire
- Generous PTO that accrues from day one
- Tuition reimbursement up to $5,250 per year and full certification exam
  reimbursement
- Free parking in the staff garage and subsidised meals on nights

Equal Employment Opportunity
Cedar Ridge Health is an Equal Opportunity Employer and does not discriminate on
the basis of race, color, religion, sex, sexual orientation, gender identity,
national origin, age, disability, veteran status, or any other characteristic
protected by law. Reasonable accommodation is available to applicants with
disabilities on request. Cedar Ridge Health participates in E-Verify and is a
tobacco-free campus. This posting is not a contract of employment.`,
    real: [
      "critical care", "rapid response", "ventilator management", "vasoactive drips",
      "hemodynamic monitoring", "arterial lines", "sepsis bundle", "CLABSI", "CAUTI",
      "SBAR", "BLS", "ACLS", "Epic", "CCRN", "CRRT", "Swan-Ganz", "NIHSS", "BSN",
    ],
    noise: [
      "sign-on bonus", "403(b)", "PTO", "tuition reimbursement", "Magnet",
      "Cedar Ridge Health", "Equal Opportunity", "differential", "dental", "vision",
      "E-Verify", "parking", "orientation", "preceptor",
    ],
    resume: {
      name: "Rosalind Achebe",
      email: "rosalind.achebe@example.com",
      phone: "555-0198",
      location: "Columbus, OH",
      summary:
        "Critical care nurse with five years in a 20-bed adult ICU, comfortable with the sickest assignment on the unit and currently precepting new-graduate nurses on nights.",
      experience: [
        {
          role: "Registered Nurse",
          company: "Riverbend Regional Medical Center",
          startDate: "2021-03",
          endDate: null,
          current: true,
          bullets: [
            "Carried a 1:2 critical care assignment on nights in a 20-bed adult ICU, escalating through the rapid response pathway on deterioration.",
            "Provided ventilator management for intubated patients alongside respiratory therapy, including daily weaning trials and extubation readiness screens.",
            "Ran the sepsis bundle inside the three-hour window on 96% of qualifying patients over the last review cycle.",
            "Performed hemodynamic monitoring including central venous pressure, and documented the response to every titration hourly.",
            "Co-led the unit CLABSI prevention push, cutting the line-infection rate from 1.8 to 0.4 per thousand line days.",
          ],
        },
        {
          role: "Registered Nurse",
          company: "Saint Alma Hospital",
          startDate: "2019-06",
          endDate: "2021-02",
          bullets: [
            "Delivered direct patient care on a 28-bed step-down telemetry unit with a 1:4 assignment.",
            "Charted every assessment and medication administration in Epic within the shift.",
            "Gave and received bedside handoff using SBAR and served on the unit practice council.",
          ],
        },
      ],
      education: [
        {
          degree: "B.S.N.",
          field: "Nursing",
          school: "State University",
          startDate: "2015-09",
          endDate: "2019-05",
        },
      ],
      skills: [
        {
          category: "Clinical",
          skills: ["critical care", "ventilator management", "hemodynamic monitoring", "sepsis bundle", "rapid response"],
        },
        { category: "Systems", skills: ["Epic", "medication administration", "SBAR"] },
      ],
      certifications: [
        { name: "BLS", organization: "American Heart Association", dateObtained: "2024-04" },
        { name: "ACLS", organization: "American Heart Association", dateObtained: "2024-04" },
        { name: "RN License (Ohio)", organization: "Ohio Board of Nursing", dateObtained: "2019-07" },
      ],
    },
  },
  {
    career: "HARD accountant",
    targetRole: "Senior Accountant",
    jobDescription: `Senior Accountant — Halcyon Brands (Hybrid, three days in office)

About Halcyon Brands
Halcyon Brands owns and operates six consumer packaged-goods labels across food
and household categories, with about $410M in annual revenue and 1,200 employees.
We were built by acquisition between 2014 and 2021 and are now doing the less
glamorous work of making six sets of books behave like one. The accounting team
is fourteen people and reports to a Controller who came up through audit and
still reads every reconciliation.

About the Role
This is a hands-on senior seat on a small team, not a supervisory one, though you
will review the work of two staff accountants. Our close is currently eight
business days and we want it at five within a year — that is the single clearest
mandate attached to this role. You will own the close for two of the six labels
end to end. Everything we do is on a US GAAP basis, and we are in the middle of a
long-overdue clean-up of how we recognise revenue on our distributor contracts,
so a working knowledge of ASC 606 will matter from your first month rather than
in some theoretical future.

What you will do
- Own the month-end close for two operating labels, including the close calendar,
  the checklist and the sign-offs
- Prepare and review journal entries, accruals and prepaid amortisation schedules
- Maintain the general ledger and the chart of accounts, and enforce the mapping
  discipline that keeps consolidated reporting honest
- Perform and review bank reconciliations across eleven operating accounts
- Manage the fixed assets subledger, including additions, disposals and
  depreciation runs
- Support revenue recognition work on distributor and co-manufacturing contracts
- Prepare monthly variance analysis against budget and explain the drivers to
  non-finance stakeholders in plain language
- Act as a primary contact for audit support during the annual external audit
- Assist with the accounts payable and accounts receivable teams at close,
  including cut-off testing and the aging review

Requirements
- Bachelor's degree in accounting or finance
- 4+ years of progressive accounting experience, at least two in a multi-entity
  environment
- Strong US GAAP knowledge and the judgement to know when to ask
- Demonstrated ownership of a month-end close, not just participation in one
- Advanced Excel — pivot tables, lookups, and the discipline not to hard-code
- Experience with a mid-market ERP; NetSuite strongly preferred
- Clear written communication with people who do not read financial statements

Preferred / Nice to have
- CPA or active candidacy
- ASC 606 revenue recognition experience in a distributor or wholesale model
- SOX or internal-controls documentation experience
- Multi-state sales tax exposure
- Prior experience in consumer packaged goods, food manufacturing or retail
- Experience through a system migration or a close-cycle compression project

Compensation and Benefits
- $105,000 - $128,000 depending on experience, plus an annual bonus target of 10%
- 401(k) with a 5% match after six months
- Medical, dental and vision, with the employee premium fully covered
- Twenty days PTO plus eleven paid holidays and a paid week between Christmas and
  New Year
- CPA exam and CPE reimbursement, and a study-leave allowance
- Annual wellness stipend and a hybrid schedule of three days in office

Equal Employment Opportunity
Halcyon Brands is an Equal Opportunity Employer. All qualified applicants will
receive consideration for employment without regard to race, color, religion,
sex, sexual orientation, gender identity, national origin, age, disability,
veteran status, or any other legally protected characteristic. We provide
reasonable accommodation to applicants with disabilities. Halcyon Brands
participates in E-Verify. This posting is not a contract of employment and the
stated range is not a guarantee of any particular offer.`,
    real: [
      "month-end close", "GAAP", "journal entries", "general ledger",
      "bank reconciliations", "fixed assets", "revenue recognition",
      "variance analysis", "audit support", "accounts payable",
      "accounts receivable", "Excel", "NetSuite", "ASC 606", "CPA", "SOX",
      "sales tax", "accruals",
    ],
    noise: [
      "401(k)", "PTO", "CPE", "Halcyon Brands", "Equal Opportunity", "hybrid",
      "dental", "vision", "wellness stipend", "bonus", "holidays", "E-Verify",
      "study-leave allowance", "Controller",
    ],
    resume: {
      name: "Teodora Vlasic",
      email: "teodora.vlasic@example.com",
      phone: "555-0164",
      location: "Chicago, IL",
      summary:
        "Senior Accountant with six years owning the month-end close in a multi-entity manufacturer, working on a US GAAP basis and reviewing the work of two staff accountants.",
      experience: [
        {
          role: "Senior Accountant",
          company: "Ridgeline Manufacturing",
          startDate: "2021-01",
          endDate: null,
          current: true,
          bullets: [
            "Owned the month-end close for three legal entities, cutting the cycle from eleven business days to six over two years.",
            "Prepared and reviewed journal entries, accruals and prepaid amortisation schedules ahead of every close.",
            "Maintained the general ledger and the chart of accounts across a multi-entity consolidation, enforcing the account mapping.",
            "Performed and reviewed bank reconciliations across nine operating accounts, clearing variances within two business days.",
            "Ran the fixed assets subledger end to end, including additions, disposals and monthly depreciation.",
          ],
        },
        {
          role: "Staff Accountant",
          company: "Ridgeline Manufacturing",
          startDate: "2019-04",
          endDate: "2020-12",
          bullets: [
            "Produced monthly variance analysis against budget and presented the drivers to operations managers.",
            "Owned accounts payable for roughly 400 vendor invoices a month, cutting late payments by 60%.",
            "Served as a primary contact for audit support during two annual external audits with no adjustments proposed.",
            "Rebuilt the depreciation and prepaid schedules in Excel, removing eight hours of manual work per period.",
          ],
        },
        {
          role: "Accounting Clerk",
          company: "Harborview Supply",
          startDate: "2017-08",
          endDate: "2019-03",
          bullets: [
            "Coded and entered vendor invoices and expense reports against a US GAAP chart of accounts.",
            "Assisted with fixed-asset tagging and quarterly inventory counts.",
          ],
        },
      ],
      education: [
        {
          degree: "B.S.",
          field: "Accounting",
          school: "State University",
          startDate: "2013-09",
          endDate: "2017-05",
        },
      ],
      skills: [
        {
          category: "Accounting",
          skills: ["month-end close", "general ledger", "journal entries", "bank reconciliations", "fixed assets", "accruals", "GAAP"],
        },
        { category: "Analysis", skills: ["variance analysis", "audit support", "accounts payable"] },
        { category: "Tools", skills: ["Excel", "Sage Intacct", "SQL"] },
      ],
    },
  },
]

// ─── Provable-claim scoring ─────────────────────────────────────────────────

/**
 * "The resume contains the term." Whole-token and case-insensitive, the same
 * predicate every grounding surface in this repo uses, so `Excel` inside
 * `Excellent` does not count as containing `Excel`.
 */
function resumeContains(resumeText: string, term: string): boolean {
  return classifyKeywordEvidence(term, resumeText).verdict === "supported"
}

/**
 * A side "reported" a requirement when it listed that term or a LONGER phrase
 * containing it whole-token — `grounding-coverage-check.ts` already treats
 * "cold chain handling" for "cold chain" as a pass, not a regression. The
 * relation is pure string work and is applied identically to both sides.
 */
function reported(listed: readonly string[], term: string): boolean {
  return listed.some((item) => resumeContains(item, term))
}

interface SideScore {
  listed: string[]
  falsePositives: string[]
  misses: string[]
  /** Listed terms that are posting furniture, not requirements. */
  boilerplate: string[]
}

function scoreSide(
  listed: readonly string[],
  resumeText: string,
  real: readonly string[],
  noise: readonly string[] = []
): SideScore {
  return {
    listed: [...listed],
    falsePositives: listed.filter((term) => resumeContains(resumeText, term)),
    misses: real.filter(
      (term) => !resumeContains(resumeText, term) && !reported(listed, term)
    ),
    // A listed term counts as boilerplate when it IS, or CONTAINS, a term from
    // the fixture's hand-written noise list — "unlimited PTO" catches on "PTO".
    boilerplate: listed.filter((term) =>
      noise.some(
        (item) =>
          term.toLowerCase().trim() === item.toLowerCase().trim() ||
          resumeContains(term, item)
      )
    ),
  }
}

/**
 * Split a posting into the region a requirement can legitimately come from and
 * the region it cannot: the "About us" blurb, the hiring-process description,
 * the benefits list and the EEO block.
 *
 * The section headings are structural and were written into these postings
 * before any of them was run, so this is not a metric fitted to a result. A term
 * that occurs ONLY in the furniture region and never in the requirements region
 * is, by construction, not a requirement of the job.
 */
const FURNITURE_HEADING =
  /^(?:About Us|About Cedar Ridge|About Halcyon Brands|How We Hire|Benefits and Perks|Compensation and Benefits|Equal Employment Opportunity)\s*$/m

function splitRegions(jobDescription: string): { requirements: string; furniture: string } {
  const lines = jobDescription.split(/\r?\n/)
  const requirements: string[] = []
  const furniture: string[] = []
  let inFurniture = false

  for (const line of lines) {
    if (FURNITURE_HEADING.test(line)) {
      inFurniture = true
      furniture.push(line)
      continue
    }
    // A non-furniture heading ends the furniture region. Headings are the short,
    // unpunctuated, non-bullet lines in these postings.
    const isHeading =
      /^[A-Z][^.!?]{2,45}$/.test(line.trim()) && !/^[-*]/.test(line.trim())
    if (inFurniture && isHeading) inFurniture = false
    ;(inFurniture ? furniture : requirements).push(line)
  }

  return { requirements: requirements.join("\n"), furniture: furniture.join("\n") }
}

/**
 * Listed terms that appear ONLY in the posting's furniture. This is the honest
 * boilerplate count; the hand-written `noise[]` list catches the CONCEPTS
 * ("PTO", "tuition reimbursement") and systematically misses the single leading
 * words an extractor actually emits from a benefits line ("Twenty", "Free").
 */
function furnitureOnly(
  listed: readonly string[],
  jobDescription: string
): string[] {
  const { requirements, furniture } = splitRegions(jobDescription)
  return listed.filter(
    (term) => resumeContains(furniture, term) && !resumeContains(requirements, term)
  )
}

function overlap(a: readonly string[], b: readonly string[]): string[] {
  const bLower = new Set(b.map((term) => term.toLowerCase().trim()))
  return a.filter((term) => bLower.has(term.toLowerCase().trim()))
}

// ─── Live side, cached ──────────────────────────────────────────────────────

const DEFAULT_CACHE = join(tmpdir(), "rolespec-ats-keyword-determinism-cache.json")

type Cache = Record<string, ATSAnalysisResult>

function readCache(path: string): Cache {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Cache
  } catch {
    return {}
  }
}

function writeCache(path: string, cache: Cache): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cache, null, 2), "utf8")
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

// ─── Report ─────────────────────────────────────────────────────────────────

function rule() {
  console.log("-".repeat(78))
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)"
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const deterministicOnly = process.argv.includes("--deterministic")
  const refresh = process.argv.includes("--refresh")
  const hard = process.argv.includes("--hard")
  const cachePath = argValue("--cache") ?? DEFAULT_CACHE
  const suite = hard ? HARD_FIXTURES : FIXTURES

  console.log(
    hard
      ? "REGIME: HARD — long, boilerplate-heavy, inconsistently formatted postings"
      : "REGIME: CLEAN — short, cleanly bulleted postings (grounding-coverage-check.ts)"
  )

  const cache: Cache = refresh ? {} : readCache(cachePath)
  let userId: string | null = null

  if (!deterministicOnly) {
    userId = await resolveUserId()
    const config = await getEffectiveAiConfigForUser(userId)
    console.log(`user=${userId} provider=${config.provider} model=${config.model}`)
    console.log(`cache=${cachePath}`)
    rule()
  }

  const rows: {
    career: string
    detFp: number
    detMiss: number
    detListed: number
    detScore: number
    aiFp: number
    aiMiss: number
    aiListed: number
    aiScore: number | null
    shared: number
    detNoise: number
    aiNoise: number
  }[] = []

  for (const fixture of suite) {
    const sections = buildSections(fixture.career.toLowerCase().replace(/\W+/g, "-"), fixture.resume)
    const resumeText = serializeSections(sections)

    const det = scoreKeywords(resumeText, fixture.jobDescription, fixture.targetRole)
    const detScored = scoreSide(det.missingKeywords, resumeText, fixture.real, fixture.noise)

    console.log(`\n### ${fixture.career} — target role "${fixture.targetRole}"`)
    // Both sides must see the same text or a "drop" is truncation, not reading.
    // 6000 is MAX_RESUME_TEXT_LENGTH in ats-analyze.ts.
    console.log(
      `  input: jd=${fixture.jobDescription.length} chars, resume=${resumeText.length} chars` +
        (fixture.jobDescription.length > 6000 || resumeText.length > 6000
          ? "  *** TRUNCATED BEFORE THE MODEL — comparison invalid ***"
          : "  (neither truncated)")
    )
    console.log(`  DETERMINISTIC`)
    console.log(`    scored=${det.scored} keywordScore=${det.keywordScore}`)
    console.log(
      `    title: jd="${det.jobTitle}" resume="${det.resumeTitle}" score=${det.titleScore === null ? "n/a" : det.titleScore.toFixed(2)}`
    )
    console.log(`    coverage=${det.coverage.toFixed(3)} over ${det.details.length} extracted terms`)
    console.log(`    matched (exact): ${list(det.matchedKeywords)}`)
    console.log(`    near (plural/hyphen): ${list(det.details.filter((d) => d.kind === "near").map((d) => `${d.keyword} -> ${d.matchedAs}`))}`)
    console.log(`    partial: ${list(det.partialKeywords)}`)
    console.log(`    missingKeywords: ${list(det.missingKeywords)}`)
    console.log(`    PROVABLE FALSE POSITIVES: ${detScored.falsePositives.length} ${list(detScored.falsePositives)}`)
    console.log(`    PROVABLE MISSES: ${detScored.misses.length} ${list(detScored.misses)}`)
    const nearSuppressed = detScored.misses.filter((miss) =>
      det.details.some(
        (detail) => detail.kind === "near" && resumeContains(detail.keyword, miss)
      )
    )
    if (nearSuppressed.length > 0) {
      console.log(
        `      ...of which suppressed as a near match, not overlooked: ${list(nearSuppressed)}`
      )
    }
    const detFurniture = fixture.noise
      ? furnitureOnly(det.missingKeywords, fixture.jobDescription)
      : []
    if (fixture.noise) {
      console.log(
        `    BOILERPLATE, noise[] list: ${detScored.boilerplate.length} ${list(detScored.boilerplate)}`
      )
      console.log(
        `    BOILERPLATE, furniture-region: ${detFurniture.length} ${list(detFurniture)}`
      )
    }

    if (deterministicOnly) {
      rows.push({
        career: fixture.career,
        detFp: detScored.falsePositives.length,
        detMiss: detScored.misses.length,
        detListed: det.missingKeywords.length,
        detScore: det.keywordScore,
        aiFp: -1,
        aiMiss: -1,
        aiListed: -1,
        aiScore: null,
        shared: -1,
        detNoise: detFurniture.length,
        aiNoise: -1,
      })
      continue
    }

    let ai = cache[fixture.career]
    if (!ai) {
      console.log(`  MODEL — live call (not cached)`)
      ai = await analyzeResumeATS(sections, {
        targetRole: fixture.targetRole,
        jobDescription: fixture.jobDescription,
        mode: "job-match",
        userId: userId as string,
      })
      cache[fixture.career] = ai
      writeCache(cachePath, cache)
    } else {
      console.log(`  MODEL — from cache`)
    }

    const aiScored = scoreSide(ai.missingKeywords, resumeText, fixture.real, fixture.noise)
    const shared = overlap(det.missingKeywords, ai.missingKeywords)

    console.log(`    keywordScore=${ai.scores.keywords} (overall=${ai.overallScore})`)
    console.log(`    missingKeywords: ${list(ai.missingKeywords)}`)
    console.log(`    PROVABLE FALSE POSITIVES: ${aiScored.falsePositives.length} ${list(aiScored.falsePositives)}`)
    console.log(`    PROVABLE MISSES: ${aiScored.misses.length} ${list(aiScored.misses)}`)
    const aiFurniture = fixture.noise
      ? furnitureOnly(ai.missingKeywords, fixture.jobDescription)
      : []
    if (fixture.noise) {
      console.log(
        `    BOILERPLATE, noise[] list: ${aiScored.boilerplate.length} ${list(aiScored.boilerplate)}`
      )
      console.log(
        `    BOILERPLATE, furniture-region: ${aiFurniture.length} ${list(aiFurniture)}`
      )
    }
    console.log(`  OVERLAP`)
    console.log(`    both listed (${shared.length}): ${list(shared)}`)
    console.log(`    deterministic only: ${list(det.missingKeywords.filter((t) => !overlap([t], ai.missingKeywords).length))}`)
    console.log(`    model only: ${list(ai.missingKeywords.filter((t) => !overlap([t], det.missingKeywords).length))}`)
    // This harness only runs job-match, so the model keyword score is always a
    // number; quality analyses return null and have no delta to report.
    const aiKeywordScore = ai.scores.keywords
    console.log(
      `    keyword sub-score delta (det - model): ${
        aiKeywordScore === null ? "n/a" : det.keywordScore - aiKeywordScore
      }`
    )

    rows.push({
      career: fixture.career,
      detFp: detScored.falsePositives.length,
      detMiss: detScored.misses.length,
      detListed: det.missingKeywords.length,
      detScore: det.keywordScore,
      aiFp: aiScored.falsePositives.length,
      aiMiss: aiScored.misses.length,
      aiListed: ai.missingKeywords.length,
      aiScore: ai.scores.keywords,
      shared: shared.length,
      detNoise: detFurniture.length,
      aiNoise: aiFurniture.length,
    })
  }

  rule()
  console.log("SUMMARY  (FP = provable false positives, MISS = provable misses vs the fixture's real[] list)")
  console.log("")
  const pad = (value: string | number, width: number) => String(value).padEnd(width)
  console.log(
    `${pad("career", 18)}${pad("det FP", 8)}${pad("ai FP", 7)}${pad("det MISS", 10)}${pad("ai MISS", 9)}${pad("det NOISE", 11)}${pad("ai NOISE", 10)}${pad("det n", 7)}${pad("ai n", 6)}${pad("shared", 8)}${pad("det score", 11)}${pad("ai score", 9)}`
  )
  const cell = (value: number) => (value < 0 ? "-" : value)
  for (const row of rows) {
    console.log(
      `${pad(row.career, 18)}${pad(row.detFp, 8)}${pad(cell(row.aiFp), 7)}${pad(row.detMiss, 10)}${pad(cell(row.aiMiss), 9)}${pad(cell(row.detNoise), 11)}${pad(cell(row.aiNoise), 10)}${pad(row.detListed, 7)}${pad(cell(row.aiListed), 6)}${pad(cell(row.shared), 8)}${pad(row.detScore, 11)}${pad(row.aiScore ?? "-", 9)}`
    )
  }
  const sum = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((total, row) => total + Math.max(0, pick(row)), 0)
  const live = rows[0].aiFp >= 0
  console.log(
    `${pad("TOTAL", 18)}${pad(sum((r) => r.detFp), 8)}${pad(live ? sum((r) => r.aiFp) : "-", 7)}${pad(sum((r) => r.detMiss), 10)}${pad(live ? sum((r) => r.aiMiss) : "-", 9)}${pad(sum((r) => r.detNoise), 11)}${pad(live ? sum((r) => r.aiNoise) : "-", 10)}`
  )
  rule()
  console.log(
    "Reminder: the deterministic side's FP count is zero BY CONSTRUCTION — it decides\n" +
      '"missing" with the same whole-token predicate this metric checks. The FP column is a\n' +
      "measurement of the MODEL. The fair comparison is the MISS column, scored against the\n" +
      "hand-written real[] requirement list of each posting."
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
