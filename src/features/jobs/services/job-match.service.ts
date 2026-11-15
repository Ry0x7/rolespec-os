import { z } from "zod"
import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

export type JobMatchAIResult = {
  matchScore: number
  summary: string
  matchedKeywords: string[]
  missingKeywords: string[]
  suggestions: string[]
}

const jobMatchSchema = z.object({
  matchScore: z.number().min(0).max(100),
  summary: z.string(),
  matchedKeywords: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  suggestions: z.array(z.string()),
})

const SYSTEM_PROMPT = `You are an honest recruiter and ATS analyst with experience across industries. You compare a candidate's resume against a specific job posting and report how well they actually match.

RULES:
- Score strictly on a 0-100 scale. 80+ means a recruiter would shortlist this resume today. Most real resumes land between 40 and 75. Do not inflate.
- matchedKeywords: skills, tools, and qualifications required by the job that clearly appear in the resume.
- missingKeywords: skills, tools, and qualifications present in the job description but absent from the resume. Never list something the resume already covers.
- Keywords are short (1-4 words), lowercase unless a proper noun, and de-duplicated.
- summary is 2-3 sentences of plain-language assessment, including the biggest gap.
- suggestions are 3-5 concrete, actionable resume edits tied to this specific job.
- Never fabricate experience, metrics, or credentials the resume does not contain.

${UNTRUSTED_CONTENT_RULES}

OUTPUT: Return ONLY valid JSON matching the schema. No prose, no markdown wrapper.`

export async function analyzeJobMatchAI(input: {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  resumeText: string
  job: {
    jobTitle: string
    companyName: string
    jobDescription?: string | null
    notes?: string | null
  }
}): Promise<JobMatchAIResult> {
  const { userId, resumeText, job } = input
  const truncatedResume = resumeText.slice(0, 4000)
  const truncatedDescription = job.jobDescription?.slice(0, 4000)

  const jobLines = [
    `Company: ${job.companyName}`,
    `Role: ${job.jobTitle}`,
    truncatedDescription ? `Job description:\n${truncatedDescription}` : null,
    job.notes ? `Notes: ${job.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const prompt = [
    `Resume:\n${fenceUntrusted("RESUME", truncatedResume)}`,
    `Job:\n${fenceUntrusted("JOB_POSTING", jobLines)}`,
  ].join("\n\n")

  const { object } = await generateObjectTracked({
    schema: jobMatchSchema,
    system: SYSTEM_PROMPT,
    prompt,
    tracking: {
      feature: AI_USAGE_FEATURES.JOB_MATCH,
      surface: "app",
      userId,
    },
  })
  return object
}
