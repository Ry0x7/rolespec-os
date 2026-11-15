import { z } from "zod"
import { CareerEvidenceKind } from "@/generated/prisma/enums"
import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import {
  AiDailyLimitError,
  AiKeyRequiredError,
} from "@/shared/lib/ai-provider"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import {
  isPlausibleSkillName,
  mapImportedEvidence,
  mapImportedSkills,
} from "@/features/career-profile/services/import-linkedin.service"
import { dedupeDrafts } from "../lib/patch-fingerprint"
import type {
  ChatExtractionResult,
  ContactField,
  ContactPatchData,
  EvidencePatchData,
  IntakeChatMessage,
  IntakePatchDraft,
  IntakeSource,
  IntakeProvenance,
} from "../types"

const MAX_TEXT = 20_000
const MAX_SKILLS = 40

const aiContactSchema = z.object({
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  linkedin: z.string().nullable(),
  github: z.string().nullable(),
  website: z.string().nullable(),
})

const chatAiSchema = z.object({
  contact: aiContactSchema.nullable(),
  evidence: z.array(
    z.object({
      kind: z.nativeEnum(CareerEvidenceKind),
      title: z.string(),
      organization: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      details: z.string().nullable(),
      outcome: z.string().nullable(),
    })
  ),
  skills: z.array(z.string()),
  targetRoles: z.array(z.string()),
})

type ChatAiExtraction = z.infer<typeof chatAiSchema>

const SYSTEM_PROMPT = [
  "You extract career facts a person stated about themselves in a conversation, so they can review each fact before it enters their career profile.",
  "",
  "OUTPUT: a JSON object with exactly these keys: contact, evidence, skills, targetRoles.",
  "contact is null when the person stated no contact details; otherwise every field is present and is a string or null.",
  "evidence items use kind EXPERIENCE, EDUCATION, CERTIFICATION, PROJECT or ACHIEVEMENT. Dates are YYYY-MM or YYYY-MM-DD, or null.",
  "targetRoles are role titles the person says they are targeting.",
  "",
  "GROUNDING — THE MOST IMPORTANT RULE:",
  "- Use only facts explicitly stated by the person in the USER turns.",
  "- Never infer an employer, title, date, school, metric, seniority or skill from context or from the assistant's turns.",
  "- Never convert a question or a hypothetical into a fact.",
  "- A skill is included only when the person says they know, use or have experience with it.",
  "- If nothing durable was stated, return empty arrays and contact: null.",
  "",
  UNTRUSTED_CONTENT_RULES,
].join("\n")

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function yearToDate(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (trimmed === "present" || trimmed === "current" || trimmed === "now") return null
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return null
}

function contactValue(textValue: string, field: ContactField): string | null {
  const trimmed = textValue.trim().replace(/[.,;]+$/, "")
  if (!trimmed) return null
  if (field === "contactEmail") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
      ? trimmed.slice(0, 320)
      : null
  }
  if (field === "linkedinUrl" || field === "githubUrl" || field === "websiteUrl") {
    return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed.slice(0, 500) : null
  }
  if (field === "contactPhone") return trimmed.slice(0, 50)
  return trimmed.slice(0, 200)
}

function withScheme(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

/**
 * Deterministic extraction is deliberately narrow. A missed fact can be typed
 * on the profile in seconds; a fabricated one silently becomes a trusted claim,
 * which is far worse. Only explicit first-person statements are matched.
 */
function deterministicDrafts(
  transcript: IntakeChatMessage[],
  provenance: IntakeProvenance
): { drafts: IntakePatchDraft[]; warnings: string[] } {
  const warnings: string[] = []
  const drafts: IntakePatchDraft[] = []
  const userText = transcript
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n")
    .slice(0, MAX_TEXT)
  if (!userText.trim()) {
    return { drafts: [], warnings: ["The conversation had no user statements to read."] }
  }

  const pushContact = (field: ContactField, raw: string | null | undefined, confidence = 85) => {
    if (!raw) return
    const value = contactValue(raw, field)
    if (!value) return
    drafts.push({
      kind: "CONTACT",
      data: { field, value },
      confidence,
      provenance: { ...provenance, locator: `contact:${field}` },
    })
  }

  const nameMatch =
    /(?:my name is|this is)\s+([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){0,3})/i.exec(userText)
  pushContact("contactFullName", nameMatch?.[1], 80)

  const emailMatch = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(userText)
  pushContact("contactEmail", emailMatch?.[0], 95)

  const phoneMatch =
    /(?:\b(?:phone|mobile|cell)\b\s*[:is-]*\s*)(\+?\d[\d\s().-]{6,}\d)/i.exec(userText) ??
    /(\+?\d[\d().-]{8,}\d)/.exec(userText)
  if (phoneMatch?.[1] && phoneMatch[1].replace(/\D/g, "").length >= 7) {
    pushContact("contactPhone", phoneMatch[1])
  }

  const locationMatch =
    /(?:i (?:live|am based|'m based) in|based in|located in)\s+([A-Z][^.,\n;]{1,60})/i.exec(
      userText
    )
  pushContact(
    "contactLocation",
    locationMatch?.[1]?.replace(/\s+and\s+.*$/i, "").trim(),
    75
  )

  const linkedinMatch = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9-_%]+\/?/i.exec(
    userText
  )
  if (linkedinMatch) pushContact("linkedinUrl", withScheme(linkedinMatch[0]), 95)

  const githubMatch = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]+\/?/i.exec(userText)
  if (githubMatch) pushContact("githubUrl", withScheme(githubMatch[0]), 95)

  const urls = userText.match(/https?:\/\/[^\s<>"')]+/gi) ?? []
  const website = urls.find(
    (url) => !/linkedin\.com|github\.com/i.test(url)
  )
  if (website) pushContact("websiteUrl", website, 80)

  const skillPatterns = [
    /\b(?:i (?:know|use|work with|am proficient in|have experience (?:with|in))|my skills (?:are|include)|skills:)\s+([^.\n;]+)/gi,
  ]
  const skillStops = new Set([
    "daily",
    "professionally",
    "regularly",
    "well",
    "too",
    "also",
    "a",
    "an",
    "the",
    "and",
    "or",
    "stuff",
    "things",
    "it",
    "them",
    "teams",
    "people",
    "clients",
    "customers",
    "technology",
    "technologies",
    "tools",
  ])
  const skillSeen = new Set<string>()
  for (const pattern of skillPatterns) {
    for (const match of userText.matchAll(pattern)) {
      const list = match[1] ?? ""
      for (const raw of list.split(/,|;|\/|\band\b/gi)) {
        const words = raw
          .replace(/^(?:using|with|like|such as)\s+/i, "")
          .trim()
          .replace(/[.]+$/, "")
          .split(/\s+/)
          .filter(Boolean)
        // "PostgreSQL daily" is a sentence tail, not a skill name.
        while (
          words.length > 1 &&
          skillStops.has(words[words.length - 1].toLowerCase())
        ) {
          words.pop()
        }
        const candidate = words.join(" ")
        if (!candidate) continue
        const key = candidate.toLowerCase()
        if (skillStops.has(key) || skillSeen.has(key)) continue
        if (candidate.length > 60 || !isPlausibleSkillName(candidate)) continue
        skillSeen.add(key)
        if (skillSeen.size > MAX_SKILLS) break
        drafts.push({
          kind: "SKILL",
          data: { name: candidate, category: null },
          confidence: 70,
          provenance: { ...provenance, locator: `skill:${candidate}` },
        })
      }
    }
  }

  // "I worked at Acme as a Backend Engineer from 2021 to 2023"
  const experiencePattern =
    /i (?:worked|was working|have worked) (?:at|for) ([^.,\n;]+?) (?:as|in the role of) (?:an? |the )?([^.,\n;]+?)(?: from ([12]\d{3}(?:-\d{2})?))?(?: (?:to|until|through) ([12]\d{3}(?:-\d{2})?|present))?(?=[.,;\n]|$)/gi
  for (const match of userText.matchAll(experiencePattern)) {
    const company = text(match[1])
    const role = text(match[2])
    if (!company || !role) continue
    drafts.push({
      kind: "EVIDENCE",
      data: {
        evidenceKind: "EXPERIENCE",
        title: role.slice(0, 300),
        organization: company.slice(0, 300),
        details: match[0].trim().slice(0, 2000),
        outcome: null,
        startDate: yearToDate(match[3]),
        endDate: yearToDate(match[4]),
      },
      confidence: 80,
      provenance: { ...provenance, locator: "experience:stated" },
    })
  }

  const educationPattern =
    /i (?:studied|graduated (?:with a degree )?in|have a (?:degree|bachelor'?s|master'?s) in) ([^.,\n;]+?) (?:at|from) ([^.,\n;]+)/gi
  for (const match of userText.matchAll(educationPattern)) {
    const field = text(match[1])
    const school = text(match[2])
    if (!field || !school) continue
    drafts.push({
      kind: "EVIDENCE",
      data: {
        evidenceKind: "EDUCATION",
        title: field.slice(0, 300),
        organization: school.slice(0, 300),
        details: match[0].trim().slice(0, 2000),
        outcome: null,
        startDate: null,
        endDate: null,
      },
      confidence: 75,
      provenance: { ...provenance, locator: "education:stated" },
    })
  }

  const targetMatch =
    /(?:i(?:'m| am) looking for|i want|target(?:ing)?|my next role is|target role is)\s+(?:an? )?([^.,\n;]{3,100}?)\s+(?:role|roles|job|jobs|position|positions)(?=[.,;\n]|$)/i.exec(
      userText
    )
  const target = text(targetMatch?.[1])
  if (target) {
    drafts.push({
      kind: "TARGET_ROLE",
      data: { title: target.slice(0, 200) },
      confidence: 75,
      provenance: { ...provenance, locator: "target-role:stated" },
    })
  }

  if (drafts.length === 0) {
    warnings.push(
      "No durable facts were recognized in that conversation. You can add them manually, or enable AI structuring."
    )
  }

  return { drafts, warnings }
}

function aiDrafts(
  extraction: ChatAiExtraction,
  provenance: IntakeProvenance
): IntakePatchDraft[] {
  const drafts: IntakePatchDraft[] = []
  const pushContact = (field: ContactField, raw: string | null) => {
    if (!raw) return
    const value = contactValue(raw, field)
    if (!value) return
    drafts.push({
      kind: "CONTACT",
      data: { field, value },
      confidence: 65,
      provenance: { ...provenance, locator: `contact:${field}` },
    })
  }

  if (extraction.contact) {
    pushContact("contactFullName", extraction.contact.fullName)
    pushContact("contactEmail", extraction.contact.email)
    pushContact("contactPhone", extraction.contact.phone)
    pushContact("contactLocation", extraction.contact.location)
    pushContact(
      "linkedinUrl",
      extraction.contact.linkedin ? withScheme(extraction.contact.linkedin) : null
    )
    pushContact(
      "githubUrl",
      extraction.contact.github ? withScheme(extraction.contact.github) : null
    )
    pushContact(
      "websiteUrl",
      extraction.contact.website ? withScheme(extraction.contact.website) : null
    )
  }

  for (const [index, item] of mapImportedEvidence(extraction.evidence).entries()) {
    drafts.push({
      kind: "EVIDENCE",
      data: {
        evidenceKind: item.kind,
        title: item.title,
        organization: item.organization,
        details: item.details,
        outcome: item.outcome,
        startDate: item.startDate ? item.startDate.toISOString().slice(0, 10) : null,
        endDate: item.endDate ? item.endDate.toISOString().slice(0, 10) : null,
      },
      confidence: 65,
      provenance: { ...provenance, locator: `evidence:${index + 1}` },
    })
  }

  const seen = new Set<string>()
  for (const name of mapImportedSkills(extraction.skills)) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    drafts.push({
      kind: "SKILL",
      data: { name, category: null },
      confidence: 60,
      provenance: { ...provenance, locator: `skill:${name}` },
    })
  }

  for (const raw of extraction.targetRoles.slice(0, 5)) {
    const title = text(raw)
    if (!title) continue
    drafts.push({
      kind: "TARGET_ROLE",
      data: { title: title.slice(0, 200) },
      confidence: 65,
      provenance: { ...provenance, locator: "target-role:stated" },
    })
  }

  return drafts
}

function nextQuestion(
  drafts: IntakePatchDraft[],
  missingFields: string[]
): string | null {
  const hasContact = (field: ContactField) =>
    drafts.some(
      (draft) =>
        draft.kind === "CONTACT" &&
        (draft.data as ContactPatchData).field === field
    )
  const hasEvidence = drafts.some(
    (draft) =>
      draft.kind === "EVIDENCE" &&
      (draft.data as EvidencePatchData).evidenceKind === "EXPERIENCE"
  )
  const hasSkills = drafts.some((draft) => draft.kind === "SKILL")
  const hasTarget = drafts.some((draft) => draft.kind === "TARGET_ROLE")

  const missing = new Set(missingFields.map((field) => field.toLowerCase()))
  const asks = (keys: string[]) => keys.some((key) => missing.has(key.toLowerCase()))

  const questions: Array<[boolean, string]> = [
    [
      !hasContact("contactFullName"),
      "What name should appear at the top of your resume?",
    ],
    [
      !hasContact("contactEmail"),
      "Which email address should employers use to reach you?",
    ],
    [
      !hasContact("contactLocation"),
      "Where are you based? A city and country is enough.",
    ],
    [
      !hasTarget,
      "What role are you targeting next?",
    ],
    [
      !hasEvidence,
      "Which role and company best show what you can do?",
    ],
    [
      !hasSkills,
      "Which tools, technologies or skills do you use most?",
    ],
  ]

  const stillMissing = questions.filter(([isMissing]) => isMissing)
  const preferred = stillMissing.find(([, key]) => {
    if (key.includes("name")) return asks(["contactfullname", "name"])
    if (key.includes("email")) return asks(["contactemail", "email"])
    if (key.includes("based")) return asks(["contactlocation", "location"])
    if (key.includes("targeting")) return asks(["targetrole", "targetroles", "direction"])
    if (key.includes("company")) return asks(["experience", "evidence"])
    return asks(["skills", "capability", "capabilities"])
  })

  return (preferred ?? stillMissing[0])?.[1] ?? null
}

/**
 * One entry point for both chat and voice. Deterministic extraction always
 * runs; AI is an optional improvement that can fail without failing the run.
 */
export async function extractChatFacts(input: {
  userId: string
  transcript: IntakeChatMessage[]
  missingFields?: string[]
  useAi?: boolean
  source: Extract<IntakeSource, "CHAT" | "VOICE">
  inputMode?: "MICROPHONE" | "PASTED"
}): Promise<ChatExtractionResult> {
  const adapter =
    input.source === "VOICE"
      ? input.inputMode === "MICROPHONE"
        ? "voice-microphone"
        : "voice-transcript"
      : "chat-transcript"
  const provenance: IntakeProvenance = {
    adapter,
    sourceUrl: null,
    fileName: null,
    externalId: null,
    locator: null,
    fetchedAt: new Date().toISOString(),
    detail:
      input.source === "VOICE"
        ? "User-provided speech transcript"
        : `${input.transcript.length} conversation turn${input.transcript.length === 1 ? "" : "s"}`,
  }

  const deterministic = deterministicDrafts(input.transcript, provenance)
  const warnings = [...deterministic.warnings]
  let drafts = deterministic.drafts
  let mode: "deterministic" | "ai" = "deterministic"

  if (input.useAi === true) {
    const userText = input.transcript
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n")
      .slice(0, MAX_TEXT)
    try {
      const { object } = await generateObjectTracked({
        schema: chatAiSchema,
        tracking: {
          feature: AI_USAGE_FEATURES.CAREER_IMPORT,
          surface: "app",
          userId: input.userId,
        },
        system: SYSTEM_PROMPT,
        prompt: `Extract only the career facts stated by the person in this conversation:\n${fenceUntrusted(
          "CAREER_CHAT",
          userText
        )}`,
      })
      const structured = aiDrafts(object, provenance)
      const merged = dedupeDrafts([...drafts, ...structured])
      drafts = merged.kept
      mode = "ai"
      warnings.push(
        "AI-structured facts are lower confidence. Review each one before applying."
      )
    } catch (error) {
      const message =
        error instanceof AiKeyRequiredError || error instanceof AiDailyLimitError
          ? error.message
          : "AI structuring was unavailable; the conversation was read without it."
      warnings.push(message)
    }
  }

  return {
    mode,
    patches: drafts,
    nextQuestion: nextQuestion(drafts, input.missingFields ?? []),
    warnings,
  }
}
