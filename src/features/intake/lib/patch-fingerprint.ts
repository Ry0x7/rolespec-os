import type {
  ContactField,
  IntakePatchData,
  IntakePatchDraft,
  IntakePatchKind,
} from "../types"

/**
 * NFKD + lowercase + punctuation folding. This is intentionally aggressive:
 * "Node.js", "NodeJS" and "node js" are the same claim about the candidate and
 * must not produce three review rows.
 */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\+/g, " plus ")
    .replace(/#/g, " sharp ")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

const SKILL_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  node: "nodejs",
  "node js": "nodejs",
  nodejs: "nodejs",
  reactjs: "react",
  "react js": "react",
  postgres: "postgresql",
  "postgre sql": "postgresql",
  k8s: "kubernetes",
  golang: "go",
  csharp: "c sharp",
  "c sharp": "c sharp",
  dotnet: "dotnet",
  ".net": "dotnet",
  "next js": "nextjs",
  nextjs: "nextjs",
  "vue js": "vue",
  vuejs: "vue",
  "tailwind css": "tailwind",
  tailwindcss: "tailwind",
  "rest api": "rest",
  restful: "rest",
}

export function skillKey(name: string): string {
  const normalized = normalizeLabel(name)
  return SKILL_ALIASES[normalized] ?? normalized
}

/** Same domain/path comparison regardless of scheme, `www.`, case or slash. */
export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.replace(/^www\./i, "").toLowerCase()
    const path = url.pathname.replace(/\/+$/, "")
    return `${host}${path}${url.search}`.toLowerCase()
  } catch {
    return normalizeLabel(value)
  }
}

/**
 * The identity used for in-run dedupe and for locating the existing profile row
 * a patch would update. Two sources describing the same job with different
 * dates share a fingerprint — the date difference is a conflict, not a new job.
 */
export function fingerprintFor(kind: IntakePatchKind, data: IntakePatchData): string {
  switch (kind) {
    case "CONTACT": {
      const contact = data as { field: ContactField; value: string }
      return `contact:${contact.field}:${normalizeLabel(contact.value)}`
    }
    case "EVIDENCE": {
      const evidence = data as {
        evidenceKind: string
        title: string
        organization: string | null
      }
      return `evidence:${evidence.evidenceKind}:${normalizeLabel(evidence.title)}:${normalizeLabel(
        evidence.organization ?? ""
      )}`
    }
    case "SKILL":
      return `skill:${skillKey((data as { name: string }).name)}`
    case "TARGET_ROLE":
      return `target_role:${normalizeLabel((data as { title: string }).title)}`
  }
}

/**
 * Exact-claim key used only for in-run dedupe. Two sources naming the same role
 * with different dates are *not* the same claim: both survive so the user sees
 * the disagreement when applying the second one.
 */
export function dedupeKeyFor(kind: IntakePatchKind, data: IntakePatchData): string {
  const identity = fingerprintFor(kind, data)
  if (kind !== "EVIDENCE") return identity
  const evidence = data as {
    startDate: string | null
    endDate: string | null
    details: string | null
    outcome: string | null
  }
  return [
    identity,
    evidence.startDate ?? "",
    evidence.endDate ?? "",
    normalizeLabel(evidence.details ?? ""),
    normalizeLabel(evidence.outcome ?? ""),
  ].join("\u0000")
}

/**
 * Keeps the highest-confidence draft per exact claim. Ties keep the first,
 * which preserves adapter order (resume before GitHub, etc.) deterministically.
 */
export function dedupeDrafts(drafts: IntakePatchDraft[]): {
  kept: IntakePatchDraft[]
  duplicates: number
} {
  const byClaim = new Map<string, IntakePatchDraft>()
  let duplicates = 0

  for (const draft of drafts) {
    const key = dedupeKeyFor(draft.kind, draft.data)
    const existing = byClaim.get(key)
    if (!existing) {
      byClaim.set(key, draft)
      continue
    }
    duplicates += 1
    if (draft.confidence > existing.confidence) {
      byClaim.set(key, draft)
    }
  }

  return { kept: [...byClaim.values()], duplicates }
}

/** True when two stored values mean the same thing for this contact field. */
export function contactValuesMatch(
  field: ContactField,
  left: string,
  right: string
): boolean {
  if (field === "contactEmail") {
    return left.trim().toLowerCase() === right.trim().toLowerCase()
  }
  if (field === "linkedinUrl" || field === "githubUrl" || field === "websiteUrl") {
    return normalizeUrl(left) === normalizeUrl(right)
  }
  if (field === "contactPhone") {
    const digits = (value: string) => value.replace(/\D/g, "")
    return digits(left) === digits(right)
  }
  return normalizeLabel(left) === normalizeLabel(right)
}
