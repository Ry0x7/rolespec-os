import { z } from "zod"
import { AI_USAGE_FEATURES, generateObjectTracked } from "@/shared/lib/ai-generate"
import { HUMAN_VOICE_RULES } from "@/shared/lib/prompts/human-voice"
import { fenceUntrusted, UNTRUSTED_CONTENT_RULES } from "@/shared/lib/prompts/untrusted"
import { buildCandidateNameRules } from "@/shared/lib/prompts/candidate-name"
import { checkDraftSignature, type SignatureCheck } from "@/shared/lib/prompts/signature-check"
import { checkGeneratedDraft, groundEmployerRequirements, type GenerationGrounding } from "@/shared/lib/application-grounding"
import { logger } from "@/shared/lib/logger"

const log = logger("jobs/follow-up-email")

export type FollowUpType = "status_check" | "post_interview_thank_you" | "next_steps"

export interface FollowUpEmailAIResult {
  subject: string
  body: string
  grounding: GenerationGrounding | null
  signature: SignatureCheck | null
}

const followUpEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
})

export async function generateFollowUpEmailAI(input: {
  userId: string
  resumeText: string
  candidateName?: string | null
  job: {
    companyName: string
    jobTitle: string
    location?: string | null
    contact?: string | null
    notes?: string | null
    status?: string | null
    dateApplied?: string | null
    interviewDate?: string | null
  }
  followUpType?: FollowUpType
  instructions?: string
}): Promise<FollowUpEmailAIResult> {
  const { userId, resumeText, candidateName, job, followUpType = "status_check", instructions } = input

  const typeDesc =
    followUpType === "post_interview_thank_you"
      ? "a warm, professional thank-you note following up shortly after an interview"
      : followUpType === "next_steps"
        ? "a professional inquiry checking in on next steps in the hiring process"
        : "a polite follow-up checking in on the status of an application submitted earlier"

  const systemPrompt = `You write short, professional follow-up emails from a candidate to a recruiter or hiring manager.

CONTEXT:
This is ${typeDesc}.

RULES:
- Keep it under 150 words. Recruiters read follow-ups quickly.
- State the purpose directly in the first sentence (e.g. following up on the ${job.jobTitle} position at ${job.companyName}).
- Be polite, enthusiastic, and respectful of their time. Do not sound impatient or entitled.
- If an interview occurred, mention appreciation for the conversation and reiterate enthusiasm for the role.
- Never invent metrics, projects, or credentials not supported by the candidate's resume or notes.
${buildCandidateNameRules(candidateName)}
${HUMAN_VOICE_RULES}
${UNTRUSTED_CONTENT_RULES}

OUTPUT: Return ONLY valid JSON matching the schema.`

  const promptParts = [
    candidateName ? `Candidate name: ${candidateName}` : null,
    `Company: ${job.companyName}`,
    `Role: ${job.jobTitle}`,
    job.contact ? `Contact person: ${job.contact}` : null,
    job.dateApplied ? `Date applied: ${job.dateApplied}` : null,
    job.interviewDate ? `Interview date: ${job.interviewDate}` : null,
    instructions ? `Additional user notes: ${instructions}` : null,
    `Resume excerpt:\n${fenceUntrusted("RESUME", resumeText.slice(0, 3000))}`,
  ].filter(Boolean)

  try {
    const { object } = await generateObjectTracked({
      schema: followUpEmailSchema,
      system: systemPrompt,
      prompt: promptParts.join("\n\n"),
      tracking: {
        feature: AI_USAGE_FEATURES.OUTREACH_EMAIL,
        surface: "app",
        userId,
      },
    })

    const signature = checkDraftSignature({ candidateName, body: object.body })
    const groundedReqs = groundEmployerRequirements({
      employerText: `${job.jobTitle} ${job.companyName} ${job.notes ?? ""}`,
      evidenceText: resumeText,
    })
    const grounding = checkGeneratedDraft({
      grounding: groundedReqs,
      evidenceText: resumeText,
      generated: `${object.subject}\n\n${object.body}`,
    })

    return {
      subject: object.subject,
      body: object.body,
      signature,
      grounding,
    }
  } catch (err) {
    log.warn("AI follow-up generation failed, using deterministic template", { err })
    // Deterministic fallback
    const salutation = job.contact ? `Dear ${job.contact},` : "Hello,"
    const subject = `Following up: ${job.jobTitle} application - ${candidateName}`
    const body = `${salutation}\n\nI hope you are having a productive week.\n\nI am following up regarding my application for the ${job.jobTitle} position at ${job.companyName}. I remain very interested in the role and would welcome the opportunity to discuss how my background aligns with your team's goals.\n\nPlease let me know if there are any additional materials or details I can provide.\n\nBest regards,\n${candidateName}`

    return {
      subject,
      body,
      signature: null,
      grounding: null,
    }
  }
}
