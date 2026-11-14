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

/** `NONE` is the "this looks like a real job" answer, and is not stored as a level. */
const jobRiskSchema = z.object({
  level: z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]),
  reasons: z.array(z.string()).max(6),
})

export type JobRiskAiLevel = z.infer<typeof jobRiskSchema>["level"]

const SYSTEM_PROMPT = `You are an expert analyst who screens job postings for scams, ghost jobs and too-good-to-be-true offers.

ASSESS:
- Whether the role and its compensation are realistic together for the market and seniority implied.
- Whether the description is specific (named tools, real responsibilities, a real team) or generic filler.
- Recruiter legitimacy signals: company domain contact vs personal email, off-platform messaging apps, named hiring manager.
- Payment red flags: any fee, deposit, equipment purchase, wire transfer, gift card or crypto request.
- Ghost-job wording: evergreen "always hiring", perpetual reposting, no closing date, pipeline-building language.
- Company verifiability: whether the posting names a specific legal entity a candidate could look up, or hides behind "a confidential client", "a Fortune 500 partner", "our client in the industry".

RULES:
- Weigh company verifiability heavily. A named, checkable employer with a matching careers domain is a strong legitimacy signal; an unnamed employer paired with a concrete pay claim is a strong risk signal.
- Check recruiter identity against the company: does the contact email domain match the named company, is it a free mailbox, or is it a near-miss of the company's domain (extra words, hyphens or digits bolted on)?
- Check the apply link the same way: it should belong to the company or to a known job board, not to an unrelated host.
- A missing signal is not a risk. Do not penalise a posting for a field the user simply did not capture.
- Return level NONE when the posting looks legitimate. Do not invent risk to seem useful.
- LOW = minor oddities, MEDIUM = several concerning signals, HIGH = clear scam or fee-for-work pattern.
- Return 0 reasons for NONE, otherwise 1 to 4 short user-facing phrases (under 15 words each).
- Reasons state what is in the posting, not advice. No markdown, no numbering, no commentary.

${UNTRUSTED_CONTENT_RULES}

OUTPUT: Return ONLY valid JSON matching the schema.`

/** How much of the description is worth spending tokens on. */
const JOB_DESCRIPTION_LIMIT = 6000

export async function assessJobRiskAI(input: {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  job: {
    companyName: string
    jobTitle: string
    jobDescription: string
    salary?: number | null
    salaryPeriod?: string | null
    jobLink?: string | null
    contact?: string | null
    location?: string | null
  }
}): Promise<{ level: JobRiskAiLevel; reasons: string[] }> {
  const { userId, job } = input

  const jobLines = [
    `Company: ${job.companyName}`,
    `Role: ${job.jobTitle}`,
    job.location ? `Location: ${job.location}` : null,
    job.salary ? `Advertised pay: ${job.salary} ${job.salaryPeriod ?? ""}`.trim() : null,
    job.jobLink ? `Apply link: ${job.jobLink}` : null,
    job.contact ? `Recruiter contact: ${job.contact}` : null,
    `Job description:\n${job.jobDescription.slice(0, JOB_DESCRIPTION_LIMIT)}`,
  ]
    .filter(Boolean)
    .join("\n")

  const prompt = fenceUntrusted("JOB_POSTING", jobLines)

  const { object } = await generateObjectTracked({
    schema: jobRiskSchema,
    system: SYSTEM_PROMPT,
    prompt,
    // Classification against a fixed rubric: the cheap model is enough.
    tier: "light",
    tracking: {
      feature: AI_USAGE_FEATURES.JOB_RISK,
      surface: "app",
      userId,
    },
  })

  const reasons = object.reasons
    .map((reason) => reason.trim())
    .filter((reason) => reason.length > 0)

  return { level: object.level, reasons: object.level === "NONE" ? [] : reasons }
}
