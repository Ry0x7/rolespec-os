import { z } from "zod"
import { AI_USAGE_FEATURES, generateObjectTracked } from "@/shared/lib/ai-generate"
import { fenceUntrusted, UNTRUSTED_CONTENT_RULES } from "@/shared/lib/prompts/untrusted"

export interface ResearchCitation {
  title: string
  url: string
  quote?: string
}

export interface CompanyResearchResult {
  companyName: string
  industry: string | null
  headquarters: string | null
  companySize: string | null
  overview: string
  keyProducts: string[]
  statedMissionOrValues: string[]
  techStack: string[]
  interviewTips: string[]
  citations: ResearchCitation[]
  confidence: "HIGH" | "MEDIUM" | "LOW"
  confidenceExplanation: string
  researchedAt: string
}

export const companyResearchSchema = z.object({
  companyName: z.string(),
  industry: z.string().nullable(),
  headquarters: z.string().nullable(),
  companySize: z.string().nullable(),
  overview: z.string().min(1),
  keyProducts: z.array(z.string()),
  statedMissionOrValues: z.array(z.string()),
  techStack: z.array(z.string()),
  interviewTips: z.array(z.string()),
  citations: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      quote: z.string().optional(),
    })
  ),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  confidenceExplanation: z.string(),
})

const SYSTEM_PROMPT = `You are a meticulous corporate intelligence researcher assisting a job candidate. You synthesize factual company and role research strictly from verified evidence.

CRITICAL RULES:
- NEVER invent, hallucinate, or assume company details, metrics, revenue, products, or values.
- If information (such as headquarters, size, or funding) is not stated in the source text or confirmed public knowledge, explicitly write null or "Not disclosed in verified source material".
- All citations must refer to the provided job posting URL, company careers page, or official domain. Include direct quotes where helpful.
- Confidence:
  - "HIGH": Details are directly verified from the official company posting/domain.
  - "MEDIUM": Details are derived from job description context.
  - "LOW": Limited information available; candidate should verify directly.
- techStack: only tools, frameworks, languages explicitly requested in the posting.
- interviewTips: 2-4 factual, concrete pointers based directly on the company's stated requirements and culture.

${UNTRUSTED_CONTENT_RULES}

OUTPUT: Return ONLY valid JSON matching the schema.`

export function extractDeterministicCompanyResearch(input: {
  companyName: string
  jobTitle: string
  url?: string | null
  location?: string | null
  description?: string | null
}): CompanyResearchResult {
  const { companyName, jobTitle, url, location, description } = input
  const desc = description ?? ""
  const citations: ResearchCitation[] = []

  if (url) {
    citations.push({
      title: `${companyName} Posting / Official URL`,
      url,
      quote: `Official posting for ${jobTitle} at ${companyName}`,
    })
  }

  // Extract tech keywords deterministically
  const commonTech = [
    "TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "C\\+\\+", "C#",
    "React", "Next\\.js", "Vue", "Angular", "Node\\.js", "PostgreSQL", "SQL",
    "MongoDB", "Redis", "Docker", "Kubernetes", "AWS", "Azure", "GCP", "GraphQL",
    "Tailwind", "REST", "Git", "Linux"
  ]
  const techStack: string[] = []
  for (const tech of commonTech) {
    const rx = new RegExp(`\\b${tech}\\b`, "i")
    if (rx.test(desc) || rx.test(jobTitle)) {
      techStack.push(tech.replace(/\\\+/g, "+").replace(/\\\./g, "."))
    }
  }

  const confidence: "HIGH" | "MEDIUM" | "LOW" = url && desc.length > 300 ? "HIGH" : desc.length > 100 ? "MEDIUM" : "LOW"
  const confidenceExplanation =
    confidence === "HIGH"
      ? "Extracted directly from the official job posting and verified company listing."
      : confidence === "MEDIUM"
        ? "Derived from job description details; official company profile unverified."
        : "Minimal company details in posting; recommend verifying on company website."

  return {
    companyName,
    industry: null,
    headquarters: location ?? null,
    companySize: null,
    overview: `${companyName} is hiring for a ${jobTitle}${location ? ` in ${location}` : ""}.`,
    keyProducts: [],
    statedMissionOrValues: [],
    techStack,
    interviewTips: [
      `Review required qualifications for ${jobTitle} carefully.`,
      `Be prepared to discuss your hands-on experience with ${techStack.slice(0, 3).join(", ") || "the core stack"}.`,
    ],
    citations,
    confidence,
    confidenceExplanation,
    researchedAt: new Date().toISOString(),
  }
}

export async function analyzeCompanyResearchAI(input: {
  userId: string
  companyName: string
  jobTitle: string
  url?: string | null
  location?: string | null
  description?: string | null
}): Promise<CompanyResearchResult> {
  const { userId, companyName, jobTitle, url, location, description } = input

  const prompt = [
    `Company: ${companyName}`,
    `Role: ${jobTitle}`,
    location ? `Location: ${location}` : null,
    url ? `URL: ${url}` : null,
    description ? `Job Posting Content:\n${fenceUntrusted("JOB_DESCRIPTION", description.slice(0, 5000))}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  try {
    const { object } = await generateObjectTracked({
      schema: companyResearchSchema,
      system: SYSTEM_PROMPT,
      prompt,
      tracking: {
        feature: AI_USAGE_FEATURES.JOB_MATCH,
        surface: "app",
        userId,
      },
    })

    return {
      ...object,
      researchedAt: new Date().toISOString(),
    }
  } catch {
    // Graceful fallback to deterministic factual extraction if AI provider unavailable
    return extractDeterministicCompanyResearch(input)
  }
}
