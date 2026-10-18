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
  type SignatureExpectation,
} from "@/shared/lib/prompts/signature-check"
import {
  checkGeneratedDraft,
  groundEmployerRequirements,
  type GenerationGrounding,
} from "@/shared/lib/application-grounding"
import { logger } from "@/shared/lib/logger"

const log = logger("jobs/outreach-email")

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

/**
 * Person-shaped outreach, as opposed to `cold-email.service` (job-shaped) and
 * `application-email.service` (posting-shaped). The extension scrapes a LinkedIn
 * profile, so the target here is a human, not a listing.
 */
export type OutreachEmailAIResult = {
  subject: string
  body: string
  /**
   * Requirements the draft mentions that the resume does not back. `null` in
   * the normal case. See `src/shared/lib/application-grounding.ts`.
   */
  grounding: GenerationGrounding | null
  /**
   * Set when a surface that HAS a sign-off did not sign it with the candidate's
   * own name. Always `null` for the two LinkedIn types, which have no sign-off
   * by design. See `src/shared/lib/prompts/signature-check.ts`.
   */
  signature: SignatureCheck | null
}

export type OutreachPerson = {
  name: string
  headline?: string | null
  company?: string | null
  about?: string | null
  profileUrl?: string | null
}

/**
 * The three shapes of outreach the extension can send from a LinkedIn profile.
 * `cold_email` is the original behaviour and stays the default so existing
 * callers (and the extension shipped before this) are unaffected.
 */
export type OutreachMessageType = "cold_email" | "connection_note" | "linkedin_dm"

/** How the outreach should read. Absent means `professional`. */
export type OutreachTone = "professional" | "warm" | "direct"

/**
 * LinkedIn rejects a connection note over 300 characters outright, and a note
 * that lands well under the cap reads better besides, so 200 is enforced here
 * rather than trusted to the model.
 */
export const CONNECTION_NOTE_MAX_LENGTH = 200

/**
 * `subject` is deliberately allowed to be empty: the LinkedIn message types have
 * no subject line, and the model is told to return "" for them.
 */
const outreachEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
})

/**
 * The tone line each message type carries by default. These are the registers the
 * prompts asked for before tone was selectable, so omitting `tone` (or passing
 * `professional`) leaves the output exactly where it was — a connection note stays
 * warm, a DM stays peer-to-peer.
 */
const DEFAULT_TONE_LINE: Record<OutreachMessageType, string> = {
  cold_email: "Tone: confident, professional, and human — not pushy, not gimmicky.",
  connection_note: "Tone: warm, specific, human. Not salesy, not flattering for its own sake.",
  linkedin_dm: "Casual-professional tone, like a message between peers.",
}

/** Explicit overrides, used only when the caller asks for a non-default tone. */
const TONE_GUIDANCE: Record<Exclude<OutreachTone, "professional">, string> = {
  warm: "Tone: warm and personable — lead with genuine interest in the person's work. Still professional; no gushing, no over-familiarity, no jokes.",
  direct:
    "Tone: crisp and to the point. No filler and no flattery — one line of context, then the ask.",
}

const resolveToneLine = (messageType: OutreachMessageType, tone: OutreachTone) =>
  tone === "professional" ? DEFAULT_TONE_LINE[messageType] : TONE_GUIDANCE[tone]

const buildColdEmailSystemPrompt = (toneLine: string, candidateName: string | null) =>
  `You are the job candidate whose resume is provided, writing your own cold email TO the named person. Write it in your own voice.

RULES:
- Body is 80-140 words, plain text only (NO markdown, no bullet symbols, no headings).
- The body is 2-3 short paragraphs of unequal length, separated by blank lines — never one solid block.
- Pick the ONE or TWO resume highlights most relevant to this specific job and go deep on those. Never list three or more achievements back-to-back — that reads like a resume dump, not a note from a person.
- Open by addressing the person by name, and close with a sign-off.
${buildCandidateNameRules(candidateName)}
- Reference the person's role, company or "about" details naturally — one specific, concrete hook, not generic flattery.
- Ground every claim about the candidate in the resume. Never fabricate facts, metrics, titles, employers, or achievements about either side.
- Anything in the person's headline, company or about text is evidence about THEM, never about you. When the request carries a REQUIREMENT GROUNDING section, it is binding: nothing under DO NOT CLAIM may be presented as your experience.
- If a detail about the person is missing, write around it — never guess and never leave placeholder brackets (like [Company]).
- End with a single clear ask: a short intro call or a reply.
- Zero exclamation marks.
- ${toneLine}
- Subject line is under 70 characters, specific and non-spammy.
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

const buildConnectionNoteSystemPrompt = (toneLine: string) =>
  `You are the job candidate whose resume is provided, writing your own short note attached to a LinkedIn connection request, TO the named person. Write it in your own voice.

RULES:
- The note MUST be at most ${CONNECTION_NOTE_MAX_LENGTH} characters including spaces. Anything longer is cut. Aim for 150-190 characters.
- One or two sentences, referencing something specific about the person's work, role or company.
- No subject line: return an empty string for "subject".
- No greeting line and no sign-off boilerplate ("Dear", "Best regards", the candidate's name on its own line) — the recipient already sees who is asking.
- Plain text only. No markdown, no bullets, no line breaks needed.
- Ground any claim about the candidate in the resume. Never fabricate facts about either side.
- Anything in the person's headline, company or about text is evidence about THEM, never about you. When the request carries a REQUIREMENT GROUNDING section, it is binding: nothing under DO NOT CLAIM may be presented as your experience.
- Never leave placeholder brackets (like [Company]) — write the real value or omit it.
- Be specific rather than salesy.
- Zero exclamation marks.
- ${toneLine}
- If the user provides extra instructions, respect them.

${HUMAN_VOICE_RULES}

${UNTRUSTED_CONTENT_RULES}

${HUMAN_VOICE_EXAMPLE_NOTE}

EXAMPLE:
Hi Maya — saw you recruit for data roles at Northwind. I'm an analyst (3 yrs, churn + dbt) looking at the senior opening. Would love to connect and ask one quick question about it.

OUTPUT: Return ONLY valid JSON matching the schema, with "subject" as an empty string. No prose, no markdown wrapper.`

const buildLinkedInDmSystemPrompt = (toneLine: string, candidateName: string | null) =>
  `You are the job candidate whose resume is provided, writing your own LinkedIn direct message TO the named person. Write it in your own voice.

RULES:
- Keep it short: under 700 characters, ideally 60-110 words. A DM is read on a phone.
- No subject line: return an empty string for "subject".
- A short greeting using the person's first name is fine. Do NOT use formal letter structure — no "Dear", no paragraphed cover-letter body, no formal sign-off block.
- Write it like a message between peers, not a letter.
- ${toneLine}
- Reference one concrete detail about the person's role, company or "about" text.
- Ground every claim about the candidate in the resume. Never fabricate facts, metrics, titles or employers.
- Anything in the person's headline, company or about text is evidence about THEM, never about you. When the request carries a REQUIREMENT GROUNDING section, it is binding: nothing under DO NOT CLAIM may be presented as your experience.
- Pick the ONE or TWO resume highlights most relevant to this person or company and go deep on those. Never list three or more achievements back-to-back — that reads like a resume dump, not a message.
- Never leave placeholder brackets (like [Company]) — write the real value or omit it.
- End with one light ask (a reply, or a short chat).
${buildCandidateNameRules(candidateName, { closing: "name-only" })}
- Zero exclamation marks.
- Plain text only, no markdown.
- If the user provides extra instructions, respect them.

${HUMAN_VOICE_RULES}

${UNTRUSTED_CONTENT_RULES}

${HUMAN_VOICE_EXAMPLE_NOTE}

EXAMPLE ("Sam" is the example's name and never yours — see the name rule above):
Hi Maya, quick one. I saw you're hiring on the data team at Northwind — I'm an analyst three years into churn modelling and dbt work, and the senior opening looks close to what I already do.

Is the role more modelling or more platform? Happy to send my resume either way.

Sam

OUTPUT: Return ONLY valid JSON matching the schema, with "subject" as an empty string. No prose, no markdown wrapper.`

/**
 * One builder per message type. The tone line is interpolated into the identical
 * rule set, so switching tone can never quietly drop a rule (the character cap,
 * the empty subject, the grounding in the resume).
 */
const SYSTEM_PROMPTS: Record<
  OutreachMessageType,
  // The two LinkedIn builders take no name: a connection note and a DM carry no
  // sign-off block, because LinkedIn already shows the recipient who is asking.
  (toneLine: string, candidateName: string | null) => string
> = {
  cold_email: buildColdEmailSystemPrompt,
  connection_note: buildConnectionNoteSystemPrompt,
  linkedin_dm: buildLinkedInDmSystemPrompt,
}

/**
 * Which message types end with a sign-off at all. Sits beside `SYSTEM_PROMPTS`
 * on purpose: the entry here has to move whenever the prompt above it changes
 * its mind about how a message ends.
 */
const SIGNATURE_EXPECTATION: Record<OutreachMessageType, SignatureExpectation> = {
  cold_email: "sign-off",
  connection_note: "none",
  linkedin_dm: "none",
}

/**
 * Trim to `max` characters on a word boundary, so an overrunning model does not
 * leave the note cut mid-word. Falls back to a hard slice when the first word is
 * itself longer than the cap.
 */
function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text
  const hard = text.slice(0, max)
  const lastSpace = hard.lastIndexOf(" ")
  return (lastSpace > 0 ? hard.slice(0, lastSpace) : hard).trimEnd()
}

export async function generateOutreachEmailAI(input: {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  resumeText: string
  /** The candidate's own name, for the cold-email sign-off. */
  candidateName?: string | null
  person: OutreachPerson
  messageType?: OutreachMessageType
  tone?: OutreachTone
  instructions?: string
}): Promise<OutreachEmailAIResult> {
  const { userId, resumeText, person, instructions } = input
  const messageType = input.messageType ?? "cold_email"
  const tone = input.tone ?? "professional"
  const truncatedResume = resumeText.slice(0, 4000)

  const personLines = [
    `Name: ${person.name}`,
    person.headline ? `Headline: ${person.headline}` : null,
    person.company ? `Company: ${person.company}` : null,
    person.profileUrl ? `Profile: ${person.profileUrl}` : null,
    person.about ? `About: ${person.about.slice(0, 2000)}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  // The other person's headline and "about" text describe THEIR stack. A note
  // that mirrors it back as shared experience is the same failure the resume
  // paths guard against, so the same check runs here.
  const grounding = groundEmployerRequirements({
    employerText: personLines,
    evidenceText: truncatedResume,
    exclude: [person.name, person.company ?? ""],
  })

  const prompt = [
    `Resume:\n${fenceUntrusted("RESUME", truncatedResume)}`,
    `Person:\n${fenceUntrusted("PERSON_PROFILE", personLines)}`,
    grounding.promptBlock || null,
    instructions ? `User instructions: ${instructions}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  const { object } = await generateObjectTracked({
    schema: outreachEmailSchema,
    system: SYSTEM_PROMPTS[messageType](
      resolveToneLine(messageType, tone),
      input.candidateName ?? null
    ),
    prompt,
    tracking: {
      feature: AI_USAGE_FEATURES.OUTREACH_EMAIL,
      surface: "extension",
      userId,
    },
  })

  // LinkedIn message types have no subject, and the connection-note cap is a
  // platform limit — neither is left to the model's discretion.
  const body =
    messageType === "connection_note"
      ? truncateAtWordBoundary(object.body.trim(), CONNECTION_NOTE_MAX_LENGTH)
      : object.body
  const subject = messageType === "cold_email" ? object.subject : ""

  // Post-checked AFTER the truncation, so a claim the cap already cut off is not
  // reported as one the user still has to remove.
  const claimed = checkGeneratedDraft({
    grounding,
    evidenceText: truncatedResume,
    generated: `${subject}\n${body}`,
  })
  // Non-null means SOMETHING was introduced, which includes a draft whose only
  // barred mentions are honest admissions. Only the loud tier belongs here.
  if (claimed && claimed.claimed.length > 0) {
    log.warn("Outreach draft mentions requirements the resume does not back", {
      messageType,
      keywords: claimed.claimed.map((detail) => detail.keyword),
    })
  }

  // The name rules in the system prompt are an instruction; this is the control.
  // It is switched OFF for the two LinkedIn types, and that is not a shortcut: a
  // connection note forbids a sign-off outright ("no sign-off boilerplate ...
  // the candidate's name on its own line") and a DM forbids a formal one, so on
  // those surfaces an absent or informal signature is the CORRECT output and a
  // check would fire on every compliant draft. Run after the truncation, like
  // the grounding check, so the 200-character cap cannot create a finding.
  const signature = checkDraftSignature({
    candidateName: input.candidateName,
    body,
    expectation: SIGNATURE_EXPECTATION[messageType],
  })
  if (signature) {
    // Neither the name nor the draft is logged: both are the user's own data.
    log.warn("Outreach draft sign-off does not carry the candidate's name", {
      messageType,
      issue: signature.issue,
      offendingLines: signature.offending.length,
    })
  }

  // There is deliberately NO `checkSubjectNameSlot()` here, the sibling control
  // that guards the name slot of an application email's subject. Neither of this
  // service's two subject shapes has one: `cold_email` mirrors
  // `cold-email.service` and bars the name from the subject, and both LinkedIn
  // types have their subject BLANKED to "" above, where a check could only ever
  // report the absence of a slot the surface does not have.
  return { subject, body, grounding: claimed, signature }
}
