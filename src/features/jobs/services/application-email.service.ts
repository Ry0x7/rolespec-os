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
  checkSubjectNameSlot,
  type SignatureCheck,
  type SubjectNameCheck,
} from "@/shared/lib/prompts/signature-check"
import {
  checkGeneratedDraft,
  groundEmployerRequirements,
  type GenerationGrounding,
} from "@/shared/lib/application-grounding"
import { logger } from "@/shared/lib/logger"

const log = logger("jobs/application-email")

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

export type ApplicationEmailAIResult = {
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
  /**
   * Set when the subject's name slot holds something other than the candidate's
   * name. `null` in the normal case, and `null` on every other generator —
   * this is the ONE surface whose prompt asks for a name in the subject. See
   * `checkSubjectNameSlot` in `src/shared/lib/prompts/signature-check.ts`.
   */
  subjectName: SubjectNameCheck | null
}

const applicationEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
})

/**
 * Built per call rather than kept as a const: the name rules differ by whether a
 * name is available at all. A prompt that DEMANDS a name it never supplied is
 * what made the model sign drafts with a former employer and a job title.
 */
const buildSystemPrompt = (candidateName: string | null) =>
  `You are the job candidate whose resume is provided, writing your own email to a recruiter or hiring manager as you submit your application for a specific posted role. Write it in your own voice.

RULES:
- Body is 90-150 words, plain text only (NO markdown, no bullet symbols, no headings).
- Name the exact role and company being applied to.
- State that the resume is attached.
- Include 1-2 short highlights drawn ONLY from the resume.
- Never fabricate facts, metrics, titles, skills, or achievements not present in the resume.
- A requirement in the posting is evidence about the EMPLOYER, never about you. When the request carries a REQUIREMENT GROUNDING section, it is binding: nothing under DO NOT CLAIM may be presented as your experience.
- End with a single clear ask.
- Zero exclamation marks.
- Tone: professional and warm, never pushy or gimmicky.
- Subject line is under 60 characters, in the shape "Application for {role} — {candidate name}", dropping the name half when no name is given below.
- Greet the contact by name if a contact is provided, otherwise use a neutral greeting.
- Never leave placeholder brackets (like [Your Name]) in the output — write the real values or omit them.
${buildCandidateNameRules(candidateName, { subjectLine: true })}
- If the user provides extra instructions, respect them.

${HUMAN_VOICE_RULES}

${UNTRUSTED_CONTENT_RULES}

${HUMAN_VOICE_EXAMPLE_NOTE}

EXAMPLE ("Sam Ortiz" is the example's name and never yours — see the name rule above):
Subject: Application for Senior Data Analyst — Sam Ortiz

Hi Maya,

I've applied for the Senior Data Analyst role at Northwind. My resume is attached.

Most of the last three years at Corva has been the same work the posting describes: churn models, and a self-serve dashboard the sales team uses daily. I also led our dbt migration, which the posting mentions.

Happy to walk through any of it on a call.

Best,
Sam Ortiz

OUTPUT: Return ONLY valid JSON matching the schema. No prose, no markdown wrapper.`

export async function generateApplicationEmailAI(input: {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  resumeText: string
  /** The applicant's own name, for the sign-off and the subject line. */
  candidateName?: string | null
  job: {
    companyName: string
    jobTitle: string
    location?: string | null
    jobDescription?: string | null
    contact?: string | null
    notes?: string | null
  }
  instructions?: string
}): Promise<ApplicationEmailAIResult> {
  const { userId, resumeText, candidateName, job, instructions } = input
  const truncatedResume = resumeText.slice(0, 4000)

  const jobLines = [
    `Company: ${job.companyName}`,
    `Role: ${job.jobTitle}`,
    job.location ? `Location: ${job.location}` : null,
    job.contact ? `Contact: ${job.contact}` : null,
    job.notes ? `Notes: ${job.notes}` : null,
    job.jobDescription
      ? `Job description: ${job.jobDescription.slice(0, 2000)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n")

  // The company and the role legitimately appear in the draft — naming them is
  // not a claim about the candidate, so they are never treated as requirements.
  const grounding = groundEmployerRequirements({
    employerText: jobLines,
    evidenceText: truncatedResume,
    exclude: [job.companyName, job.jobTitle, job.contact ?? ""],
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
    schema: applicationEmailSchema,
    system: buildSystemPrompt(candidateName ?? null),
    prompt,
    tracking: {
      feature: AI_USAGE_FEATURES.APPLICATION_EMAIL,
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
    log.warn("Application email mentions requirements the resume does not back", {
      keywords: claimed.claimed.map((detail) => detail.keyword),
    })
  }

  // The name rules in the system prompt are an instruction; this is the control.
  // Only the body is read — the subject may legitimately drop the name to stay
  // under 60 characters, so it cannot be evidence of anything either way.
  // The subject gets its own, narrower check below.
  const signature = checkDraftSignature({
    candidateName,
    body: object.body,
  })
  if (signature) {
    // Neither the name nor the draft is logged: both are the user's own data.
    log.warn("Application email sign-off does not carry the candidate's name", {
      issue: signature.issue,
      offendingLines: signature.offending.length,
    })
  }

  // ...and this is the subject half. It runs HERE and nowhere else: this prompt
  // asks for "Application for {role} — {candidate name}", so a filled name slot
  // that is not the name is a finding. Every sibling generator's subject is
  // correct by a different rule, which is why the check is per-surface rather
  // than folded into `checkDraftSignature`.
  const subjectName = checkSubjectNameSlot({
    candidateName,
    subject: object.subject,
  })
  if (subjectName) {
    // Neither the name nor the offending text is logged: both are the user's
    // own data, so only the kind of issue and a length travel.
    log.warn("Application email subject does not carry the candidate's name", {
      issue: subjectName.issue,
      offendingLength: subjectName.offending.length,
    })
  }

  // Report-only, like the two checks above: `object.subject` and `object.body`
  // come back exactly as the model wrote them.
  return { ...object, grounding: claimed, signature, subjectName }
}
