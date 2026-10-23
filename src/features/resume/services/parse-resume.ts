import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import { HUMAN_VOICE_LEXICON } from "@/shared/lib/prompts/human-voice"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import { logger } from "@/shared/lib/logger"
import { importResumeText, ResumeTextRequiredError } from "./import-resume-text"

const log = logger("resume/parse-file")

// ─── Zod schema for structured resume output ────────────────────────────────

// Every property is required so the schema stays compatible with OpenAI strict
// structured outputs (which demands that `required` lists every key). Fields the
// model cannot fill are `null`, and the nulls are stripped again in
// `stripNulls()` before the parsed resume is returned.
const parsedResumeSchema = z.object({
  title: z.string().describe("Short descriptive title for this resume (e.g. 'Operations Manager Resume')"),
  contact: z.object({
    fullName: z.string().nullable(),
    jobTitle: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    linkedin: z.string().nullable(),
    github: z.string().nullable(),
    website: z.string().nullable(),
  }),
  summary: z.object({
    text: z.string().nullable(),
  }),
  experience: z.array(
    z.object({
      company: z.string().nullable(),
      role: z.string().nullable(),
      location: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      current: z.boolean().nullable(),
      bullets: z.array(z.string()).nullable(),
    })
  ),
  education: z.array(
    z.object({
      school: z.string().nullable(),
      degree: z.string().nullable(),
      field: z.string().nullable(),
      gpa: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
    })
  ),
  skills: z.array(
    z.object({
      category: z.string().nullable(),
      skills: z.array(z.string()).nullable(),
    })
  ),
  projects: z.array(
    z.object({
      name: z.string().nullable(),
      bullets: z.array(z.string()).nullable(),
      technologies: z.array(z.string()).nullable(),
      url: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
    })
  ),
  certifications: z.array(
    z.object({
      name: z.string().nullable(),
      organization: z.string().nullable(),
      dateObtained: z.string().nullable(),
      expirationDate: z.string().nullable(),
      credentialId: z.string().nullable(),
    })
  ),
})

/** Raw model output: nullable everywhere instead of optional. */
type RawParsedResume = z.infer<typeof parsedResumeSchema>

type NullableKeys<T> = {
  [K in keyof T]-?: null extends T[K] ? K : never
}[keyof T]

type StrippedProps<T> = { [K in keyof T]: StripNulls<NonNullable<T[K]>> }

/** The shape after `stripNulls()`: nullable keys become optional-and-absent. */
type StripNulls<T> = T extends (infer U)[]
  ? StripNulls<NonNullable<U>>[]
  : T extends object
    ? Omit<StrippedProps<T>, NullableKeys<T>> &
        Partial<Pick<StrippedProps<T>, NullableKeys<T>>>
    : T

export type ParsedResume = StripNulls<RawParsedResume> & {
  /** Locally extracted text, editable without guessing structured fields. */
  importedSections?: Array<{ title: string; content: string }>
}

/**
 * Recursively drops null-valued keys from objects and null entries from arrays,
 * so persisted section JSON keeps its historical shape (absent keys, never an
 * explicit null).
 */
function stripNulls<T>(value: T): StripNulls<T> {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== null && entry !== undefined)
      .map((entry) => stripNulls(entry)) as StripNulls<T>
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined) continue
      result[key] = stripNulls(entry)
    }
    return result as StripNulls<T>
  }

  return value as StripNulls<T>
}

// ─── Text extraction ─────────────────────────────────────────────────────────

/** Wall-clock bound on a single document parse. */
const PARSE_TIMEOUT_MS = 30_000
/** Longest extracted text handed to the model. */
const MAX_EXTRACTED_TEXT_LENGTH = 200_000

/**
 * Bounds how long the caller waits on a parser.
 *
 * LIMITATION: a CPU-bound parse running in this process cannot be cancelled.
 * The race bounds the *request*, not the worker — a pathological document can
 * still occupy the event loop after the rejection. Real isolation would need a
 * separate process or worker thread.
 */
function withParseTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${PARSE_TIMEOUT_MS}ms`)),
      PARSE_TIMEOUT_MS
    )
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** Truncates runaway extractions before they reach a prompt. */
function capText(text: string): string {
  if (text.length <= MAX_EXTRACTED_TEXT_LENGTH) return text
  log.warn("Extracted text truncated", {
    length: text.length,
    cap: MAX_EXTRACTED_TEXT_LENGTH,
  })
  return text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
}

async function extractText(buffer: Uint8Array, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const { PDFParse } = await import("pdf-parse")
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await withParseTimeout(parser.getText(), "PDF parse")
      return capText(result.text)
    } finally {
      // pdf-parse v2 exposes destroy(); a mocked/older parser may not.
      await Promise.resolve(parser.destroy?.()).catch(() => {})
    }
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth")
    const result = await withParseTimeout(
      mammoth.extractRawText({ buffer: Buffer.from(buffer) }),
      "DOCX parse"
    )
    return capText(result.value)
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

// ─── Partial optimization (50% of bullets) ──────────────────────────────────

async function partialOptimize(
  parsed: ParsedResume,
  userId: string,
): Promise<ParsedResume> {
  // Collect every other bullet from experience sections
  const bulletsToOptimize: string[] = []

  for (const exp of parsed.experience) {
    if (!exp.bullets?.length) continue
    for (let i = 0; i < exp.bullets.length; i++) {
      if (i % 2 === 0) bulletsToOptimize.push(exp.bullets[i])
    }
  }

  if (bulletsToOptimize.length === 0) return parsed

  const { object: optimized } = await generateObjectTracked({
    schema: z.object({ bullets: z.array(z.string()) }),
    // Bullet polish is a rewrite of text the user already wrote, not an
    // extraction — the cheap model is enough, and this is the second call of an
    // upload the user is already paying for.
    tier: "light",
    tracking: {
      feature: AI_USAGE_FEATURES.RESUME_PARSE_OPTIMIZE,
      surface: "app",
      userId,
    },
    system:
      'Improve the given resume bullet points using the Action–Result–Reason framework: open with the Action (a strong action verb plus what was done), then the Result (the outcome it produced), then the Reason (why it mattered: the purpose, relevance or business value). Be concise. Keep the same meaning and facts — state the Result qualitatively when the bullet gives no figure and never invent numbers, and drop the Reason clause rather than inventing one. Return the same number of bullets in the same order.\n\n' +
      HUMAN_VOICE_LEXICON +
      "\n\n" +
      UNTRUSTED_CONTENT_RULES +
      '\n\nRespond with ONLY valid JSON in this exact shape: {"bullets":["improved bullet 1","improved bullet 2"]}. No markdown, no numbered list, no explanation.',
    prompt: `Optimize these bullets:\n${fenceUntrusted(
      "RESUME_BULLETS",
      bulletsToOptimize.map((b, i) => `${i + 1}. ${b}`).join("\n")
    )}`,
  })

  // Merge optimized bullets back into even-indexed positions
  let optimizedIdx = 0
  const result = { ...parsed }
  result.experience = parsed.experience.map((exp) => ({
    ...exp,
    bullets: exp.bullets?.map((bullet, i) => {
      if (i % 2 === 0 && optimizedIdx < optimized.bullets.length) {
        return optimized.bullets[optimizedIdx++]
      }
      return bullet
    }),
  }))

  return result
}

// ─── Main parse function ─────────────────────────────────────────────────────

export interface ParseResumeOptions {
  /** AI structuring is opt-in. Plain import never contacts a provider. */
  useAi?: boolean
  /**
   * Run the bullet-rewriting pass after AI structuring. Has no effect unless
   * useAi is true.
   */
  optimizeBullets?: boolean
}

export async function parseResumeFile(
  buffer: Uint8Array,
  mimeType: string,
  /** Owner of the upload, recorded with the call's token usage. */
  userId: string,
  options: ParseResumeOptions = {}
): Promise<ParsedResume> {
  const text = await extractText(buffer, mimeType)
  if (options.useAi !== true) return importResumeText(text)
  if (!text.trim()) throw new ResumeTextRequiredError()

  const { object } = await generateObjectTracked({
    schema: parsedResumeSchema,
    tracking: {
      feature: AI_USAGE_FEATURES.RESUME_PARSE,
      surface: "app",
      userId,
    },
    system: `You are an expert resume parser. Extract all resume information from the provided text.

Return a JSON object with EXACTLY this structure. Never omit a key: if the resume
does not contain a value for a field, set that field to null (shown below as
"string or null").
{
  "title": "Short descriptive title, e.g. 'Operations Manager Resume'",
  "contact": { "fullName": "string or null", "jobTitle": "string or null", "email": "string or null", "phone": "string or null", "location": "string or null", "linkedin": "string or null", "github": "string or null", "website": "string or null" },
  "summary": { "text": "The summary paragraph as a single string, or null" },
  "experience": [{ "company": "string or null", "role": "string or null", "location": "string or null", "startDate": "string or null", "endDate": "string or null", "current": "boolean or null", "bullets": ["bullet 1", "bullet 2"] }],
  "education": [{ "school": "string or null", "degree": "string or null", "field": "string or null", "gpa": "string or null", "startDate": "string or null", "endDate": "string or null" }],
  "skills": [{ "category": "Core Skills", "skills": ["Budgeting", "Scheduling", "Team Leadership"] }],
  "projects": [{ "name": "string or null", "bullets": ["what was built", "key achievement"], "technologies": ["Tech1"], "url": "string or null", "startDate": "string or null", "endDate": "string or null" }],
  "certifications": [{ "name": "string or null", "organization": "string or null", "dateObtained": "string or null", "expirationDate": "string or null", "credentialId": "string or null" }]
}

CRITICAL:
- Every key shown above MUST be present. Use null for anything you cannot find in the resume — never omit the key, never invent a value
- "title" is the only field that must always be a real string, never null
- Array-valued fields ("bullets", "skills", "technologies") may be null, but must never contain null entries
- Sections with no entries at all ("experience", "education", "skills", "projects", "certifications") are empty arrays []
- "summary" MUST be an object {"text":"..."}, never a plain string
- "skills" MUST be an array of category objects with a skills array (e.g. [{"category":"Core Skills","skills":["Budgeting","Scheduling"]}])
- "projects[].bullets" MUST be an array of strings describing achievements, never a single description string
- "certifications" MUST be an array of objects with a "name" field, never plain strings
- Use dates exactly as written in the resume (e.g. "Jan 2022", "08/2024")

${UNTRUSTED_CONTENT_RULES}`,
    prompt: `Parse the following resume text into structured data:\n\n${fenceUntrusted(
      "UPLOADED_RESUME",
      text
    )}`,
  })

  // Strict structured output means the model emits explicit nulls; strip them so
  // the persisted shape stays "absent key" like before.
  const parsed = stripNulls(object)

  // 50% auto-optimization on upload, unless the uploader opted out
  if (options.optimizeBullets === false) return parsed
  return await partialOptimize(parsed, userId)
}
