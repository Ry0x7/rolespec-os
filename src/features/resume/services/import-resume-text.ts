import type { ParsedResume } from "./parse-resume"

export class ResumeTextRequiredError extends Error {
  constructor() {
    super("No readable text was found. Use a text-based PDF or DOCX. Scanned resumes need OCR before uploading.")
    this.name = "ResumeTextRequiredError"
  }
}

// Only split on familiar standalone headings. Everything else stays verbatim;
// guessing employer, role and date boundaries would silently lose information.
const SECTION_HEADING = /^(?:(?:professional |career )?(?:summary|profile|experience)|work (?:experience|history)|employment(?: history)?|education|(?:technical |core )?skills|projects|certifications?|licenses?(?: and certifications)?|awards|publications|languages|volunteer(?: experience)?|interests|references)\s*:?$/i

/** Leading list glyphs, including "1." / "1)". */
const BULLET_PREFIX = /^\s*(?:[-–—•*·▪◦]|\d{1,2}[.)])\s+/

/** A date range such as "2020–Present", "Jan 2020 - Mar 2022", "2019 to 2021". */
const DATE_RANGE =
  /^(?:[A-Z][a-z]{2,8}\.?\s+)?(?:19|20)\d{2}\s*(?:[–—-]|to)\s*(?:[A-Z][a-z]{2,8}\.?\s+)?(?:(?:19|20)\d{2}|present|current|now)$/i
/** A standalone year or month-year token. */
const SINGLE_DATE = /^(?:[A-Z][a-z]{2,8}\.?\s+)?(?:19|20)\d{2}$/
/** A line that reads like an entry header rather than an achievement. */
const HEADER_CUE = /(?:\b(?:19|20)\d{2}\b|\s[|—–]\s|\s+at\s+)/i
/** Words that identify a school, without guessing from position. */
const SCHOOL_CUE = /(?:university|college|institute|school|academy|polytechnic)/i
/** Words that identify a degree, without guessing from position. */
const DEGREE_CUE = /(?:\b(?:b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?|mba|ph\.?d|bachelor|master|associate|doctor|diploma|certificate|degree)\b)/i

type ContactEntry = NonNullable<ParsedResume["contact"]>

/**
 * Contact tokens found in the leading header block of a plain-text resume.
 *
 * This is deliberately a token extractor, not a layout guess: it only consumes
 * lines whose every segment is a recognizable email, phone, profile URL or
 * city/country, so prose that happens to mention an address stays in the
 * editable text instead of disappearing into a contact field.
 */
const EMAIL_TOKEN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const PHONE_TOKEN = /(?:\+?\d[\d().\s-]{6,}\d)/
const URL_TOKEN = /(?:https?:\/\/[^\s|•·,;]+|www\.[^\s|•·,;]+)/i
const LINKEDIN_TOKEN = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\//i
const GITHUB_TOKEN = /^(?:https?:\/\/)?(?:www\.)?github\.com\//i
const JOB_TITLE_CUE =
  /\b(?:engineer|developer|programmer|manager|designer|analyst|consultant|specialist|director|architect|scientist|officer|coordinator|administrator|nurse|teacher|accountant|intern|student|assistant|technician|supervisor)\b/i

function contactSegments(line: string): string[] {
  return line
    .split(/\s*[|•·]\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/** A line that can safely be the person's name and nothing else. */
function looksLikeName(line: string): boolean {
  const value = line.trim()
  if (!value || value.length > 60) return false
  if (/[@\d|/\\]/.test(value) || /[.!?]$/.test(value)) return false
  if (JOB_TITLE_CUE.test(value)) return false
  if (/^(?:(?:professional |career )?(?:summary|profile|experience)|work (?:experience|history)|employment(?: history)?|education|(?:technical |core )?skills|projects|certifications?|awards|publications|languages|volunteer(?: experience)?|interests|references)\s*:?$/i.test(value)) return false

  const tokens = value.split(/\s+/)
  // A single CJK name is common; a single Latin word is far more likely to be
  // a heading, a company or a stray first line.
  if (tokens.length === 1) return /^[\p{Script=Han}]{2,6}$/u.test(value)
  if (tokens.length > 5) return false
  return tokens.every(
    (token) => /^[\p{L}][\p{L}.'’-]*$/u.test(token) && /^\p{Lu}/u.test(token)
  )
}

function looksLikeLocation(segment: string): boolean {
  const value = segment.trim()
  if (!value || value.length > 60) return false
  if (EMAIL_TOKEN.test(value) || URL_TOKEN.test(value)) return false
  if (/\d{3,}/.test(value.replace(/\b\d{4,5}\b/g, ""))) return false
  if (!value.includes(",") && !/^(?:remote|hybrid|on-?site)$/i.test(value)) return false
  const words = value.split(/[\s,]+/).filter(Boolean)
  return words.length >= 2 && words.length <= 7 && !/[.!?]$/.test(value)
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "")
}

function extractLeadingContact(lines: string[]): {
  contact: ContactEntry
  consumed: Set<number>
} {
  const contact: ContactEntry = {}
  const consumed = new Set<number>()
  let sawContactEvidence = false

  // First pass: read every recognizable token, whether or not its line is
  // entirely contact data. This keeps the fields populated even when a line
  // mixes a label with a value.
  for (const line of lines) {
    const email = line.match(EMAIL_TOKEN)?.[0]
    if (email && !contact.email) {
      contact.email = email
      sawContactEvidence = true
    }
    const url = line.match(URL_TOKEN)?.[0]
    if (url) {
      sawContactEvidence = true
      const normalized = url.startsWith("www.") ? `https://${url}` : url
      if (LINKEDIN_TOKEN.test(normalized) && !contact.linkedin) contact.linkedin = normalized
      else if (GITHUB_TOKEN.test(normalized) && !contact.github) contact.github = normalized
      else if (!contact.website) contact.website = normalized
    }
    const phone = line.match(PHONE_TOKEN)?.[0]
    if (phone && phoneDigits(phone).length >= 7 && !contact.phone) {
      contact.phone = phone.trim()
      sawContactEvidence = true
    }
  }

  if (!sawContactEvidence) return { contact: {}, consumed }

  // A name only counts when there is other contact evidence, so an
  // unstructured resume whose first line happens to look like a name keeps all
  // of its text instead of silently losing a line.
  const nameIndex = lines.findIndex((line) => looksLikeName(line))
  if (nameIndex !== -1) {
    contact.fullName = lines[nameIndex].trim()
    consumed.add(nameIndex)
  }

  // Second pass: consume only lines that are wholly contact data. A sentence
  // that mentions an email stays in the editable text.
  lines.forEach((line, index) => {
    if (consumed.has(index)) return
    const segments = contactSegments(line)
    if (segments.length === 0) return
    const everySegmentRecognized = segments.every((segment) => {
      if (EMAIL_TOKEN.test(segment)) return true
      if (PHONE_TOKEN.test(segment) && phoneDigits(segment).length >= 7) return true
      if (URL_TOKEN.test(segment)) return true
      return looksLikeLocation(segment)
    })
    if (!everySegmentRecognized) return

    const location = segments.find((segment) => looksLikeLocation(segment))
    if (location && !contact.location) contact.location = location
    consumed.add(index)
  })

  return { contact, consumed }
}

type SectionKind =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications"
  | "custom"

type ExperienceEntry = NonNullable<ParsedResume["experience"]>[number]
type EducationEntry = NonNullable<ParsedResume["education"]>[number]
type SkillEntry = NonNullable<ParsedResume["skills"]>[number]
type ProjectEntry = NonNullable<ParsedResume["projects"]>[number]
type CertificationEntry = NonNullable<ParsedResume["certifications"]>[number]

/** Drops undefined/empty fields so the persisted JSON keeps its historical shape. */
function compact<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entry]) => {
    if (entry === undefined || entry === null) return false
    if (typeof entry === "string") return entry.trim().length > 0
    if (Array.isArray(entry)) return entry.length > 0
    return true
  })
  return Object.fromEntries(entries) as T
}

function isBullet(line: string): boolean {
  return BULLET_PREFIX.test(line)
}

function stripBullet(line: string): string {
  return line.replace(BULLET_PREFIX, "").trim()
}

/** Splits a section into entries on blank lines, dropping empty entries. */
function splitBlocks(lines: string[]): string[][] {
  const blocks: string[][] = []
  let current: string[] = []
  const flush = () => {
    if (current.length > 0) blocks.push(current)
    current = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (line) current.push(line)
    else flush()
  }
  flush()
  return blocks
}

/**
 * Experience entries without inventing structure. A non-bullet line starts a
 * new entry (a header); every other line is an achievement. The header is kept
 * verbatim in `role` — it may contain company and dates, which is truthful,
 * whereas splitting it into role/company would be a guess. A lone line that
 * does not look like a header is kept as a bullet so it stays tailorable.
 */
function parseExperience(lines: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = []
  let header: string | undefined
  let bullets: string[] = []
  let sawBullet = false

  const flush = () => {
    if (!header && bullets.length === 0) return
    // A lone line with nothing under it is an entry only when it reads like a
    // header; otherwise it is the achievement itself.
    if (header && bullets.length === 0 && !sawBullet && !looksLikeHeader(header)) {
      entries.push({ bullets: [header] })
    } else {
      entries.push(compact<ExperienceEntry>({ role: header, bullets }))
    }
    header = undefined
    bullets = []
    sawBullet = false
  }

  for (const raw of lines) {
    const line = raw.trim()
    // Blank lines are layout, not entry boundaries: a header is commonly
    // followed by a blank line before its bullets.
    if (!line) continue
    if (isBullet(line)) {
      bullets.push(stripBullet(line))
      sawBullet = true
      continue
    }
    if (header && sawBullet) flush()
    if (header) {
      // A plain line under a header, before any bullets, is prose belonging to
      // that entry. Keeping it as a bullet preserves the wording.
      bullets.push(line)
      continue
    }
    header = line
  }
  flush()
  return entries
}

function looksLikeHeader(line: string): boolean {
  return HEADER_CUE.test(line)
}

/**
 * Split "A — B — 2020" on explicit separators only. Returns null when the line
 * has no separator, so the caller keeps it verbatim instead of guessing.
 */
function splitOnSeparator(line: string): string[] | null {
  const parts = line
    .split(/\s+[—–]\s+|\s+\|\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : null
}

/** Moves a clearly date-only token into start/end dates. */
function takeDates(parts: string[]): {
  rest: string[]
  dates: { startDate?: string; endDate?: string; current?: boolean }
} {
  const rest: string[] = []
  let dates: { startDate?: string; endDate?: string; current?: boolean } = {}

  for (const part of parts) {
    if (DATE_RANGE.test(part)) {
      const [start, end] = part.split(/\s*(?:[–—-]|to)\s*/i)
      dates = {
        startDate: start,
        endDate: /present|current|now/i.test(end) ? undefined : end,
        ...(/present|current|now/i.test(end) ? { current: true } : {}),
      }
      continue
    }
    if (SINGLE_DATE.test(part) && !dates.endDate && !dates.startDate) {
      dates = { endDate: part }
      continue
    }
    rest.push(part)
  }

  return { rest, dates }
}

/**
 * Education entries from explicit cues only. Position is not evidence: an
 * entry may be "School — Degree — Year" or "Degree — School". The school and
 * degree cues decide which is which; anything ambiguous stays in `school`
 * verbatim so no wording is lost or reassigned.
 */
function parseEducation(lines: string[]): EducationEntry[] {
  return splitBlocks(lines)
    .map((block) => block.join(" — "))
    .map((line) => {
      const separated = splitOnSeparator(line)
      if (!separated) return compact<EducationEntry>({ school: line })

      const { rest, dates } = takeDates(separated)
      if (rest.length === 0) return compact<EducationEntry>({ school: line })

      const school = rest.find((part) => SCHOOL_CUE.test(part))
      const degree = rest.find((part) => DEGREE_CUE.test(part))
      if (!school || !degree) {
        return compact<EducationEntry>({ school: line })
      }

      const leftovers = rest.filter((part) => part !== school && part !== degree)
      return compact<EducationEntry>({
        school: [school, ...leftovers].join(" — "),
        degree,
        ...dates,
      })
    })
}

/** Skills stay exactly the words in the source; no vocabulary is inferred. */
function parseSkills(lines: string[]): SkillEntry[] {
  const entries: SkillEntry[] = []

  for (const raw of lines) {
    const line = stripBullet(raw)
    if (!line) continue

    const labelled = line.match(/^([^:]{2,40}):\s*(.+)$/)
    const category = labelled && !/[.!?]$/.test(labelled[1]) ? labelled[1].trim() : ""
    const list = labelled && category ? labelled[2] : line
    const skills = list
      .split(/[,;|]+/)
      .map((skill) => skill.trim())
      .filter(Boolean)
      .filter((skill, index, all) => all.indexOf(skill) === index)

    if (skills.length === 0) continue
    entries.push(compact<SkillEntry>({ category, skills }))
  }

  return entries
}

/** Project entries keep the header verbatim; only bullets are stripped. */
function parseProjects(lines: string[]): ProjectEntry[] {
  const entries: ProjectEntry[] = []
  let name: string | undefined
  let bullets: string[] = []
  let technologies: string[] = []

  const flush = () => {
    if (!name && bullets.length === 0 && technologies.length === 0) return
    entries.push(compact<ProjectEntry>({ name, bullets, technologies }))
    name = undefined
    bullets = []
    technologies = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const tech = line.match(/^technologies\s*:\s*(.+)$/i)
    if (tech) {
      technologies = tech[1]
        .split(/[,;|]+/)
        .map((item) => item.trim())
        .filter(Boolean)
      continue
    }
    if (isBullet(line)) {
      bullets.push(stripBullet(line))
      continue
    }
    if (name) flush()
    name = line
  }
  flush()
  return entries
}

function parseCertifications(lines: string[]): CertificationEntry[] {
  return lines
    .map((line) => stripBullet(line))
    .filter(Boolean)
    .map((line) => ({ name: line }))
}

function sectionKind(title: string): SectionKind {
  const normalized = title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/:$/, "")
    .trim()

  if (/^(?:(?:professional|career) )?(?:summary|profile)$/.test(normalized)) return "summary"
  if (
    /^(?:(?:work|professional) )?(?:experience|history)$/.test(normalized) ||
    /^employment(?: history)?$/.test(normalized) ||
    /^work history$/.test(normalized)
  ) {
    return "experience"
  }
  if (/^education(?: and training)?$/.test(normalized)) return "education"
  if (/^(?:(?:technical|core|key) )?skills(?: and tools)?$/.test(normalized)) return "skills"
  if (/^(?:personal |selected )?projects$/.test(normalized)) return "projects"
  if (/^(?:licenses? and )?certifications?$/.test(normalized) || /^licenses?$/.test(normalized)) {
    return "certifications"
  }
  return "custom"
}

export function importResumeText(text: string): ParsedResume {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
    // pdf-parse adds page delimiters; they are not resume content.
    .filter((line) => !/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/.test(line))
  if (!lines.some((line) => /[\p{L}\p{N}]/u.test(line))) {
    throw new ResumeTextRequiredError()
  }

  const sections: Array<{ title: string; lines: string[]; leading: boolean }> = []
  let title = "Imported details"
  let content: string[] = []
  // Lines before the first recognized heading are the header block. They are
  // the only place contact details are read from, so a stray email later in a
  // summary cannot become the resume owner's address.
  let leading = true
  function flush() {
    if (content.some((line) => line.trim())) sections.push({ title, lines: content, leading })
    content = []
  }
  for (const line of lines) {
    if (SECTION_HEADING.test(line.trim())) {
      flush()
      title = line.trim().replace(/:$/, "")
      leading = false
    } else {
      content.push(line)
    }
  }
  flush()

  const headerSection = sections.find((section) => section.leading)
  const leadingContact = headerSection
    ? extractLeadingContact(headerSection.lines)
    : { contact: {}, consumed: new Set<number>() }
  if (headerSection) {
    headerSection.lines = headerSection.lines.filter((_, index) => !leadingContact.consumed.has(index))
  }
  // A document consisting only of headings still has readable source text.
  if (sections.length === 0) {
    sections.push({ title: "Imported details", lines, leading: true })
  }

  const importedSections: NonNullable<ParsedResume["importedSections"]> = []
  const summary: NonNullable<ParsedResume["summary"]> = {}
  const experience: NonNullable<ParsedResume["experience"]> = []
  const education: NonNullable<ParsedResume["education"]> = []
  const skills: NonNullable<ParsedResume["skills"]> = []
  const projects: NonNullable<ParsedResume["projects"]> = []
  const certifications: NonNullable<ParsedResume["certifications"]> = []

  for (const section of sections) {
    const kind = sectionKind(section.title)
    if (kind === "custom") {
      const value = section.lines.join("\n").trim()
      if (value) importedSections.push({ title: section.title, content: value })
      continue
    }

    if (kind === "summary") {
      const value = section.lines.join(" ").replace(/\s+/g, " ").trim()
      if (value) summary.text = value
      continue
    }
    if (kind === "experience") {
      experience.push(...parseExperience(section.lines))
      continue
    }
    if (kind === "education") {
      education.push(...parseEducation(section.lines))
      continue
    }
    if (kind === "skills") {
      skills.push(...parseSkills(section.lines))
      continue
    }
    if (kind === "projects") {
      projects.push(...parseProjects(section.lines))
      continue
    }
    certifications.push(...parseCertifications(section.lines))
  }

  return {
    title: "", // The route uses the sanitized filename.
    contact: leadingContact.contact,
    summary,
    experience,
    education,
    skills,
    projects,
    certifications,
    importedSections,
  }
}
