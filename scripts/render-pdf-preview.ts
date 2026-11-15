/**
 * Dev-only PDF preview renderer.
 *
 * Usage:
 *   npx tsx scripts/render-pdf-preview.ts [template ...] [flags]
 *
 * Flags (all optional; defaults preserve the original behavior):
 *   --resume=<id>          Pull sections from the dev DB instead of the fixture
 *   --margins=<compact|normal|relaxed>
 *   --line-height=<snug|normal|relaxed>
 *   --font-scale=<0.9|1|1.1>
 *   --density=<normal|compact>
 *   --text-align=<left|center|right|justify>
 *   --suffix=<name>        Output file suffix: <TEMPLATE>-<name>.pdf
 *
 * Renders a sample resume through the real export service
 * (src/features/export/services/generate-pdf.ts) and writes one PDF per
 * template to scripts/pdf-preview/. No AI call and
 * no Blob upload — unlike the production server action. DB access is
 * read-only and only when --resume is given.
 *
 * Templates: MINIMAL, MODERN, HARVARD, CORPORATE (default: all four).
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import {
  DEFAULT_CUSTOMIZATION,
  type ResumeCustomization,
} from "@/features/resume/types/customization"
import { generatePdf } from "@/features/export/services/generate-pdf"

const TEMPLATES = ["MINIMAL", "MODERN", "HARVARD", "CORPORATE"] as const

const OUT_DIR = path.join(process.cwd(), "scripts", "pdf-preview")

/** Sample resume, shaped like the store's Section[] (see the pdf template tests). */
const sections: Section[] = [
  {
    id: "s1",
    resumeId: "preview",
    type: "CONTACT",
    title: "Contact",
    order: 0,
    visible: true,
    items: [
      {
        id: "i1",
        sectionId: "s1",
        content: {
          fullName: "Ada Lovelace",
          jobTitle: "Senior Software Engineer",
          email: "ada@example.com",
          phone: "+44 20 7946 0958",
          location: "London, UK",
          linkedin: "linkedin.com/in/ada",
          github: "github.com/ada",
        },
        order: 0,
      },
    ],
  },
  {
    id: "s2",
    resumeId: "preview",
    type: "SUMMARY",
    title: "Summary",
    order: 1,
    visible: true,
    items: [
      {
        id: "i2",
        sectionId: "s2",
        content: {
          text: "Engineer with ten years building analytical systems for research institutions and industrial partners across three countries. Led the team that shipped the first published program and cut batch computation time by 40% while reducing the operational error rate to under one incident per quarter. Comfortable owning a system end to end — from the mathematical model and the notation it is expressed in, through the compilation pipeline, to the operator training material — and equally comfortable stepping back to mentor the engineers who will own it next. Known for turning ambiguous research requirements into precise, verifiable specifications that survive contact with real hardware.",
        },
        order: 0,
      },
    ],
  },
  {
    id: "s3",
    resumeId: "preview",
    type: "EXPERIENCE",
    title: "Experience",
    order: 2,
    visible: true,
    items: [
      {
        id: "i3",
        sectionId: "s3",
        content: {
          role: "Senior Engineer",
          company: "Analytical Engines",
          location: "London, UK",
          startDate: "2020",
          endDate: "Present",
          current: true,
          bullets: [
            "Shipped the first published program, adopted by 12 downstream teams across the research division, and wrote the accompanying operator handbook that reduced onboarding time for new machine operators from six weeks to nine days.",
            "Rebuilt the punch-card ingestion and verification pipeline from the ground up, cutting batch computation time by 40%, eliminating an entire class of transcription errors, and freeing two full-time verifiers to move onto higher-value analytical work.",
            "Mentored four engineers through their first production launches; two were promoted within a year and one now leads the verification group.",
            "Designed and ran the quarterly capacity-planning exercise that correctly predicted the 1843 workload spike, allowing the team to commission a second engine three months before demand would have overwhelmed the first.",
            "Introduced a peer-review protocol for all published tables, which caught 31 defects before publication in its first year and became the institutional standard for every research group in the building.",
          ],
        },
        order: 0,
      },
      {
        id: "i4",
        sectionId: "s3",
        content: {
          role: "Engineer",
          company: "Difference Works",
          location: "London, UK",
          startDate: "2016",
          endDate: "2020",
          bullets: [
            "Designed the notation used across three research groups, replacing four incompatible ad-hoc conventions with a single scheme that survived two subsequent hardware generations without amendment.",
            "Automated verification of 200+ tabulated results, building a comparison harness that cross-checked every published figure against two independent computations and flagged discrepancies for human review.",
            "Reduced the average turnaround for a requested table from eleven days to four by re-sequencing the card preparation workflow and eliminating a redundant transcription step.",
            "Wrote the internal course on machine arithmetic taken by every incoming engineer, covering error propagation, carry handling, and the practical limits of mechanical precision.",
          ],
        },
        order: 1,
      },
      {
        id: "i4b",
        sectionId: "s3",
        content: {
          role: "Analyst",
          company: "Royal Computation Bureau",
          location: "Cambridge, UK",
          startDate: "2014",
          endDate: "2016",
          bullets: [
            "Produced the bureau's annual astronomical tables two months ahead of schedule by parallelising the computation across three operator teams with a hand-off protocol that prevented duplicated work.",
            "Audited five years of archived navigation tables and identified 17 propagated errors, publishing corrections that were adopted by the Admiralty within the same year.",
            "Built the bureau's first standardised error-reporting form, cutting the average time from error discovery to published correction from four months to three weeks.",
            "Presented quarterly findings to a mixed audience of mathematicians, naval officers, and instrument makers, translating between the three groups' vocabularies.",
          ],
        },
        order: 2,
      },
      {
        id: "i4c",
        sectionId: "s3",
        content: {
          role: "Junior Analyst",
          company: "Somerville & Partners",
          location: "London, UK",
          startDate: "2012",
          endDate: "2014",
          bullets: [
            "Checked and re-derived the worked examples for a widely used mathematics textbook, finding and correcting nine errors before the second printing went to press.",
            "Maintained the partners' correspondence index covering 2,000+ letters, introducing a cross-reference scheme still in use a decade later.",
            "Prepared lecture diagrams and computational examples for public science lectures attended by audiences of up to 400 people.",
          ],
        },
        order: 3,
      },
    ],
  },
  {
    id: "s4",
    resumeId: "preview",
    type: "EDUCATION",
    title: "Education",
    order: 3,
    visible: true,
    items: [
      {
        id: "i5",
        sectionId: "s4",
        content: {
          school: "University of London",
          degree: "BSc",
          field: "Mathematics",
          startDate: "2012",
          endDate: "2016",
          gpa: "3.9",
        },
        order: 0,
      },
    ],
  },
  {
    id: "s5",
    resumeId: "preview",
    type: "SKILLS",
    title: "Skills",
    order: 4,
    visible: true,
    items: [
      {
        id: "i6",
        sectionId: "s5",
        content: { category: "Languages", skills: ["TypeScript", "Rust", "Prolog", "Ada"] },
        order: 0,
      },
      {
        id: "i7",
        sectionId: "s5",
        content: { category: "Tools", skills: ["Postgres", "Docker", "Playwright"] },
        order: 1,
      },
    ],
  },
  {
    id: "s6",
    resumeId: "preview",
    type: "PROJECTS",
    title: "Projects",
    order: 5,
    visible: true,
    items: [
      {
        id: "i8",
        sectionId: "s6",
        content: {
          name: "Note G",
          technologies: ["Bernoulli numbers", "Loop unrolling"],
          url: "example.com/note-g",
          urlLabel: "example.com/note-g",
          startDate: "2015",
          endDate: "2016",
          bullets: ["Documented the first algorithm intended for a machine."],
        },
        order: 0,
      },
    ],
  },
  {
    id: "s7",
    resumeId: "preview",
    type: "CERTIFICATIONS",
    title: "Certifications",
    order: 6,
    visible: true,
    items: [
      {
        id: "i9",
        sectionId: "s7",
        content: { name: "Solutions Architect", organization: "AWS", dateObtained: "2024-06" },
        order: 0,
      },
    ],
  },
]

interface CliOptions {
  templates: string[]
  resumeId?: string
  suffix?: string
  customization: ResumeCustomization
}

function parseArgs(argv: string[]): CliOptions {
  const customization: ResumeCustomization = { ...DEFAULT_CUSTOMIZATION }
  let resumeId: string | undefined
  let suffix: string | undefined
  const templateArgs: string[] = []

  for (const arg of argv) {
    if (arg.startsWith("--resume=")) {
      resumeId = arg.slice("--resume=".length)
    } else if (arg.startsWith("--margins=")) {
      customization.margins = arg.slice("--margins=".length) as ResumeCustomization["margins"]
    } else if (arg.startsWith("--line-height=")) {
      customization.lineHeight = arg.slice("--line-height=".length) as ResumeCustomization["lineHeight"]
    } else if (arg.startsWith("--font-scale=")) {
      customization.fontScale = Number(arg.slice("--font-scale=".length)) as ResumeCustomization["fontScale"]
    } else if (arg.startsWith("--text-align=")) {
      customization.textAlign = arg.slice("--text-align=".length) as ResumeCustomization["textAlign"]
    } else if (arg.startsWith("--density=")) {
      customization.density = arg.slice("--density=".length) as ResumeCustomization["density"]
    } else if (arg.startsWith("--suffix=")) {
      suffix = arg.slice("--suffix=".length)
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`)
    } else {
      templateArgs.push(arg.toUpperCase())
    }
  }

  const unknown = templateArgs.filter((name) => !TEMPLATES.includes(name as (typeof TEMPLATES)[number]))
  if (unknown.length > 0) {
    throw new Error(`Unknown template(s): ${unknown.join(", ")}. Expected one of ${TEMPLATES.join(", ")}`)
  }

  return {
    templates: templateArgs.length > 0 ? templateArgs : [...TEMPLATES],
    resumeId,
    suffix,
    customization,
  }
}

/** Read-only fetch of one resume's sections, shaped like the store's Section[]. */
async function loadSectionsFromDb(resumeId: string): Promise<Section[]> {
  const { prisma } = await import("@/shared/lib/prisma")
  const resume = await prisma.resume.findUnique({
    where: { id: resumeId },
    include: {
      sections: {
        include: { items: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      },
    },
  })
  if (!resume) throw new Error(`Resume not found: ${resumeId}`)
  console.log(`DB resume: "${resume.title}" (template ${resume.template}), ${resume.sections.length} sections`)
  return resume.sections.map((s) => ({
    id: s.id,
    resumeId: s.resumeId,
    type: s.type as Section["type"],
    title: s.title,
    order: s.order,
    visible: s.visible,
    items: s.items.map((item) => ({
      id: item.id,
      sectionId: item.sectionId,
      content: (item.content ?? {}) as Record<string, unknown>,
      order: item.order,
    })),
  }))
}

async function main() {
  const { templates, resumeId, suffix, customization } = parseArgs(process.argv.slice(2))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const renderSections = resumeId ? await loadSectionsFromDb(resumeId) : sections

  for (const template of templates) {
    const buffer = await generatePdf({
      template,
      sections: renderSections,
      metadata: { targetRole: "Senior Software Engineer", targetCompany: "Example Corp" },
      customization,
    })

    const fileName = suffix ? `${template}-${suffix}.pdf` : `${template}.pdf`
    const outPath = path.join(OUT_DIR, fileName)
    fs.writeFileSync(outPath, buffer)
    console.log(`${template} -> ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`)
  }
  if (resumeId) process.exit(0) // prisma keeps the event loop alive
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
