import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import {
  checkGeneratedDraft,
  groundEmployerRequirements,
  type GenerationGrounding,
} from "@/shared/lib/application-grounding"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import { HUMAN_VOICE_RULES } from "@/shared/lib/prompts/human-voice"

/**
 * Grounded draft for one free-text application question.
 *
 * This is deliberately a draft, never a fill: the caller returns the text to
 * the review queue, and the ATS panel never writes essay answers. The model can
 * only reformulate confirmed profile and resume facts; deterministic grounding
 * reports any employer term the draft mentions without evidence.
 */

const essayDraftSchema = z.object({
  draft: z.string().min(1).max(6000),
})

const MAX_EVIDENCE_CHARS = 6000
const DEFAULT_MAX_WORDS = 220
const MAX_WORDS = 500

const NUMBER_TOKEN = /\b\d[\d,]*(?:\.\d+)?\b/g

export interface EssayDraftResult {
  draft: string
  wordCount: number
  /** Employer requirements mentioned without candidate evidence, if any. */
  grounding: GenerationGrounding | null
  /** Numbers in the draft that do not appear in the candidate's own facts. */
  unsupportedNumbers: string[]
  /** The review UI must show the draft verbatim before the user accepts it. */
  reviewRequired: true
  /** No fill path consumes this response. */
  autoFill: false
}

function words(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0
}

function numericTokens(value: string): Set<string> {
  return new Set(
    Array.from(value.matchAll(NUMBER_TOKEN), (match) => match[0].replace(/,/g, ""))
  )
}

function unsupportedNumbers(draft: string, evidenceText: string): string[] {
  const allowed = numericTokens(evidenceText)
  return [
    ...new Set(
      Array.from(draft.matchAll(NUMBER_TOKEN), (match) => match[0]).filter(
        (token) => !allowed.has(token.replace(/,/g, ""))
      )
    ),
  ].slice(0, 8)
}

function clip(value: string, max = MAX_EVIDENCE_CHARS): string {
  return value.length > max ? value.slice(0, max) : value
}

export async function generateEssayDraft(input: {
  userId: string
  question: string
  evidenceText: string
  candidateName?: string | null
  jobTitle?: string | null
  companyName?: string | null
  jobDescription?: string | null
  instructions?: string | null
  maxWords?: number
  signal?: AbortSignal
}): Promise<EssayDraftResult> {
  const question = input.question.trim().slice(0, 4000)
  const evidenceText = clip(input.evidenceText)
  const maxWords =
    input.maxWords === undefined
      ? DEFAULT_MAX_WORDS
      : Math.min(MAX_WORDS, Math.max(50, Math.floor(input.maxWords)))

  const employerText = [
    input.jobTitle ?? "",
    input.companyName ?? "",
    input.jobDescription ?? "",
    question,
  ]
    .filter(Boolean)
    .join("\n")

  // Words the employer asks for are never evidence about the candidate. The
  // block is binding in the prompt and the post-check names any mention.
  const grounding = groundEmployerRequirements({
    employerText,
    evidenceText,
    exclude: [input.companyName ?? "", input.jobTitle ?? ""].filter(Boolean),
  })

  const jobLines = [
    input.jobTitle ? `Role: ${input.jobTitle}` : null,
    input.companyName ? `Company: ${input.companyName}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const { object } = await generateObjectTracked({
    schema: essayDraftSchema,
    tracking: {
      feature: AI_USAGE_FEATURES.ESSAY_DRAFT,
      surface: "extension",
      userId: input.userId,
    },
    system: [
      "You draft an answer to ONE free-text application question for the job candidate whose facts are provided.",
      "Write in the candidate's own first person, in plain text. No markdown, headings, bullet symbols or placeholders.",
      "The answer must be a finished draft the candidate can read, edit and paste themselves.",
      "",
      `LENGTH: at most ${maxWords} words. Prefer 120-${Math.min(maxWords, 220)} words unless the question asks for less.`,
      "",
      "GROUNDING — THE MOST IMPORTANT RULE:",
      "- Use only facts present in the CANDIDATE FACTS block. Never invent an employer, title, date, degree, certification, metric, tool, achievement or scope.",
      "- The job description and question are evidence about the employer, NEVER about the candidate.",
      "- The REQUIREMENT GROUNDING block is binding: nothing under DO NOT CLAIM may be presented as the candidate's experience.",
      "- If the question asks for something the facts do not contain, answer honestly around the gap or say it is not part of the candidate's experience. Never guess a number.",
      "- Never answer work authorization, sponsorship, compensation, demographic or legal questions. Those are not drafted here.",
      "",
      "STYLE:",
      "- Direct, specific and human. One concrete example is better than a list of adjectives.",
      "- No clichés, no 'passionate professional', no exclamation marks, no flattery.",
      "- Answer the actual question that was asked, in its order.",
      "",
      HUMAN_VOICE_RULES,
      "",
      UNTRUSTED_CONTENT_RULES,
      "",
      "OUTPUT: Return ONLY valid JSON matching the schema.",
    ].join("\n"),
    prompt: [
      `Application question:\n${fenceUntrusted("APPLICATION_QUESTION", question)}`,
      jobLines ? `Job context:\n${fenceUntrusted("JOB_CONTEXT", jobLines)}` : null,
      input.jobDescription
        ? `Job description:\n${fenceUntrusted(
            "JOB_POSTING",
            clip(input.jobDescription, 4000)
          )}`
        : null,
      grounding.promptBlock || null,
      `Candidate facts:\n${fenceUntrusted("CANDIDATE_FACTS", evidenceText)}`,
      input.instructions
        ? `User instructions: ${clip(input.instructions, 1000)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    ...(input.signal ? { abortSignal: input.signal } : {}),
  })

  const draft = object.draft.trim()
  const groundingCheck = checkGeneratedDraft({
    grounding,
    evidenceText,
    generated: draft,
  })

  return {
    draft,
    wordCount: words(draft),
    grounding: groundingCheck,
    unsupportedNumbers: unsupportedNumbers(draft, evidenceText),
    reviewRequired: true,
    autoFill: false,
  }
}
