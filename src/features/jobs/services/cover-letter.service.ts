import { z } from "zod"
import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
  generateTextTracked,
} from "@/shared/lib/ai-generate"
import { HUMAN_VOICE_RULES } from "@/shared/lib/prompts/human-voice"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import { buildCandidateNameRules } from "@/shared/lib/prompts/candidate-name"
import {
  checkGeneratedDraft,
  groundEmployerRequirements,
  type GenerationGrounding,
} from "@/shared/lib/application-grounding"
import { logger } from "@/shared/lib/logger"
import type { Section } from "@/features/resume/hooks/use-resume-store"

const log = logger("jobs/cover-letter")

// ---------------------------------------------------------------------------
// Resume serialization
// ---------------------------------------------------------------------------

export function serializeResumeForCoverLetter(sections: Section[]): string {
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  const parts: string[] = []

  for (const section of sorted) {
    if (!section.visible) continue

    switch (section.type) {
      case "SUMMARY": {
        const item = section.items[0]
        if (!item) break
        const text = item.content.text
        if (text) {
          parts.push(`## Summary\n${text}`)
        }
        break
      }

      case "EXPERIENCE": {
        const entries = section.items
          .sort((a, b) => a.order - b.order)
          .map((item) => {
            const c = item.content
            const header = [c.role, c.company && `at ${c.company}`]
              .filter(Boolean)
              .join(" ")
            const dates = [c.startDate, c.endDate || (c.current ? "Present" : null)]
              .filter(Boolean)
              .join(" - ")
            const lines = [header, dates && `(${dates})`].filter(Boolean).join(" ")
            const bullets = (c.bullets as string[] | undefined)
              ?.map((b) => `- ${b}`)
              .join("\n")
            return [lines, bullets].filter(Boolean).join("\n")
          })
        if (entries.length > 0) {
          parts.push(`## Experience\n${entries.join("\n\n")}`)
        }
        break
      }

      case "SKILLS": {
        const entries = section.items
          .sort((a, b) => a.order - b.order)
          .map((item) => {
            const c = item.content
            const skills = (c.skills as string[] | undefined)?.join(", ")
            if (c.category && skills) return `${c.category}: ${skills}`
            if (skills) return skills
            return null
          })
          .filter(Boolean)
        if (entries.length > 0) {
          parts.push(`## Skills\n${entries.join("\n")}`)
        }
        break
      }

      case "PROJECTS": {
        const entries = section.items
          .sort((a, b) => a.order - b.order)
          .map((item) => {
            const c = item.content
            const header = c.name || "Untitled Project"
            const bullets = (c.bullets as string[] | undefined)
              ?.filter((b) => (b as string).trim())
              .map((b) => `- ${b}`)
              .join("\n")
            const techs = (c.technologies as string[] | undefined)?.join(", ")
            const url = typeof c.url === "string" ? c.url.trim() : ""
            const urlLabel = typeof c.urlLabel === "string" ? c.urlLabel.trim() : ""
            const link = url ? `Link: ${urlLabel ? `${urlLabel} (${url})` : url}` : null
            return [header, bullets, techs && `Technologies: ${techs}`, link]
              .filter(Boolean)
              .join("\n")
          })
        if (entries.length > 0) {
          parts.push(`## Projects\n${entries.join("\n\n")}`)
        }
        break
      }

      default:
        break
    }
  }

  const text = parts.join("\n\n")
  return text.length > 4000 ? text.slice(0, 4000) : text
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

export type CoverLetterAIResult = {
  coverLetter: string
  keywordsToInclude: string[]
  experienceToEmphasize: string[]
  whatToAvoid: string[]
  improvementSuggestions: string[]
  toneSuggestions: string[]
  /**
   * Requirements the finished letter mentions that the resume does not back.
   * `null` is the normal case; anything else is shown to the user before they
   * send it. See `src/shared/lib/application-grounding.ts`.
   */
  grounding: GenerationGrounding | null
}

const coverLetterSchema = z.object({
  coverLetter: z.string(),
  keywordsToInclude: z.array(z.string()),
  experienceToEmphasize: z.array(z.string()),
  whatToAvoid: z.array(z.string()),
  improvementSuggestions: z.array(z.string()),
  toneSuggestions: z.array(z.string()),
})

/**
 * Built per call rather than kept as a const: the name rules differ by whether a
 * name is available at all. The letter asks for no sign-off and none is added
 * here — but 300 words of first-person prose about the candidate is plenty of
 * room to invent a name mid-sentence, so the rule belongs here too.
 */
const buildSystemPrompt = (candidateName: string | null) =>
  `You are the candidate whose resume is provided, writing your own cover letter for this job, in your own voice. Everything you write comes ONLY from the resume provided.

ANTI-HALLUCINATION RULES:
- Never invent experience, skills, companies, titles, or achievements not in the resume
- Never add years of experience beyond what the resume shows
- If the resume lacks something the job requires, do not pretend otherwise
- Use only the candidate's actual background
- A requirement in the job description is evidence about the EMPLOYER, never about you. When the request carries a REQUIREMENT GROUNDING section, it is binding: nothing under DO NOT CLAIM may be presented as your experience

COVER LETTER FORMAT:
- 3 paragraphs: opening hook, how your experience and skills fit this role, closing with a clear ask
- 280-380 words total
- Professional but warm tone
- Zero exclamation marks
- No "Dear Hiring Manager" — start with the opening hook directly
- No placeholders like [Company Name] — if not available, write generically
- No sign-off block: the letter ends on its closing paragraph
${buildCandidateNameRules(candidateName, { closing: "name-only" })}

${HUMAN_VOICE_RULES}

${UNTRUSTED_CONTENT_RULES}

OUTPUT: Return ONLY valid JSON matching the schema. No prose, no markdown wrapper.`

export async function generateCoverLetterAI(
  resumeText: string,
  jobDescription: string,
  /** Owner of the request, recorded with the call's token usage. */
  userId: string,
  /** The candidate's own name. `null` when neither resume nor account has one. */
  candidateName?: string | null,
): Promise<CoverLetterAIResult> {
  const truncatedJob = jobDescription.slice(0, 3000)

  // Grounding is computed here rather than in the action so that no caller can
  // reach the model without it. A posting's requirement is evidence about the
  // employer; only the resume is evidence about the candidate.
  const grounding = groundEmployerRequirements({
    employerText: truncatedJob,
    evidenceText: resumeText,
  })

  const { object } = await generateObjectTracked({
    schema: coverLetterSchema,
    system: buildSystemPrompt(candidateName ?? null),
    prompt: [
      `Resume:\n${fenceUntrusted("RESUME", resumeText)}`,
      `Job Description:\n${fenceUntrusted("JOB_DESCRIPTION", truncatedJob)}`,
      grounding.promptBlock || null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    tracking: {
      feature: AI_USAGE_FEATURES.COVER_LETTER,
      surface: "app",
      userId,
    },
  })

  // The prompt bars every ungrounded requirement; this is the control that does
  // not depend on the model having listened.
  const claimed = checkGeneratedDraft({
    grounding,
    evidenceText: resumeText,
    generated: object.coverLetter,
  })
  // Non-null means SOMETHING was introduced, which includes a draft whose only
  // barred mentions are honest admissions. Only the loud tier belongs here.
  if (claimed && claimed.claimed.length > 0) {
    log.warn("Cover letter mentions requirements the resume does not back", {
      keywords: claimed.claimed.map((detail) => detail.keyword),
    })
  }

  // There is deliberately NO signature post-check here (`checkDraftSignature`,
  // the sibling control that guards the candidate's name on every email). A
  // cover letter has no sign-off block at all — the format rules above end it on
  // its closing paragraph — so a compliant letter has nothing in the signature
  // slot, and any check over it would either fire on every correct letter or
  // never fire at all. The name rule stays in the prompt; the enforcement lives
  // on the surfaces that actually sign.

  // "Keywords to include" is advice the user acts on by hand, so it must not
  // recommend a term the evidence check refused — that would route around the
  // grounding rule through the suggestions panel.
  const barred = new Set(grounding.barred.map((term) => term.toLowerCase()))
  const keywordsToInclude = object.keywordsToInclude.filter(
    (keyword) => !barred.has(keyword.trim().toLowerCase())
  )

  return { ...object, keywordsToInclude, grounding: claimed }
}

// ---------------------------------------------------------------------------
// AI improvement
// ---------------------------------------------------------------------------

const IMPROVE_SYSTEM_PROMPT = `You are the candidate, revising your own cover letter according to the instruction below. Keep it in your own voice. Return ONLY the improved cover letter text — no explanation, no preamble, no markdown.

${HUMAN_VOICE_RULES}

${UNTRUSTED_CONTENT_RULES}`

export async function improveCoverLetterAI(
  currentContent: string,
  instruction: string,
  /** Owner of the request, recorded with the call's token usage. */
  userId: string,
): Promise<string> {
  const { text } = await generateTextTracked({
    system: IMPROVE_SYSTEM_PROMPT,
    // `instruction` is the user's own instruction channel and stays unfenced;
    // the draft is document content and does not get to give orders.
    prompt: `Cover Letter:\n${fenceUntrusted(
      "COVER_LETTER_DRAFT",
      currentContent
    )}\n\nInstruction: ${instruction}`,
    tracking: {
      feature: AI_USAGE_FEATURES.COVER_LETTER_IMPROVE,
      surface: "app",
      userId,
    },
  })
  return text
}
