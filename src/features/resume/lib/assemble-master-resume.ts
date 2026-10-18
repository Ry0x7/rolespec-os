import { splitIntoBullets } from "./split-into-bullets"

export type CareerEvidenceKind =
  | "EXPERIENCE"
  | "ACHIEVEMENT"
  | "PROJECT"
  | "EDUCATION"
  | "CERTIFICATION"

export type CareerEvidenceStatus = "CANDIDATE" | "CONFIRMED" | "ARCHIVED"

export interface MasterResumeEvidenceInput {
  kind: CareerEvidenceKind
  status: CareerEvidenceStatus
  title: string
  organization?: string | null
  details?: string | null
  outcome?: string | null
  startDate?: Date | null
  endDate?: Date | null
}

export interface MasterResumeCapabilityInput {
  name: string
  category?: string | null
  confirmed: boolean
}

export interface MasterResumeProfileInput {
  evidence?: readonly MasterResumeEvidenceInput[]
  capabilities?: readonly MasterResumeCapabilityInput[]
  /** Titles of the active target roles, most relevant first. */
  targetRoleTitles?: readonly (string | null | undefined)[]
}

/**
 * What the app already knows about how to reach the user. Never invented: an
 * absent value stays absent rather than becoming a placeholder.
 *
 * The Career Profile's contact fields are the source of truth; the account
 * fields are a fallback for name and email only, so a profile that has never
 * been filled in still produces a usable header.
 */
export interface MasterResumeAccountInput {
  /** `User.name`. Used only when `contactFullName` is blank. */
  userName?: string | null
  /** `User.email`. Used only when `contactEmail` is blank. */
  userEmail?: string | null
  /** `CareerProfile.contactFullName`. */
  contactFullName?: string | null
  /** `CareerProfile.contactEmail`. */
  contactEmail?: string | null
  /** `CareerProfile.contactPhone`. */
  contactPhone?: string | null
  /** `CareerProfile.contactLocation`. */
  contactLocation?: string | null
  /** `CareerProfile.linkedinUrl`. */
  linkedinUrl?: string | null
  /** `CareerProfile.githubUrl`. */
  githubUrl?: string | null
  /** `CareerProfile.websiteUrl`. */
  websiteUrl?: string | null
}

export type MasterResumeSectionType =
  | "CONTACT"
  | "SUMMARY"
  | "EXPERIENCE"
  | "EDUCATION"
  | "SKILLS"
  | "PROJECTS"
  | "CERTIFICATIONS"
  | "CUSTOM"

export interface AssembledMasterResumeItem {
  content: Record<string, string | boolean | string[]>
  order: number
}

export interface AssembledMasterResumeSection {
  type: MasterResumeSectionType
  title: string
  order: number
  visible: true
  items: { create: AssembledMasterResumeItem[] }
}

function nonBlank(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const ENGLISH_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

function formatYearMonth(value: Date | null | undefined): string | undefined {
  if (!value || Number.isNaN(value.getTime())) return undefined

  return `${ENGLISH_MONTHS[value.getUTCMonth()]} ${value.getUTCFullYear()}`
}

function timestamp(value: Date | null | undefined): number | undefined {
  if (!value) return undefined
  const time = value.getTime()
  return Number.isNaN(time) ? undefined : time
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function structuralEvidenceKey(evidence: MasterResumeEvidenceInput): string {
  return [
    evidence.kind,
    evidence.status,
    evidence.title,
    evidence.organization ?? "",
    evidence.details ?? "",
    evidence.outcome ?? "",
    timestamp(evidence.startDate)?.toString() ?? "",
    timestamp(evidence.endDate)?.toString() ?? "",
  ].join("\u0000")
}

function compareCanonicalEvidence(
  left: MasterResumeEvidenceInput,
  right: MasterResumeEvidenceInput
): number {
  const leftStart = timestamp(left.startDate)
  const rightStart = timestamp(right.startDate)
  const leftEnd = timestamp(left.endDate)
  const rightEnd = timestamp(right.endDate)
  const leftOngoing = leftStart !== undefined && left.endDate == null
  const rightOngoing = rightStart !== undefined && right.endDate == null
  const leftEffective = leftEnd ?? leftStart
  const rightEffective = rightEnd ?? rightStart
  const leftGroup = leftOngoing ? 0 : leftEffective !== undefined ? 1 : 2
  const rightGroup = rightOngoing ? 0 : rightEffective !== undefined ? 1 : 2

  if (leftGroup !== rightGroup) return leftGroup - rightGroup
  if (leftEffective !== rightEffective) {
    return (rightEffective ?? 0) - (leftEffective ?? 0)
  }

  const titleComparison = compareText(normalized(left.title), normalized(right.title))
  if (titleComparison !== 0) return titleComparison

  const organizationComparison = compareText(
    normalized(left.organization),
    normalized(right.organization)
  )
  if (organizationComparison !== 0) return organizationComparison

  return compareText(structuralEvidenceKey(left), structuralEvidenceKey(right))
}

function sortCanonicalEvidence(
  evidence: readonly MasterResumeEvidenceInput[]
): MasterResumeEvidenceInput[] {
  return [...evidence].sort(compareCanonicalEvidence)
}

/**
 * `details` is free text that is often a prose paragraph, so it is split into
 * one bullet per line/sentence. `outcome` is a single measurable result and is
 * appended verbatim as its own trailing bullet.
 */
function bulletsFor(evidence: MasterResumeEvidenceInput): string[] {
  const outcome = nonBlank(evidence.outcome)

  return [...splitIntoBullets(evidence.details), ...(outcome ? [outcome] : [])]
}

function achievementContent(
  evidence: MasterResumeEvidenceInput
): Record<string, string | boolean | string[]> {
  const startDate = formatYearMonth(evidence.startDate)
  const endDate = formatYearMonth(evidence.endDate)
  const dates = [startDate, endDate].filter((value): value is string => Boolean(value)).join(" – ")

  const content = [
    nonBlank(evidence.organization),
    dates || undefined,
    nonBlank(evidence.details),
    nonBlank(evidence.outcome),
  ]
    .filter((value): value is string => value !== undefined)
    .join("\n")

  return {
    title: evidence.title,
    ...(content ? { content } : {}),
  }
}

function skillItems(capabilities: readonly MasterResumeCapabilityInput[]): AssembledMasterResumeItem[] {
  const groups = new Map<string, string[]>()

  for (const capability of capabilities) {
    if (!capability.confirmed) continue

    const name = nonBlank(capability.name)
    if (!name) continue

    const category = nonBlank(capability.category) ?? "Skills"
    const names = groups.get(category) ?? []
    names.push(name)
    groups.set(category, names)
  }

  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right, "en", { sensitivity: "base" }))
    .map(([category, names], order) => ({
      content: {
        category,
        skills: names.sort((left, right) =>
          left.localeCompare(right, "en", { sensitivity: "base" })
        ),
      },
      order,
    }))
}

function firstNonBlank(values: readonly (string | null | undefined)[] | undefined): string {
  for (const value of values ?? []) {
    const trimmed = nonBlank(value)
    if (trimmed) return trimmed
  }
  return ""
}

/**
 * The one CONTACT item, pre-filled with what the app already knows. The keys and
 * their order mirror `contact-editor.tsx`, which writes a flat string record and
 * nothing else — every field is present so the editor never sees a missing key,
 * and an unknown field is an empty string rather than an invented value.
 *
 * Returns no item at all when neither a name nor an email is known: the preview
 * placeholder is more honest than a contact block holding only a city.
 */
function contactItems(
  profile: MasterResumeProfileInput | null | undefined,
  account: MasterResumeAccountInput | null | undefined
): Record<string, string | boolean | string[]>[] {
  const fullName = nonBlank(account?.contactFullName) ?? nonBlank(account?.userName) ?? ""
  const email = nonBlank(account?.contactEmail) ?? nonBlank(account?.userEmail) ?? ""
  if (!fullName && !email) return []

  return [
    {
      fullName,
      jobTitle: firstNonBlank(profile?.targetRoleTitles),
      email,
      phone: nonBlank(account?.contactPhone) ?? "",
      // The `locations` preference is where the user is willing to work, not
      // where they live, so it is deliberately not a fallback here.
      location: nonBlank(account?.contactLocation) ?? "",
      linkedin: nonBlank(account?.linkedinUrl) ?? "",
      github: nonBlank(account?.githubUrl) ?? "",
      website: nonBlank(account?.websiteUrl) ?? "",
    },
  ]
}

function section(
  type: MasterResumeSectionType,
  title: string,
  items: Record<string, string | boolean | string[]>[] = []
): AssembledMasterResumeSection {
  return {
    type,
    title,
    order: 0,
    visible: true,
    items: {
      create: items.map((content, order) => ({ content, order })),
    },
  }
}

/**
 * Maps canonical, user-confirmed Career Profile facts to the initial master
 * resume shape. The mapper deliberately accepts only the factual fields it can
 * preserve and has no database or framework dependency.
 */
export function assembleMasterResume(
  profile: MasterResumeProfileInput | null | undefined,
  account?: MasterResumeAccountInput | null
): AssembledMasterResumeSection[] {
  const confirmedEvidence = sortCanonicalEvidence(
    (profile?.evidence ?? []).filter((evidence) => evidence.status === "CONFIRMED")
  )

  const experience = confirmedEvidence
    .filter((evidence) => evidence.kind === "EXPERIENCE")
    .map((evidence) => {
      const company = nonBlank(evidence.organization)
      const startDate = formatYearMonth(evidence.startDate)
      const endDate = formatYearMonth(evidence.endDate)

      return {
        role: evidence.title,
        ...(company ? { company } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        current: Boolean(startDate) && evidence.endDate == null,
        bullets: bulletsFor(evidence),
      }
    })

  const education = confirmedEvidence
    .filter((evidence) => evidence.kind === "EDUCATION")
    .map((evidence) => {
      const school = nonBlank(evidence.organization)
      const startDate = formatYearMonth(evidence.startDate)
      const endDate = formatYearMonth(evidence.endDate)

      return {
        degree: evidence.title,
        ...(school ? { school } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : startDate && evidence.endDate == null ? { endDate: "Present" } : {}),
      }
    })

  const projects = confirmedEvidence
    .filter((evidence) => evidence.kind === "PROJECT")
    .map((evidence) => {
      const startDate = formatYearMonth(evidence.startDate)
      const endDate = formatYearMonth(evidence.endDate)

      return {
        name: evidence.title,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : startDate && evidence.endDate == null ? { endDate: "Present" } : {}),
        bullets: bulletsFor(evidence),
      }
    })

  const certifications = confirmedEvidence
    .filter((evidence) => evidence.kind === "CERTIFICATION")
    .map((evidence) => {
      const organization = nonBlank(evidence.organization)
      const dateObtained = formatYearMonth(evidence.startDate)
      const expirationDate = formatYearMonth(evidence.endDate)

      return {
        name: evidence.title,
        ...(organization ? { organization } : {}),
        ...(dateObtained ? { dateObtained } : {}),
        ...(expirationDate ? { expirationDate } : {}),
      }
    })

  const achievements = confirmedEvidence
    .filter((evidence) => evidence.kind === "ACHIEVEMENT")
    .map(achievementContent)

  const sections = [
    section("CONTACT", "Contact", contactItems(profile, account)),
    section("SUMMARY", "Summary"),
    section("EXPERIENCE", "Experience", experience),
    section("EDUCATION", "Education", education),
    {
      ...section("SKILLS", "Skills"),
      items: { create: skillItems(profile?.capabilities ?? []) },
    },
  ]

  if (projects.length > 0) sections.push(section("PROJECTS", "Projects", projects))
  if (certifications.length > 0) {
    sections.push(section("CERTIFICATIONS", "Certifications", certifications))
  }
  if (achievements.length > 0) {
    sections.push(section("CUSTOM", "Achievements", achievements))
  }

  return sections.map((resumeSection, order) => ({ ...resumeSection, order }))
}
