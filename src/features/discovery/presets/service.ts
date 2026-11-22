import type { SearchAlertFrequency } from "@/generated/prisma/enums"
import { prisma } from "@/shared/lib/prisma"

import {
  MAX_DISCOVERY_KEYWORDS,
  MAX_DISCOVERY_QUERIES,
  type TargetRoleInput,
} from "../services/derive-queries.service"
import type { DiscoveryQuery } from "../types"
import type { DiscoveryPresetView } from "./types"

const DAY_MS = 86_400_000

export interface PresetRecord {
  name: string
  roles: string[]
  keywords: string[]
  includeCareerPathRoles: boolean
  alertFrequency: SearchAlertFrequency
  createdAt?: Date
  lastAlertedAt?: Date | null
}

/** Monday 00:00 UTC is not needed: an alert is a rolling interval. */
function intervalMs(frequency: SearchAlertFrequency): number | null {
  if (frequency === "DAILY") return DAY_MS
  if (frequency === "WEEKLY") return 7 * DAY_MS
  return null
}

/** The next moment this preset should be surfaced, or null when alerts are off. */
export function nextAlertAt(
  preset: Pick<PresetRecord, "alertFrequency" | "createdAt" | "lastAlertedAt">,
  now: Date
): Date | null {
  const interval = intervalMs(preset.alertFrequency)
  if (interval === null) return null
  const base = preset.lastAlertedAt ?? preset.createdAt ?? now
  return new Date(base.getTime() + interval)
}

export function isAlertDue(
  preset: Pick<PresetRecord, "alertFrequency" | "createdAt" | "lastAlertedAt">,
  now: Date
): boolean {
  const next = nextAlertAt(preset, now)
  return next !== null && next.getTime() <= now.getTime()
}

/**
 * Saved-search roles -> discovery queries.
 *
 * Explicit roles in the preset always run. Career-path roles are appended only
 * when the preset says so AND the role has `discoveryEnabled` — the user's
 * approval of a suggestion is not the same as permission to search for it.
 * The shared query cap applies after both lists are merged, so a saved search
 * can never fan out wider than an ordinary run.
 */
export function buildPresetQueries(
  preset: Pick<PresetRecord, "roles" | "keywords" | "includeCareerPathRoles">,
  targetRoles: (TargetRoleInput & { source?: string })[] = []
): DiscoveryQuery[] {
  const seenKeywords = new Set<string>()
  const keywords: string[] = []
  for (const raw of preset.keywords) {
    const word = raw.trim()
    if (!word) continue
    const key = word.toLowerCase()
    if (seenKeywords.has(key)) continue
    seenKeywords.add(key)
    keywords.push(word)
    if (keywords.length >= MAX_DISCOVERY_KEYWORDS) break
  }
  const titles: string[] = []
  const seen = new Set<string>()
  // A recommendation the user has disabled cannot re-enter through an old
  // saved search. A manual role with the same title keeps the title eligible.
  const disabledRecommendations = new Set(
    targetRoles
      .filter(
        (role) => role.source === "CAREER_PATH" && role.discoveryEnabled === false
      )
      .map((role) => role.title.trim().toLowerCase())
  )
  const enabledTitles = new Set(
    targetRoles
      .filter(
        (role) =>
          role.active &&
          (role.source !== "CAREER_PATH" || role.discoveryEnabled !== false)
      )
      .map((role) => role.title.trim().toLowerCase())
  )

  const add = (raw: string) => {
    const title = raw.replace(/\s+/g, " ").trim()
    if (!title) return
    const key = title.toLowerCase()
    if (seen.has(key)) return
    if (disabledRecommendations.has(key) && !enabledTitles.has(key)) return
    seen.add(key)
    titles.push(title)
  }

  for (const role of preset.roles) add(role)
  if (preset.includeCareerPathRoles) {
    for (const role of targetRoles) {
      if (role.source !== "CAREER_PATH") continue
      if (!role.active || role.discoveryEnabled === false) continue
      add(role.title)
    }
  }

  return titles.slice(0, MAX_DISCOVERY_QUERIES).map((role) =>
    keywords.length > 0 ? { role, keywords: [...keywords] } : { role }
  )
}

export async function readPresetForRun(userId: string, presetId: string) {
  return prisma.discoverySearchPreset.findFirst({
    where: { id: presetId, userId },
  })
}

/** Records that the user ran this saved search, which also acknowledges its alert. */
export async function recordPresetRun(input: {
  userId: string
  presetId: string
  count: number
  now: Date
  alertFrequency: SearchAlertFrequency
}): Promise<void> {
  await prisma.discoverySearchPreset.updateMany({
    where: { id: input.presetId, userId: input.userId },
    data: {
      lastRunAt: input.now,
      lastRunCount: input.count,
      // With alerts off there is no alert to acknowledge; keeping this null
      // makes the two events distinguishable for any future sender.
      ...(input.alertFrequency === "OFF" ? {} : { lastAlertedAt: input.now }),
    },
  })
}

export async function listDiscoveryPresets(
  userId: string,
  now: Date = new Date()
): Promise<DiscoveryPresetView[]> {
  const rows = await prisma.discoverySearchPreset.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
  })

  return rows.map((row) => {
    const next = nextAlertAt(row, now)
    return {
      id: row.id,
      name: row.name,
      roles: row.roles,
      keywords: row.keywords,
      includeCareerPathRoles: row.includeCareerPathRoles,
      alertFrequency: row.alertFrequency,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      lastRunCount: row.lastRunCount,
      lastAlertedAt: row.lastAlertedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      alertDue: isAlertDue(row, now),
      nextAlertAt: next?.toISOString() ?? null,
    }
  })
}
