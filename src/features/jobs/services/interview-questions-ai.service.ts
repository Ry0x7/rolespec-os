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

/** Kept in step with the prompt's "8 to 10" instruction. */
const generatedQuestionsSchema = z.object({
  questions: z.array(z.string()).min(1).max(12),
})

const SYSTEM_PROMPT = `You are an experienced interviewer preparing the question list for a specific open role.

RULES:
- Return 8 to 10 questions the employer is genuinely likely to ask for THIS role.
- Mix behavioral questions with whatever role-specific format fits the field — technical for engineering, clinical or situational for healthcare, role-play and objection handling for sales, scenario-based for teaching and the trades.
- Ground every question in the job description.
- Prefer specifics from the posting (named tools, responsibilities, domain) over generic filler.
- One question per array item, plain text, no numbering, no markdown, no commentary.
- Never invent requirements that are not implied by the role or the description.

${UNTRUSTED_CONTENT_RULES}

OUTPUT: Return ONLY valid JSON matching the schema.`

/** How much of the description is worth spending tokens on. */
const JOB_DESCRIPTION_LIMIT = 6000

export async function generateInterviewQuestionsAI(input: {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  job: {
    companyName: string
    jobTitle: string
    jobDescription: string
  }
}): Promise<string[]> {
  const { userId, job } = input

  const prompt = fenceUntrusted(
    "JOB_POSTING",
    [
      `Company: ${job.companyName}`,
      `Role: ${job.jobTitle}`,
      `Job description:\n${job.jobDescription.slice(0, JOB_DESCRIPTION_LIMIT)}`,
    ].join("\n")
  )

  const { object } = await generateObjectTracked({
    schema: generatedQuestionsSchema,
    system: SYSTEM_PROMPT,
    prompt,
    // A short list drawn straight from the posting: the cheap model is enough.
    tier: "light",
    tracking: {
      feature: AI_USAGE_FEATURES.INTERVIEW_QUESTIONS,
      surface: "app",
      userId,
    },
  })

  return object.questions
    .map((question) => question.trim())
    .filter((question) => question.length > 0)
}
