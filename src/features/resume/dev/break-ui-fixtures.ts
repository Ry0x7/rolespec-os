import type { ATSResults, EnhanceSuggestion, ResumeData, Section } from "../hooks/use-resume-store"
import type { ResumeCardData } from "../components/resume-sections"

export type BreakUiFixtureMode = "demo" | "worst" | "empty" | "one" | "huge"

export const BREAK_UI_STRINGS = {
  unbrokenTitle:
    "Principal_Staff_Platform_Architecture_Resume_v42_FINAL_2026_09_18_DoNotDistribute_ApprovedByLegal",
  germanRole:
    "Kraftfahrzeug-Haftpflichtversicherungsgesellschafts-Generaldirektorsstellvertreter",
  longPersonName: "Alexandria-Chrysostomé von Hohenzollern-Sigmaringen-Württemberger III",
  rtlName: "محمد بن سلمان آل سعود — Principal Architect (אֲבִיגַיִל)",
  longEmail:
    "alexandria.chrysostome.von.hohenzollern+enterprise-platform-architecture-2026@sub.department.very-long-company-domain-example.org",
  longUrl:
    "https://github.com/organization-with-a-remarkably-long-handle/enterprise-platform-observability-service/pull/48291?tab=checks&check_suite_id=9918273645#step:14:982",
  longFilename:
    "Q3_Board_Deck_FINAL_revised_v12_approved_by_legal_and_platform_architecture_review.pdf",
  longToken:
    "customer-feedback-from-enterprise-onboarding-and-platform-observability-instrumentation-pipeline-v4",
  zalgo: "T̴h̷e̸ ̵q̶u̷i̸c̶k̵ ̴b̷r̸o̶w̵n̷ ̴f̵o̶x̸ — Crème brûlée — 👨‍👩‍👧‍👦🏳️‍🌈",
  longParagraph:
    "Spearheaded the cross-functional re-architecture of a multi-region distributed event streaming platform serving 18,400 enterprise tenants across 42 availability zones, cutting p99 tail latency from 1,420ms to 38ms while eliminating $1,234,567.89 in annual cloud egress overhead and maintaining 99.999% SLA compliance.",
}

function makeContactSection(resumeId: string, worst = true): Section {
  return {
    id: "break-sec-contact",
    resumeId,
    type: "CONTACT",
    title: worst
      ? "Contact & Identity (Kraftfahrzeughaftpflichtversicherungsgesellschaft)"
      : "Contact Information",
    order: 0,
    visible: true,
    items: [
      {
        id: "break-item-contact-1",
        sectionId: "break-sec-contact",
        order: 0,
        content: worst
          ? {
              fullName: BREAK_UI_STRINGS.longPersonName,
              email: BREAK_UI_STRINGS.longEmail,
              phone: "+49 (0) 89 1234567890-998877 ext. 44321",
              location:
                "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch, Anglesey, United Kingdom",
              linkedin: BREAK_UI_STRINGS.longUrl,
              website: BREAK_UI_STRINGS.longUrl,
            }
          : {
              fullName: "A",
              email: "a@b.co",
              phone: "0",
              location: "NY",
            },
      },
    ],
  }
}

function makeWorstSections(resumeId: string, count = 8): Section[] {
  const sections: Section[] = [
    makeContactSection(resumeId, true),
    {
      id: "break-sec-summary",
      resumeId,
      type: "SUMMARY",
      title: "Executive Summary & Donaudampfschifffahrtsgesellschaftskapitän Overview",
      order: 1,
      visible: true,
      items: [
        {
          id: "break-item-summary-1",
          sectionId: "break-sec-summary",
          order: 0,
          content: {
            text: `${BREAK_UI_STRINGS.longParagraph} ${BREAK_UI_STRINGS.rtlName} — ${BREAK_UI_STRINGS.zalgo} — Reference: ${BREAK_UI_STRINGS.longUrl}`,
          },
        },
      ],
    },
    {
      id: "break-sec-experience",
      resumeId,
      type: "EXPERIENCE",
      title: "Professional Experience",
      order: 2,
      visible: true,
      items: [
        {
          id: "break-item-exp-1",
          sectionId: "break-sec-experience",
          order: 0,
          content: {
            company:
              "Donaudampfschifffahrtsgesellschaftskapitänsmützenmanufaktur_Global_Holdings_GmbH_&_Co_KG",
            role: BREAK_UI_STRINGS.germanRole,
            location: "San Francisco / München / تل أبيب / 東京 (Hybrid Remote)",
            startDate: "Jan 2021",
            endDate: "Present",
            current: true,
            bullets: [
              BREAK_UI_STRINGS.longParagraph,
              `Architected ${BREAK_UI_STRINGS.longToken} with zero-downtime migration across ${BREAK_UI_STRINGS.longUrl}`,
              `Led international guild (${BREAK_UI_STRINGS.rtlName}) delivering 99.98% reliability and -$1,234,567.89 cost delta.`,
            ],
          },
        },
        {
          id: "break-item-exp-2",
          sectionId: "break-sec-experience",
          order: 1,
          content: {
            company: "X",
            role: "Y",
            location: "Z",
            startDate: "Feb 2019",
            endDate: "Dec 2020",
            current: false,
            bullets: ["Single short bullet."],
          },
        },
      ],
    },
    {
      id: "break-sec-education",
      resumeId,
      type: "EDUCATION",
      title: "Education & Academic Credentials",
      order: 3,
      visible: true,
      items: [
        {
          id: "break-item-edu-1",
          sectionId: "break-sec-education",
          order: 0,
          content: {
            school:
              "Rheinisch-Westfälische Technische Hochschule Aachen — Fakultät für Mathematik, Informatik und Naturwissenschaften",
            degree: "Master of Science (M.Sc.) / Diplom-Ingenieurin",
            field:
              "Distributed Fault-Tolerant Consensus Systems & High-Dimensional Numerical Optimization",
            startDate: "Sep 2015",
            endDate: "Jul 2019",
            gpa: "4.00 / 4.00 (Summa Cum Laude)",
          },
        },
      ],
    },
    {
      id: "break-sec-skills",
      resumeId,
      type: "SKILLS",
      title: "Skills & Technical Competencies",
      order: 4,
      visible: true,
      items: [
        {
          id: "break-item-skills-1",
          sectionId: "break-sec-skills",
          order: 0,
          content: {
            category:
              "Distributed_Systems_&_Kraftfahrzeughaftpflichtversicherungsgesellschaft_Infrastructure",
            skills: [
              "TypeScript",
              "Kubernetes",
              BREAK_UI_STRINGS.longToken,
              "PostgreSQL",
              "Rust",
              "OpenTelemetry",
              "gRPC-Web-Protobuf-Codegen-v4",
              "React 19",
              "Next.js 16",
              "TailwindCSS",
              " Terraform/OpenTofu ",
              "ebpf-kernel-tracing-and-continuous-profiling-pipeline",
              "GraphQL Federation",
              "Apache Kafka",
              "ClickHouse",
              "Redis Cluster",
              "AWS/GCP/Azure Multi-Region",
              "Zero-Trust mTLS Service Mesh",
            ],
          },
        },
      ],
    },
    {
      id: "break-sec-projects",
      resumeId,
      type: "PROJECTS",
      title: "Selected Open-Source & Architecture Projects",
      order: 5,
      visible: true,
      items: [
        {
          id: "break-item-proj-1",
          sectionId: "break-sec-projects",
          order: 0,
          content: {
            name: "Enterprise_Observability_Mesh_&_Zero_Allocation_Telemetry_Router_v12",
            url: BREAK_UI_STRINGS.longUrl,
            urlLabel:
              "github.com/organization-with-a-remarkably-long-handle/enterprise-platform-observability-service",
            startDate: "Mar 2022",
            endDate: "Present",
            bullets: [
              BREAK_UI_STRINGS.longParagraph,
              `Published benchmark suite at ${BREAK_UI_STRINGS.longUrl}`,
            ],
            technologies: [
              "Rust",
              "eBPF",
              BREAK_UI_STRINGS.longToken,
              "WebAssembly",
              "OpenTelemetry-Collector-Contrib-Custom-Distribution",
            ],
          },
        },
      ],
    },
    {
      id: "break-sec-certs",
      resumeId,
      type: "CERTIFICATIONS",
      title: "Certifications & Licenses",
      order: 6,
      visible: true,
      items: [
        {
          id: "break-item-cert-1",
          sectionId: "break-sec-certs",
          order: 0,
          content: {
            name: "Certified Kubernetes Security & Multi-Cluster Federation Architect (CKSMFA-Pro-Extreme-2026)",
            organization:
              "Cloud Native Computing Foundation & Linux Foundation Training Certification Board",
            dateObtained: "May 2024",
            expirationDate: "May 2027",
            credentialId:
              "LF-CKSMFA-2024-00998877665544332211-VERIFIED-CREDENTIAL-HASH-SHA256",
          },
        },
      ],
    },
  ]

  for (let i = sections.length; i < count; i++) {
    sections.push({
      id: `break-sec-custom-${i}`,
      resumeId,
      type: "CUSTOM",
      title:
        i === 7
          ? "Publications_Patents_&_International_Standards_Committee_Contributions_v2026"
          : `Custom Section ${i - 6}: ${BREAK_UI_STRINGS.germanRole.slice(0, 48)}`,
      order: i,
      visible: true,
      items: [
        {
          id: `break-item-custom-${i}-1`,
          sectionId: `break-sec-custom-${i}`,
          order: 0,
          content: {
            title: `Keynote & Patent #${i}: ${BREAK_UI_STRINGS.unbrokenTitle}`,
            content: `${BREAK_UI_STRINGS.longParagraph}\n${BREAK_UI_STRINGS.longUrl}`,
          },
        },
      ],
    })
  }

  return sections
}

export const BREAK_UI_ATS_RESULTS: ATSResults = {
  overallScore: 68,
  mode: "job-match",
  scores: {
    formatting: 84,
    keywords: 61,
    impact: 72,
    completeness: 78,
    readability: 65,
  },
  missingKeywords: [
    "distributed-consensus-raft-paxos-replication-protocol",
    BREAK_UI_STRINGS.longToken,
    "finops-cloud-cost-attribution",
    "service-level-objectives",
    "chaos-engineering",
    " incident-command-system ",
  ],
  issues: [
    {
      severity: "critical",
      category: "Keywords",
      section: "Experience",
      message: `Missing exact match for high-priority requirement token ${BREAK_UI_STRINGS.longToken} in Experience bullets.`,
      suggestion: `Incorporate grounded evidence for ${BREAK_UI_STRINGS.longToken} or reference ${BREAK_UI_STRINGS.longUrl}.`,
    },
    {
      severity: "warning",
      category: "Formatting",
      section: "Skills",
      message:
        "Category title Distributed_Systems_&_Kraftfahrzeughaftpflichtversicherungsgesellschaft_Infrastructure is unusually long for two-column ATS parsers.",
      suggestion: "Split into two concise skill categories under 40 characters each.",
    },
    {
      severity: "info",
      category: "Content",
      section: "Executive Summary",
      message: "Summary exceeds 45 words and contains mixed-direction scripts.",
    },
  ],
  suggestions: [
    {
      category: "Impact",
      title: `Quantify throughput for ${BREAK_UI_STRINGS.unbrokenTitle}`,
      description: BREAK_UI_STRINGS.longParagraph,
      priority: "high",
    },
  ],
}

export const BREAK_UI_ENHANCE_SUGGESTIONS: EnhanceSuggestion[] = [
  {
    id: "break-enh-1",
    sectionId: "break-sec-experience",
    itemId: "break-item-exp-1",
    field: "bullet",
    bulletIndex: 0,
    action: "rewrite",
    original: BREAK_UI_STRINGS.longParagraph,
    suggested: `${BREAK_UI_STRINGS.longParagraph} Validated via ${BREAK_UI_STRINGS.longToken}.`,
    reason: `Surfaces keyword ${BREAK_UI_STRINGS.longToken} from job target.`,
    status: "pending",
  },
]

export function buildBreakUiEditorResume(
  base: ResumeData,
  mode: Exclude<BreakUiFixtureMode, "demo">
): {
  resume: ResumeData
  atsResults: ATSResults | null
  enhanceSuggestions: EnhanceSuggestion[] | null
} {
  if (mode === "empty") {
    return {
      resume: {
        ...base,
        title: "Empty Resume (0 Sections)",
        targetRole: null,
        targetCompany: null,
        jobDescription: null,
        atsScore: null,
        latestAnalysis: null,
        sections: [],
      },
      atsResults: null,
      enhanceSuggestions: null,
    }
  }

  if (mode === "one") {
    return {
      resume: {
        ...base,
        title: "A",
        targetRole: "B",
        targetCompany: "C",
        jobDescription: "Short JD.",
        atsScore: 100,
        sections: [makeContactSection(base.id, false)],
      },
      atsResults: null,
      enhanceSuggestions: null,
    }
  }

  const sectionCount = mode === "huge" ? 12 : 8
  return {
    resume: {
      ...base,
      title: BREAK_UI_STRINGS.unbrokenTitle,
      targetRole: `${BREAK_UI_STRINGS.germanRole} (${BREAK_UI_STRINGS.rtlName})`,
      targetCompany:
        "Donaudampfschifffahrtsgesellschaftskapitänsmützenmanufaktur_Global_Holdings",
      variant: "JOB_TAILORED",
      roleFamilyName:
        "Principal_Distributed_Systems_&_Platform_Reliability_Architecture_Family",
      sourceResume: {
        id: base.id,
        title: `Source_${BREAK_UI_STRINGS.unbrokenTitle}`,
        status: "ACTIVE",
      },
      jobDescription: `${BREAK_UI_STRINGS.longParagraph}\nRequired: ${BREAK_UI_STRINGS.longToken}, Kubernetes, TypeScript, Rust, OpenTelemetry.`,
      atsScore: 68,
      latestAnalysis: BREAK_UI_ATS_RESULTS,
      sections: makeWorstSections(base.id, sectionCount),
    },
    atsResults: BREAK_UI_ATS_RESULTS,
    enhanceSuggestions: BREAK_UI_ENHANCE_SUGGESTIONS,
  }
}

export function buildBreakUiBrowserResumes(
  base: ResumeCardData[],
  mode: Exclude<BreakUiFixtureMode, "demo">
): ResumeCardData[] {
  const fallbackId = base[0]?.id ?? "break-ui-resume-1"
  const now = new Date()

  if (mode === "empty") {
    return []
  }

  if (mode === "one") {
    return [
      {
        id: fallbackId,
        title: "A",
        targetRole: "B",
        template: "MINIMAL",
        atsScore: 5,
        updatedAt: now,
        variant: "MASTER",
        origin: null,
        roleFamily: null,
        sourceResume: null,
        jobApplication: null,
        latestAnalysis: { overallScore: 5, mode: "quality" },
      },
    ]
  }

  const worstCards: ResumeCardData[] = [
    {
      id: fallbackId,
      title: BREAK_UI_STRINGS.unbrokenTitle,
      targetRole: BREAK_UI_STRINGS.germanRole,
      template: "HARVARD",
      atsScore: 98,
      updatedAt: now,
      variant: "MASTER",
      origin: "profile",
      roleFamily: null,
      sourceResume: null,
      jobApplication: null,
      latestAnalysis: { overallScore: 98, mode: "quality" },
    },
    {
      id: `${fallbackId}-rf-1`,
      title: `${BREAK_UI_STRINGS.rtlName} — ${BREAK_UI_STRINGS.zalgo}`,
      targetRole:
        "Vice President of Multi-Region Distributed Systems & Platform Observability Engineering",
      template: "EXECUTIVE",
      atsScore: 74,
      updatedAt: now,
      variant: "ROLE_FAMILY",
      origin: null,
      roleFamily: {
        name: "Principal_Distributed_Systems_&_Platform_Reliability_Architecture_Family",
      },
      sourceResume: {
        id: fallbackId,
        title: BREAK_UI_STRINGS.unbrokenTitle,
        status: "ACTIVE",
      },
      jobApplication: null,
      latestAnalysis: { overallScore: 74, mode: "quality" },
    },
    {
      id: `${fallbackId}-jt-1`,
      title: `Tailored_${BREAK_UI_STRINGS.unbrokenTitle}`,
      targetRole: BREAK_UI_STRINGS.germanRole,
      template: "TECH",
      atsScore: 42,
      updatedAt: now,
      variant: "JOB_TAILORED",
      origin: null,
      roleFamily: null,
      sourceResume: {
        id: fallbackId,
        title: BREAK_UI_STRINGS.unbrokenTitle,
        status: "ARCHIVED",
      },
      jobApplication: {
        id: "break-job-1",
        jobTitle: BREAK_UI_STRINGS.germanRole,
        companyName:
          "Donaudampfschifffahrtsgesellschaftskapitänsmützenmanufaktur_Global_Holdings",
      },
      latestAnalysis: { overallScore: 42, mode: "job-match" },
    },
  ]

  if (mode === "worst") {
    return worstCards
  }

  // "huge": 16 cards across all 3 variants + multiple role families to trigger pagination and subheadings
  const huge: ResumeCardData[] = [...worstCards]
  for (let i = 1; i <= 13; i++) {
    huge.push({
      id: `${fallbackId}-huge-${i}`,
      title:
        i % 3 === 0
          ? `${BREAK_UI_STRINGS.unbrokenTitle}_Copy_${i}`
          : `Enterprise Platform Architecture Resume #${i} (${BREAK_UI_STRINGS.germanRole.slice(0, 35)})`,
      targetRole: `Staff Engineer Level ${i} — Distributed Control Planes`,
      template: i % 2 === 0 ? "MODERN" : "CORPORATE",
      atsScore: (i * 17) % 100,
      updatedAt: new Date(now.getTime() - i * 3600_000),
      variant: i % 3 === 0 ? "MASTER" : i % 3 === 1 ? "ROLE_FAMILY" : "JOB_TAILORED",
      origin: i % 3 === 0 ? "profile" : null,
      roleFamily:
        i % 3 === 1
          ? {
              name:
                i % 2 === 0
                  ? "Cloud_Infrastructure_&_Platform_Reliability_Engineering"
                  : "Applied_AI_&_Distributed_Inference_Runtime_Systems",
            }
          : null,
      sourceResume:
        i % 3 !== 0
          ? {
              id: fallbackId,
              title: BREAK_UI_STRINGS.unbrokenTitle,
              status: i % 4 === 0 ? "ARCHIVED" : "ACTIVE",
            }
          : null,
      jobApplication:
        i % 3 === 2
          ? {
              id: `break-job-${i}`,
              jobTitle: `Principal Architect #${i} (${BREAK_UI_STRINGS.longToken.slice(0, 32)})`,
              companyName: `Megacorp_International_Holdings_${i}`,
            }
          : null,
      latestAnalysis: {
        overallScore: (i * 17) % 100,
        mode: i % 3 === 2 ? "job-match" : "quality",
      },
    })
  }
  return huge
}
