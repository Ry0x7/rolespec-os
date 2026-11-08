/**
 * Pure planning for assisted ATS form filling.
 *
 * There is no `chrome` or DOM access here: the side panel receives a neutral
 * description of each visible form control, this module decides what may be
 * filled automatically, and the injected page function performs the writes.
 *
 * The safety rule is one-way: only a small, explicit allowlist of factual
 * contact fields is ever written without an approval. Anything touching work
 * authorization, sponsorship, pay, demographics, legal history, essays or a
 * field we do not recognise goes to the review queue and stays untouched until
 * the user saves an answer for that exact question. Nothing in this module can
 * submit a form.
 */

export const AUTOFILL_CATEGORIES = [
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

export type AutofillCategory = (typeof AUTOFILL_CATEGORIES)[number]

export type FieldSensitivity = "safe" | "sensitive" | "unknown"

/** One visible form control, as read by `scanAutofillFields` in the page. */
export interface FieldDescriptor {
  /** Opaque per-scan id the page function uses to find the element again. */
  id: string
  label: string
  name?: string
  type?: string
  autocomplete?: string
  tagName?: string
  required?: boolean
  /** Select/radio choices, for the review queue only. Never auto-selected. */
  options?: string[]
}

export interface ProfileFacts {
  fullName?: string | null
  email?: string | null
  phone?: string | null
  location?: string | null
  linkedinUrl?: string | null
  githubUrl?: string | null
  websiteUrl?: string | null
  currentRole?: string | null
  targetRole?: string | null
  workAuthorization?: string | null
  requiresSponsorship?: boolean | null
  salaryMin?: number | null
  salaryMax?: number | null
  salaryCurrency?: string | null
}

export type ApprovedAnswers = Record<string, string>

export interface FieldClassification {
  category: AutofillCategory
  sensitivity: FieldSensitivity
  /** Stable key for the approved-answer cache, derived from the visible label. */
  key: string
  /** Which profile fact answers it, when it is a safe field. */
  profileKey?: keyof ProfileFacts
  /** Short explanation shown on a review row. */
  reason?: string
}

export interface PlannedFill {
  fieldId: string
  label: string
  key: string
  value: string
  /** True when the value came from the user's approved-answer cache. */
  approved: boolean
  category: AutofillCategory
}

export interface ReviewField {
  fieldId: string
  label: string
  key: string
  category: AutofillCategory
  sensitivity: FieldSensitivity
  reason: string
  required: boolean
  options?: string[]
  /** A profile fact the user can accept, or use as a starting point. */
  suggestedValue?: string
  /** True when the field is a file upload specifically for a resume or CV. */
  isResumeUpload?: boolean
}

export interface FillPlan {
  fills: PlannedFill[]
  review: ReviewField[]
  /** Fields skipped for a mechanical reason, e.g. an unchecked checkbox. */
  skipped: number
}

const SAFE_CATEGORIES = new Set<AutofillCategory>(["identity", "contact", "link"])

/** Normalises a label/name so the same question matches across ATS vendors. */
export function answerKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 180)
}

function textFor(field: FieldDescriptor): string {
  return answerKey([field.label, field.name, field.id].filter(Boolean).join(" "))
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

/**
 * Classifies by the most dangerous meaning first. A label such as "Work email"
 * must stay a safe contact field, while "Are you authorized to work?" must not
 * be mistaken for an address field just because it contains "work".
 */
export function classifyField(field: FieldDescriptor): FieldClassification {
  const text = textFor(field)
  const autocomplete = (field.autocomplete ?? "").toLowerCase()
  const type = (field.type ?? "").toLowerCase()
  const tag = (field.tagName ?? "").toLowerCase()
  const key = answerKey(field.label || field.name || field.id || "field")

  const sensitive = (
    category: AutofillCategory,
    reason: string
  ): FieldClassification => ({ category, sensitivity: "sensitive", key, reason })

  // ── Sensitive questions: never inferred from a profile, never auto-filled ──
  // Sponsorship is checked first: "Will you require visa sponsorship?" contains
  // "visa", so the authorization rule would otherwise swallow it.
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
      key,
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
      key,
      reason: "Free-text answers stay untouched until you approve one.",
    }
  }

  // ── Safe identity and contact facts ────────────────────────────────────────
  if (autocomplete === "given-name" || hasAny(text, [/\bfirst name\b/, /\bgiven name\b/])) {
    return { category: "identity", sensitivity: "safe", key, profileKey: "fullName" }
  }
  if (autocomplete === "family-name" || hasAny(text, [/\blast name\b/, /\bsurname\b/, /\bfamily name\b/])) {
    return { category: "identity", sensitivity: "safe", key, profileKey: "fullName" }
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
    return { category: "identity", sensitivity: "safe", key, profileKey: "fullName" }
  }
  if (autocomplete === "email" || type === "email" || hasAny(text, [/\be ?mail\b/])) {
    return { category: "contact", sensitivity: "safe", key, profileKey: "email" }
  }
  if (autocomplete === "tel" || type === "tel" || hasAny(text, [/\bphone\b/, /\bmobile\b/, /\btelephone\b/])) {
    return { category: "contact", sensitivity: "safe", key, profileKey: "phone" }
  }
  if (
    autocomplete === "address-level2" ||
    hasAny(text, [/\blocation\b/, /\bcity\b/, /\bcurrent city\b/, /\bwhere are you based\b/])
  ) {
    return { category: "contact", sensitivity: "safe", key, profileKey: "location" }
  }
  if (autocomplete === "url" || hasAny(text, [/\blinkedin\b/])) {
    return { category: "link", sensitivity: "safe", key, profileKey: "linkedinUrl" }
  }
  if (hasAny(text, [/\bgithub\b/])) {
    return { category: "link", sensitivity: "safe", key, profileKey: "githubUrl" }
  }
  if (
    hasAny(text, [/\bportfolio\b/, /\bwebsite\b/, /\bpersonal site\b/, /\bhomepage\b/]) ||
    (autocomplete === "url" && !hasAny(text, [/\blinkedin\b/]))
  ) {
    return { category: "link", sensitivity: "safe", key, profileKey: "websiteUrl" }
  }

  // ── Known but not auto-fillable: review queue ──────────────────────────────
  if (hasAny(text, [/\bcurrent (company|employer)\b/, /\bcompany\b/, /\bemployer\b/])) {
    return { category: "work", sensitivity: "unknown", key, reason: "Employer facts need review." }
  }
  if (hasAny(text, [/\bjob title\b/, /\bcurrent (role|title|position)\b/, /\bposition\b/])) {
    return { category: "work", sensitivity: "unknown", key, profileKey: "currentRole", reason: "Confirm this title before filling." }
  }
  if (hasAny(text, [/\bschool\b/, /\buniversity\b/, /\bcollege\b/, /\bdegree\b/, /\bmajor\b/, /\bgraduat/])) {
    return { category: "education", sensitivity: "unknown", key, reason: "Education facts need review." }
  }

  // A select/radio/checkbox is never guessed at, even when the label is benign:
  // the option set is the employer's, and a wrong choice is worse than a blank.
  if (tag === "select" || type === "radio" || type === "checkbox") {
    return { category: "unknown", sensitivity: "unknown", key, reason: "Choose this option yourself." }
  }

  return {
    category: "unknown",
    sensitivity: "unknown",
    key,
    reason: "RoleSpec does not recognise this field.",
  }
}

/** Splits a full name without inventing one when there is nothing to split. */
export function splitFullName(fullName: string | null | undefined): {
  first: string
  last: string
} {
  const text = (fullName ?? "").trim().replace(/\s+/g, " ")
  if (!text) return { first: "", last: "" }
  const parts = text.split(" ")
  if (parts.length === 1) return { first: parts[0], last: "" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

function profileValue(
  profileKey: keyof ProfileFacts | undefined,
  profile: ProfileFacts,
  field: FieldDescriptor
): string {
  if (!profileKey) return ""
  if (profileKey === "currentRole") return (profile.currentRole ?? "").trim()

  const value = profile[profileKey]
  if (typeof value === "number") return String(value)
  if (typeof value !== "string") return ""

  if (profileKey === "fullName") {
    const { first, last } = splitFullName(value)
    const key = answerKey(field.label || field.name || "")
    if (/\bfirst\b|\bgiven\b/.test(key)) return first
    if (/\blast\b|\bsurname\b|\bfamily\b/.test(key)) return last
    return value.trim()
  }

  return value.trim()
}

function isFillable(field: FieldDescriptor): boolean {
  const tag = (field.tagName ?? "").toLowerCase()
  const type = (field.type ?? "").toLowerCase()
  if (tag === "select") return true
  if (tag === "textarea") return true
  if (tag !== "input") return false
  return ["text", "email", "tel", "url", "search", ""].includes(type)
}

/**
 * Builds the complete plan. `approvedAnswers` is the only path by which a
 * sensitive field can enter `fills`; a value there was saved by the user for
 * that exact question in this panel.
 */
export function buildFillPlan(
  profile: ProfileFacts,
  fields: FieldDescriptor[],
  approvedAnswers: ApprovedAnswers = {}
): FillPlan {
  const fills: PlannedFill[] = []
  const review: ReviewField[] = []
  let skipped = 0

  for (const field of fields) {
    const classification = classifyField(field)
    const approvedValue = approvedAnswers[classification.key]?.trim()
    const label = field.label.trim() || field.name?.trim() || "Untitled field"

    if (approvedValue) {
      if (!isFillable(field)) {
        skipped += 1
        review.push({
          ...toReview(field, classification),
          reason: "RoleSpec cannot safely set this control type; choose it yourself.",
          suggestedValue: approvedValue,
        })
        continue
      }
      fills.push({
        fieldId: field.id,
        label,
        key: classification.key,
        value: approvedValue,
        approved: true,
        category: classification.category,
      })
      continue
    }

    const safe =
      classification.sensitivity === "safe" && SAFE_CATEGORIES.has(classification.category)
    const value = safe ? profileValue(classification.profileKey, profile, field) : ""

    if (safe && value) {
      fills.push({
        fieldId: field.id,
        label,
        key: classification.key,
        value,
        approved: false,
        category: classification.category,
      })
      continue
    }

    if (classification.sensitivity === "safe" && !value) {
      review.push({
        ...toReview(field, classification),
        reason: "No matching value in your RoleSpec profile.",
      })
      continue
    }

    review.push(toReview(field, classification))
  }

  return { fills, review, skipped }
}

function toReview(field: FieldDescriptor, classification: FieldClassification): ReviewField {
  const isResumeUpload =
    classification.category === "document" ||
    (field.type ?? "").toLowerCase() === "file" ||
    hasAny(textFor(field), [/\bresume\b/, /\bcv\b/, /\bcurriculum vitae\b/])
  const item: ReviewField = {
    fieldId: field.id,
    label: field.label.trim() || field.name?.trim() || "Untitled field",
    key: classification.key,
    category: classification.category,
    sensitivity: classification.sensitivity,
    reason: classification.reason ?? "Confirm this answer before filling it.",
    required: field.required === true,
  }
  if (isResumeUpload) item.isResumeUpload = true
  if (field.options && field.options.length > 0) item.options = field.options.slice(0, 40)
  return item
}

// ── Supported ATS hosts ─────────────────────────────────────────────────────

/**
 * The form filler only runs on hosts that actually host application forms. A
 * user asking to scan an unrelated page gets a clear "not supported" message
 * instead of a page-wide field scrape.
 */
export const AUTOFILL_SUPPORTED_HOSTS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "bamboohr.com",
  "smartrecruiters.com",
  "jobvite.com",
  "icims.com",
  "taleo.net",
  "myworkdayjobs.com",
  "workday.com",
  "recruitee.com",
  "teamtailor.com",
  "personio.com",
] as const

/** The matched supported host suffix, or null when the URL is not an ATS page. */
export function autofillHostFor(url: string | undefined | null): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
  const host = parsed.hostname.toLowerCase()
  for (const suffix of AUTOFILL_SUPPORTED_HOSTS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return suffix
  }
  return null
}

export function isAutofillSupportedUrl(url: string | undefined | null): boolean {
  return autofillHostFor(url) !== null
}
