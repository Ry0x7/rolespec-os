/**
 * Server-side ATS field classification and fill planning.
 *
 * The extension has its own copy of this logic for immediate UI feedback, but
 * this module is the security boundary: the server never trusts the
 * classification a client sends. It re-derives the meaning and sensitivity of
 * every detected control, and only facts the user already stored, or answers
 * they explicitly approved, can become planned writes.
 *
 * The rules are deliberately conservative:
 *  - work authorization, sponsorship, pay, demographics and legal history are
 *    always sensitive;
 *  - file uploads, essays, selects, radios and checkboxes are never written;
 *  - a typeahead that discards free text is never written;
 *  - a control whose meaning is not recognised stays UNKNOWN.
 */

export const ATS_CATEGORIES = [
  "identity",
  "contact",
  "link",
  "work",
  "education",
  "compensation",
  "authorization",
  "sponsorship",
  "demographic",
  "legal",
  "essay",
  "document",
  "unknown",
] as const

export type AtsCategory = (typeof ATS_CATEGORIES)[number]
export type AtsSensitivity = "safe" | "sensitive" | "unknown"

export interface AtsFieldInput {
  fieldId: string
  label: string
  name?: string
  type?: string
  tagName?: string
  autocomplete?: string
  required?: boolean
  options?: string[]
  requiresSelection?: boolean
  frameId?: number
}

export interface AtsFieldClassification {
  category: AtsCategory
  sensitivity: AtsSensitivity
  questionKey: string
  profileKey?: ProfileFactKey
  reason?: string
}

export type ProfileFactKey =
  | "fullName"
  | "email"
  | "phone"
  | "location"
  | "linkedinUrl"
  | "githubUrl"
  | "websiteUrl"
  | "currentRole"

export interface AtsProfileFacts {
  fullName?: string | null
  email?: string | null
  phone?: string | null
  location?: string | null
  linkedinUrl?: string | null
  githubUrl?: string | null
  websiteUrl?: string | null
  currentRole?: string | null
}

export interface AtsApprovedAnswer {
  id: string
  questionKey: string
  value: string
  scope: "APPLICATION" | "GLOBAL"
  category: string
}

export type AtsFieldDecision = "FILL" | "REVIEW" | "ATTACH_RESUME"

export interface AtsPlannedField {
  fieldId: string
  label: string
  questionKey: string
  category: AtsCategory
  sensitivity: AtsSensitivity
  decision: AtsFieldDecision
  required: boolean
  frameId?: number
  /** The profile fact backing a FILL decision. Never the value itself. */
  profileKey?: ProfileFactKey
  /** The approved answer backing a FILL decision. Never the value itself. */
  answerId?: string
  reason?: string
}

export interface AtsFieldPlan {
  fields: AtsPlannedField[]
  fillCount: number
  reviewCount: number
  resumeUploadCount: number
}

const SAFE_CATEGORIES = new Set<AtsCategory>(["identity", "contact", "link"])

/** Identical to the extension's key so answer memory matches across both copies. */
export function answerKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 180)
}

function textFor(field: AtsFieldInput): string {
  return answerKey([field.label, field.name, field.fieldId].filter(Boolean).join(" "))
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

/**
 * Classifies by the most dangerous meaning first. Keeping this ordering is what
 * stops "Will you require visa sponsorship?" being read as an authorization
 * field, and "Work email" being read as an authorization question.
 */
export function classifyAtsField(field: AtsFieldInput): AtsFieldClassification {
  const text = textFor(field)
  const autocomplete = (field.autocomplete ?? "").toLowerCase()
  const type = (field.type ?? "").toLowerCase()
  const tag = (field.tagName ?? "").toLowerCase()
  const questionKey = answerKey(field.label || field.name || field.fieldId || "field")

  const sensitive = (
    category: AtsCategory,
    reason: string
  ): AtsFieldClassification => ({ category, sensitivity: "sensitive", questionKey, reason })

  if (hasAny(text, [/\bsponsor/, /\bsponsorship\b/])) {
    return sensitive("sponsorship", "Sponsorship needs your explicit answer.")
  }

  if (
    hasAny(text, [
      /\bauthoriz(ed|ation)\b/,
      /\bright to work\b/,
      /\bwork permit\b/,
      /\bvisa\b/,
      /\bimmigration status\b/,
      /\beligible to work\b/,
    ])
  ) {
    return sensitive("authorization", "Work authorization needs your explicit answer.")
  }

  if (
    hasAny(text, [
      /\bsalary\b/,
      /\bcompensation\b/,
      /\bpay expectation/,
      /\bdesired (pay|rate|salary)\b/,
      /\bexpected (pay|rate|salary)\b/,
      /\bhourly rate\b/,
    ])
  ) {
    return sensitive("compensation", "Pay expectations are sensitive; confirm the number.")
  }

  if (
    hasAny(text, [
      /\bgender\b/,
      /\bpronoun/,
      /\brace\b/,
      /\bethnic/,
      /\bveteran\b/,
      /\bdisabilit/,
      /\bsexual orientation\b/,
      /\bdate of birth\b/,
      /\bdob\b/,
      /\bage\b/,
    ])
  ) {
    return sensitive("demographic", "Demographic questions are voluntary and must not be guessed.")
  }

  if (
    hasAny(text, [
      /\bcriminal\b/,
      /\bconviction\b/,
      /\bbackground check\b/,
      /\bssn\b/,
      /\bsocial security\b/,
      /\bnational id\b/,
      /\btax id\b/,
    ])
  ) {
    return sensitive("legal", "Legal and identity-history questions require your own answer.")
  }

  if (type === "file" || hasAny(text, [/\bresume\b/, /\bcv\b/, /\bcover letter upload\b/])) {
    return {
      category: "document",
      sensitivity: "sensitive",
      questionKey,
      reason: "File uploads are never automated. Attach the document yourself.",
    }
  }

  if (
    tag === "textarea" ||
    hasAny(text, [
      /\bcover letter\b/,
      /\bwhy (do|are) you\b/,
      /\btell us\b/,
      /\bessay\b/,
      /\badditional information\b/,
      /\bmessage to\b/,
    ])
  ) {
    return {
      category: "essay",
      sensitivity: "sensitive",
      questionKey,
      reason: "Free-text answers stay untouched until you approve one.",
    }
  }

  if (tag === "select" || type === "radio" || type === "checkbox") {
    return {
      category: "unknown",
      sensitivity: "unknown",
      questionKey,
      reason: "Choose this option yourself.",
    }
  }

  if (autocomplete === "given-name" || hasAny(text, [/\bfirst name\b/, /\bgiven name\b/])) {
    return { category: "identity", sensitivity: "safe", questionKey, profileKey: "fullName" }
  }
  if (autocomplete === "family-name" || hasAny(text, [/\blast name\b/, /\bsurname\b/, /\bfamily name\b/])) {
    return { category: "identity", sensitivity: "safe", questionKey, profileKey: "fullName" }
  }
  const genericName =
    (autocomplete === "name" || hasAny(text, [/\bfull name\b/, /\byour name\b/, /\bname\b/])) &&
    !hasAny(text, [
      /\bcompany name\b/,
      /\bemployer name\b/,
      /\borganization name\b/,
      /\bschool name\b/,
      /\buniversity name\b/,
      /\breference name\b/,
    ])
  if (genericName) {
    return { category: "identity", sensitivity: "safe", questionKey, profileKey: "fullName" }
  }
  if (autocomplete === "email" || type === "email" || hasAny(text, [/\be ?mail\b/])) {
    return { category: "contact", sensitivity: "safe", questionKey, profileKey: "email" }
  }
  if (autocomplete === "tel" || type === "tel" || hasAny(text, [/\bphone\b/, /\bmobile\b/, /\btelephone\b/])) {
    return { category: "contact", sensitivity: "safe", questionKey, profileKey: "phone" }
  }
  if (
    autocomplete === "address-level2" ||
    hasAny(text, [/\blocation\b/, /\bcity\b/, /\bcurrent city\b/, /\bwhere are you based\b/])
  ) {
    return { category: "contact", sensitivity: "safe", questionKey, profileKey: "location" }
  }
  if (autocomplete === "url" || hasAny(text, [/\blinkedin\b/])) {
    return { category: "link", sensitivity: "safe", questionKey, profileKey: "linkedinUrl" }
  }
  if (hasAny(text, [/\bgithub\b/])) {
    return { category: "link", sensitivity: "safe", questionKey, profileKey: "githubUrl" }
  }
  if (
    hasAny(text, [/\bportfolio\b/, /\bwebsite\b/, /\bpersonal site\b/, /\bhomepage\b/]) ||
    (autocomplete === "url" && !hasAny(text, [/\blinkedin\b/]))
  ) {
    return { category: "link", sensitivity: "safe", questionKey, profileKey: "websiteUrl" }
  }

  if (hasAny(text, [/\bcurrent (company|employer)\b/, /\bcompany\b/, /\bemployer\b/])) {
    return {
      category: "work",
      sensitivity: "unknown",
      questionKey,
      reason: "Employer facts need review.",
    }
  }
  if (hasAny(text, [/\bjob title\b/, /\bcurrent (role|title|position)\b/, /\bposition\b/])) {
    return {
      category: "work",
      sensitivity: "unknown",
      questionKey,
      profileKey: "currentRole",
      reason: "Confirm this title before filling.",
    }
  }
  if (hasAny(text, [/\bschool\b/, /\buniversity\b/, /\bcollege\b/, /\bdegree\b/, /\bmajor\b/, /\bgraduat/])) {
    return {
      category: "education",
      sensitivity: "unknown",
      questionKey,
      reason: "Education facts need review.",
    }
  }

  return {
    category: "unknown",
    sensitivity: "unknown",
    questionKey,
    reason: "RoleSpec does not recognise this field.",
  }
}

function isTextControl(field: AtsFieldInput): boolean {
  if (field.requiresSelection) return false
  const tag = (field.tagName ?? "input").toLowerCase()
  const type = (field.type ?? "text").toLowerCase()
  if (tag === "textarea" || tag === "select") return false
  if (tag !== "input") return false
  return ["text", "email", "tel", "url", "search", ""].includes(type)
}

/** The value the profile supplies for a safe fact, split for first/last name fields. */
export function profileValueFor(
  profileKey: ProfileFactKey | undefined,
  profile: AtsProfileFacts,
  field: AtsFieldInput
): string {
  if (!profileKey) return ""
  const value = profile[profileKey]
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (profileKey === "fullName") {
    const parts = trimmed.split(/\s+/)
    const key = answerKey(field.label || field.name || "")
    if (/\bfirst\b|\bgiven\b/.test(key)) return parts[0] ?? ""
    if (/\blast\b|\bsurname\b|\bfamily\b/.test(key)) return parts.slice(1).join(" ")
  }
  return trimmed
}

/**
 * Builds the server's decision for every detected field. It never includes a
 * value: the extension writes only values it already holds, and sensitive
 * answers live in `AtsAnswer` with their own provenance.
 */
export function buildAtsFieldPlan(input: {
  fields: AtsFieldInput[]
  profile: AtsProfileFacts
  answers: AtsApprovedAnswer[]
}): AtsFieldPlan {
  const answerByKey = new Map<string, AtsApprovedAnswer>()
  for (const answer of input.answers) {
    // Application-scoped answers are applied by the caller before this map, so
    // the first entry for a key is already the most specific one.
    if (!answerByKey.has(answer.questionKey)) answerByKey.set(answer.questionKey, answer)
  }

  const planned: AtsPlannedField[] = []
  for (const field of input.fields.slice(0, 150)) {
    const classification = classifyAtsField(field)
    const base = {
      fieldId: field.fieldId.slice(0, 80),
      label: (field.label || field.name || "Untitled field").trim().slice(0, 300),
      questionKey: classification.questionKey,
      category: classification.category,
      sensitivity: classification.sensitivity,
      required: field.required === true,
      ...(typeof field.frameId === "number" ? { frameId: field.frameId } : {}),
    }

    if (classification.category === "document") {
      planned.push({
        ...base,
        decision: "ATTACH_RESUME",
        reason: "The user attaches a resume explicitly; no file is injected silently.",
      })
      continue
    }

    const answer = answerByKey.get(classification.questionKey)
    if (
      answer &&
      isTextControl(field) &&
      (classification.sensitivity !== "sensitive" || answer.scope === "APPLICATION")
    ) {
      planned.push({
        ...base,
        decision: "FILL",
        answerId: answer.id,
        reason:
          classification.sensitivity === "sensitive"
            ? "You approved this answer for this application."
            : "A user-approved answer exists for this exact question.",
      })
      continue
    }

    if (answer && classification.sensitivity === "sensitive" && answer.scope === "GLOBAL") {
      planned.push({
        ...base,
        decision: "REVIEW",
        answerId: answer.id,
        reason:
          "A browser-wide answer exists, but this sensitive question needs approval for this application.",
      })
      continue
    }

    const safe =
      classification.sensitivity === "safe" && SAFE_CATEGORIES.has(classification.category)
    const value = safe
      ? profileValueFor(classification.profileKey, input.profile, field)
      : ""

    if (safe && value && isTextControl(field)) {
      planned.push({
        ...base,
        decision: "FILL",
        ...(classification.profileKey ? { profileKey: classification.profileKey } : {}),
      })
      continue
    }

    if (answer) {
      planned.push({
        ...base,
        decision: "REVIEW",
        answerId: answer.id,
        reason:
          "A saved answer exists, but this control type must be chosen by the user on the page.",
      })
      continue
    }

    planned.push({
      ...base,
      decision: "REVIEW",
      reason:
        classification.sensitivity === "safe" && !value
          ? "No matching value in your RoleSpec career profile."
          : classification.reason ?? "Confirm this answer before filling it.",
    })
  }

  return {
    fields: planned,
    fillCount: planned.filter((field) => field.decision === "FILL").length,
    reviewCount: planned.filter((field) => field.decision === "REVIEW").length,
    resumeUploadCount: planned.filter((field) => field.decision === "ATTACH_RESUME").length,
  }
}
