import { z } from "zod"
import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
  type AiSurface,
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

const log = logger("jobs/reply-email")

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

/**
 * Reply assist: the user has already applied and received something back — a
 * recruiter response, an interview invitation, a scheduling request, a set of
 * follow-up questions — and needs the reply drafted FROM them.
 */
export type ReplyEmailAIResult = {
  subject: string
  body: string
  /**
   * Requirements the reply mentions that the resume does not back. `null` in
   * the normal case. See `src/shared/lib/application-grounding.ts`.
   */
  grounding: GenerationGrounding | null
  /**
   * Set when the sign-off does not carry the candidate's own name. `null` in the
   * normal case. See `src/shared/lib/prompts/signature-check.ts`.
   */
  signature: SignatureCheck | null
}

export type ReplyEmailJob = {
  companyName?: string | null
  jobTitle?: string | null
  jobDescription?: string | null
  location?: string | null
  contact?: string | null
  notes?: string | null
  status?: string | null
  interviewDate?: Date | string | null
}

/** How the reply should read. Absent means `professional`. */
export type ReplyEmailTone = "professional" | "warm" | "direct"

/** How long the reply should run. Absent means `standard`. */
export type ReplyEmailLength = "brief" | "standard" | "detailed"

/** Earlier thread messages are capped well below the received email itself. */
const PRIOR_THREAD_MAX_LENGTH = 6000

/** The rejected draft only needs to be recognisable, not complete. */
const PREVIOUS_DRAFT_MAX_LENGTH = 4000

const replyEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
})

const TONE_GUIDANCE: Record<ReplyEmailTone, string> = {
  professional: "Tone: professional and warm, appreciative without being fawning.",
  warm: "Tone: friendly and personable — a little more human than a form reply. One light personal touch is allowed, but stay professional; no jokes, no over-familiarity.",
  direct:
    "Tone: crisp and to the point. No filler, minimal pleasantries — one short courtesy line at most, then answer.",
}

const LENGTH_GUIDANCE: Record<ReplyEmailLength, string> = {
  brief: "Keep it tight: 50-90 words unless the received email demands more detail.",
  standard: "Keep it tight: 80-160 words unless the received email demands more detail.",
  detailed: "Keep it thorough: 150-280 words unless the received email demands more detail.",
}

/**
 * One prompt per tone. Every variant carries the identical rule set — only the
 * tone line differs — so switching tone can never quietly drop a safety rule
 * (grounding in the resume, the availability placeholder, the "Re:" subject).
 */
function buildSystemPrompt(
  tone: ReplyEmailTone,
  length: ReplyEmailLength,
  candidateName: string | null
): string {
  return `You are the job applicant whose resume is provided. You applied for a role and got an email back — a recruiter response, an interview invitation, a scheduling request, or follow-up questions. Write your own REPLY to the sender, in your own voice.

RULES:
- Answer what the received email actually asks. Address every question or request in it; do not ignore one.
- Body is plain text only (NO markdown, no bullet symbols, no headings), with a greeting and a sign-off.
${buildCandidateNameRules(candidateName)}
- ${LENGTH_GUIDANCE[length]}
- ${TONE_GUIDANCE[tone]}
- Propose concrete availability ONLY if the email asks for it, and never invent specific dates or times — leave a placeholder like [your availability] for the user to fill in.
- Ground every claim about the applicant in the resume. Never fabricate facts, metrics, titles, employers or achievements.
- A technology or requirement named in the received email or the posting is evidence about the EMPLOYER, never about the applicant. When the request carries a REQUIREMENT GROUNDING section, it is binding: nothing under DO NOT CLAIM may be presented as the applicant's experience — answer the question honestly instead, or say it is not something they have worked with.
- Apart from placeholders the user must fill in (availability, phone number), never leave bracketed placeholders — write the real value or omit it.
- Subject line: reuse the received email's subject as "Re: ..." when one can be inferred, otherwise write a short, sensible line.
- When earlier messages from the thread are provided, use them for context and continuity, but reply to the LATEST received email.
- When a previous draft is provided, write a materially different reply — different opening, different structure, different phrasing — while keeping all factual grounding. Do not echo sentences from the previous draft.
- ${
    tone === "warm"
      ? "At most one exclamation mark in the whole reply, and only if it genuinely fits."
      : "Zero exclamation marks."
  }
- If the user provides extra instructions, respect them.

${HUMAN_VOICE_RULES}

${UNTRUSTED_CONTENT_RULES}

${HUMAN_VOICE_EXAMPLE_NOTE}

EXAMPLE ("Sam" is the example's name and never yours — see the name rule above):
Hi Jordan,

Thanks for reaching out — yes, interested. The platform team scope you described is close to what I do now.

I'm free [your availability]. Happy to send my resume ahead of the call if useful.

Best,
Sam

OUTPUT: Return ONLY valid JSON matching the schema. No prose, no markdown wrapper.`
}

/** Human-readable, so the model does not have to parse an ISO string. */
function formatInterviewDate(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  })
}

export async function generateReplyEmailAI(input: {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  /** This one has two entry points — the app action and the extension route. */
  surface: AiSurface
  resumeText: string
  /** The applicant's own name, for the sign-off. */
  candidateName?: string | null
  receivedEmail: string
  job?: ReplyEmailJob
  instructions?: string
  tone?: ReplyEmailTone
  length?: ReplyEmailLength
  /** Earlier messages in the thread, oldest first, pasted by the user. */
  priorThread?: string
  /** The body of the last generated reply — sent on a regenerate. */
  previousDraft?: string
}): Promise<ReplyEmailAIResult> {
  const {
    userId,
    surface,
    resumeText,
    receivedEmail,
    job,
    instructions,
    priorThread,
    previousDraft,
  } = input
  const tone = input.tone ?? "professional"
  const length = input.length ?? "standard"
  const truncatedResume = resumeText.slice(0, 4000)

  const interviewDate = job?.interviewDate ? formatInterviewDate(job.interviewDate) : null

  const jobLines = [
    job?.companyName ? `Company: ${job.companyName}` : null,
    job?.jobTitle ? `Role: ${job.jobTitle}` : null,
    job?.location ? `Location: ${job.location}` : null,
    job?.contact ? `Contact: ${job.contact}` : null,
    job?.notes ? `Notes: ${job.notes}` : null,
    job?.status ? `Application status: ${job.status}` : null,
    interviewDate ? `Interview date: ${interviewDate}` : null,
    job?.jobDescription ? `Job description: ${job.jobDescription.slice(0, 2000)}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const truncatedReceived = receivedEmail.slice(0, 8000)

  // A recruiter's email is employer-side text like the posting is: "do you have
  // Kubernetes experience?" is a question, not evidence that the applicant does.
  const grounding = groundEmployerRequirements({
    employerText: [truncatedReceived, jobLines].filter(Boolean).join("\n"),
    evidenceText: truncatedResume,
    exclude: [
      job?.companyName ?? "",
      job?.jobTitle ?? "",
      job?.contact ?? "",
    ].filter(Boolean),
  })

  const prompt = [
    `Resume:\n${fenceUntrusted("RESUME", truncatedResume)}`,
    `Email the applicant received:\n${fenceUntrusted(
      "RECEIVED_EMAIL",
      truncatedReceived
    )}`,
    priorThread
      ? `Earlier messages in this thread (oldest first):\n${fenceUntrusted(
          "PRIOR_THREAD",
          priorThread.slice(0, PRIOR_THREAD_MAX_LENGTH)
        )}`
      : null,
    jobLines ? `Job context:\n${fenceUntrusted("JOB_POSTING", jobLines)}` : null,
    previousDraft
      ? `The previous draft the user rejected:\n${fenceUntrusted(
          "PREVIOUS_DRAFT",
          previousDraft.slice(0, PREVIOUS_DRAFT_MAX_LENGTH)
        )}`
      : null,
    grounding.promptBlock || null,
    instructions ? `User instructions: ${instructions}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  const { object } = await generateObjectTracked({
    schema: replyEmailSchema,
    system: buildSystemPrompt(tone, length, input.candidateName ?? null),
    prompt,
    // A regenerate has to land somewhere new — the admin temperature is usually
    // tuned for determinism, which is exactly wrong for "give me another one".
    ...(previousDraft ? { temperature: 0.9 } : {}),
    tracking: {
      feature: AI_USAGE_FEATURES.REPLY_EMAIL,
      surface,
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
    log.warn("Reply email mentions requirements the resume does not back", {
      keywords: claimed.claimed.map((detail) => detail.keyword),
    })
  }

  // The name rules in the system prompt are an instruction; this is the control.
  // Only the body is read — a reply subject is "Re: <whatever they wrote>", so
  // it carries the sender's words and cannot be evidence about the applicant.
  const signature = checkDraftSignature({
    candidateName: input.candidateName,
    body: object.body,
  })
  if (signature) {
    // Neither the name nor the draft is logged: both are the user's own data.
    log.warn("Reply email sign-off does not carry the applicant's name", {
      issue: signature.issue,
      offendingLines: signature.offending.length,
    })
  }

  // There is deliberately NO `checkSubjectNameSlot()` here, the sibling control
  // that guards the name slot of an application email's subject. A reply subject
  // is "Re: <whatever the sender wrote>" — the sender's own words, with no name
  // slot to fill — so any finding over it would be about somebody else's
  // subject line, not about this draft.
  return { ...object, grounding: claimed, signature }
}
