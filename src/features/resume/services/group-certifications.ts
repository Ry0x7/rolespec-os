import { dateSortKey, normalizeDateString } from "@/shared/lib/normalize-date"

export interface CertificationContent {
  name?: string
  organization?: string
  dateObtained?: string
  expirationDate?: string
  credentialId?: string
}

export interface CertificationEntry {
  id: string
  content: CertificationContent
}

export interface CertificationGroup {
  organization: string
  certs: CertificationEntry[]
  /** Earliest – latest `dateObtained` across the group, or a single date. */
  dateRange: string | null
}

interface SourceItem {
  id: string
  content: Record<string, unknown>
}

/**
 * A cert carrying its own dates or credential ID is "detailed" — merging it into
 * an organization row would drop that detail, so it always stands alone.
 */
export function isDetailedCertification(content: CertificationContent): boolean {
  return Boolean(
    content.dateObtained?.trim() || content.expirationDate?.trim() || content.credentialId?.trim()
  )
}

/**
 * Groups certification items by organization, preserving first-occurrence order.
 * Items without an organization are never merged — each gets its own group.
 * Detailed items (see `isDetailedCertification`) are never merged either, and
 * never absorb later items sharing their organization.
 * Items with neither a name nor an organization are dropped.
 */
export function groupCertificationsByOrg(items: SourceItem[]): CertificationGroup[] {
  const groups: Array<{ organization: string; certs: CertificationEntry[] }> = []
  const orgIndex = new Map<string, number>()

  for (const item of items) {
    const content = item.content as CertificationContent
    if (!content.name && !content.organization) continue

    const organization = content.organization?.trim() ?? ""
    const key = organization.toLowerCase()
    const entry: CertificationEntry = { id: item.id, content }

    if (isDetailedCertification(content)) {
      groups.push({ organization, certs: [entry] })
    } else if (organization && orgIndex.has(key)) {
      groups[orgIndex.get(key)!].certs.push(entry)
    } else {
      orgIndex.set(key, groups.length)
      groups.push({ organization, certs: [entry] })
    }
  }

  return groups.map((group) => ({
    ...group,
    dateRange: buildDateRange(group.certs),
  }))
}

function buildDateRange(certs: CertificationEntry[]): string | null {
  const dated = certs
    .map((cert) => ({ raw: cert.content.dateObtained, key: dateSortKey(cert.content.dateObtained) }))
    .filter((d): d is { raw: string; key: number } => Boolean(d.raw) && !Number.isNaN(d.key))
    .sort((a, b) => a.key - b.key)

  if (dated.length === 0) return null

  const earliest = dated[0]
  const latest = dated[dated.length - 1]
  const earliestLabel = normalizeDateString(earliest.raw) ?? earliest.raw
  if (earliest.key === latest.key) return earliestLabel

  const latestLabel = normalizeDateString(latest.raw) ?? latest.raw
  return `${earliestLabel} – ${latestLabel}`
}

/**
 * "Jan 2020 – Jan 2030", "Jan 2020", or "Expires Jan 2030" — the date text for a
 * single certification row. `format` lets callers normalize the raw values.
 */
export function formatCertificationDateText(
  content: CertificationContent,
  format: (value: string) => string = (value) => value
): string | undefined {
  const obtained = content.dateObtained?.trim() ? format(content.dateObtained) : ""
  const expires = content.expirationDate?.trim() ? format(content.expirationDate) : ""

  if (obtained && expires) return `${obtained} – ${expires}`
  if (obtained) return obtained
  if (expires) return `Expires ${expires}`
  return undefined
}

/**
 * "Cert A (ID: 123), Cert B" — names joined for a grouped multi-cert row,
 * retaining credential IDs that a plain name join would drop.
 */
export function formatCertificationNames(certs: CertificationEntry[]): string {
  return certs
    .map((cert) => {
      const name = cert.content.name || "Certification"
      return cert.content.credentialId ? `${name} (ID: ${cert.content.credentialId})` : name
    })
    .join(", ")
}
