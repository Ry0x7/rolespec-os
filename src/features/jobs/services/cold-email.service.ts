import { z } from "zod"
import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import {
  HUMAN_VOICE_EXAMPLE_NOTE,
  HUMAN_VOICE_RULES,
} from "@/shared/lib/prompts/human-voice"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import { buildCandidateNameRules } from "@/shared/lib/prompts/candidate-name"
import {
  checkDraftSignature,
  type SignatureCheck,
} from "@/shared/lib/prompts/signature-check"
import {
  checkGeneratedDraft,
  groundEmployerRequirements,
  type GenerationGrounding,
} from "@/shared/lib/application-grounding"
import { logger } from "@/shared/lib/logger"

const log = logger("jobs/cold-email")

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

export type ColdEmailAIResult = {
  subject: string
  body: string
  /**
   * Requirements the draft mentions that the resume does not back. `null` in
   * the normal case. See `src/shared/lib/application-grounding.ts`.
   */
  grounding: GenerationGrounding | null
  /**
   * Set when the sign-off does not carry the candidate's own name. `null` in the
   * normal case. See `src/shared/lib/prompts/signature-check.ts`.
   */
  signature: SignatureCheck | null
}

const coldEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
})

/**
 * Built per call rather than kept as a const: the sign-off rules differ by
 * whether a name is available at all. See `buildCandidateNameRules`.
 */
const buildSystemPrompt = (candidateName: string | null) =>
  `You are the job candidate whose resume is provided, writing your own cold email about a specific role at a specific company. Write it in your own voice.

RULES:
- Body is 80-140 words, plain text only (NO markdown, no bullet symbols, no headings).
- The body is 2-3 short paragraphs of unequal length, separated by blank lines — never one solid block.
- Pick the ONE or TWO resume highlights most relevant to this specific job and go deep on those. Never list three or more achievements back-to-back — that reads like a resume dump, not a note from a person.
- Use your real resume highlights and the specific role and company.
- Lead with the one thing you've actually done that matches this role.
- Never fabricate facts, metrics, titles, or achievements not present in the resume.
- Anything the company works on is evidence about THEM, never about you. When the request carries a REQUIREMENT GROUNDING section, it is binding: nothing under DO NOT CLAIM may be presented as your experience.
- No generic flattery ("I'm a huge fan of your company").
- End with a single clear ask: a short intro call.
- Zero exclamation marks.
- Tone: confident but not pushy.
- Subject line is under 60 characters, specific and non-spammy. Leave the candidate's name out of it.
${buildCandidateNameRules(candidateName)}
- If the user provides extra instructions, respect them.

${HUMAN_VOICE_RULES}

${UNTRUSTED_CONTENT_RULES}

${HUMAN_VOICE_EXAMPLE_NOTE}

EXAMPLE ("Sam" is the example's name and never yours — see the name rule above):
Subject: senior data role — quick question

Hi Maya,

Saw the senior analyst opening on your careers page. I've spent the last three years doing almost exactly that scope at Corva — churn models, a self-serve dashboard the sales team actually uses.

The posting mentions dbt migration. I led ours last year, so that part caught my eye.

Worth a 15-minute call before I go through the formal application?

Thanks,
Sam

OUTPUT: Return ONLY valid JSON matching the schema. No prose, no markdown wrapper.`

export async function generateColdEmailAI(input: {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  resumeText: string
  /** The candidate's own name, for the sign-off. */
  candidateName?: string | null
  job: {
    companyName: string
    jobTitle: string
    location?: string | null
    notes?: string | null
  }
  instructions?: string
}): Promise<ColdEmailAIResult> {
  const { userId, resumeText, candidateName, job, instructions } = input
  const truncatedResume = resumeText.slice(0, 4000)

  const jobLines = [
    `Company: ${job.companyName}`,
    `Role: ${job.jobTitle}`,
    job.location ? `Location: ${job.location}` : null,
    job.notes ? `Notes: ${job.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  // No job description reaches this prompt — the employer-side text here is the
  // user's own notes about the company — so the requirement list is usually
  // small or empty. The check still runs: a note that names a stack is exactly
  // the kind of text a draft turns into "I've worked with X".
  const grounding = groundEmployerRequirements({
    employerText: jobLines,
    evidenceText: truncatedResume,
    exclude: [job.companyName, job.jobTitle],
  })

  const prompt = [
    `Resume:\n${fenceUntrusted("RESUME", truncatedResume)}`,
    `Job:\n${fenceUntrusted("JOB_POSTING", jobLines)}`,
    grounding.promptBlock || null,
    instructions ? `User instructions: ${instructions}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  const { object } = await generateObjectTracked({
    schema: coldEmailSchema,
    system: buildSystemPrompt(candidateName ?? null),
    prompt,
    tracking: {
      feature: AI_USAGE_FEATURES.COLD_EMAIL,
      surface: "app",
      userId,
    },
  })

  const claimed = checkGeneratedDraft({
    grounding,
    evidenceText: truncatedResume,
    generated: `${object.subject}\n${object.body}`,
  })
  // Non-null means SOMETHING was introduced, which includes a draft whose only
  // barred mentions are honest admissions. Only the loud tier belongs here.
  if (claimed && claimed.claimed.length > 0) {
    log.warn("Cold email mentions requirements the resume does not back", {
      keywords: claimed.claimed.map((detail) => detail.keyword),
    })
  }

  // The name rules in the system prompt are an instruction; this is the control.
  // Only the body is read — this prompt BARS the name from the subject, so a
  // subject without it is correct and must never be reported.
  const signature = checkDraftSignature({
    candidateName,
    body: object.body,
  })
  if (signature) {
    // Neither the name nor the draft is logged: both are the user's own data.
    log.warn("Cold email sign-off does not carry the candidate's name", {
      issue: signature.issue,
      offendingLines: signature.offending.length,
    })
  }

  // There is deliberately NO `checkSubjectNameSlot()` here, the sibling control
  // that guards the name slot of an application email's subject. This prompt
  // BARS the candidate's name from the subject, so a subject without it is the
  // correct output and a check over it would fire on every compliant draft. The
  // subject check is per-surface for exactly that reason; only the application
  // email asks for "Application for {role} — {candidate name}".
  return { ...object, grounding: claimed, signature }
}
