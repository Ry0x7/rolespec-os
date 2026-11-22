import type { SearchAlertFrequency } from "@/generated/prisma/enums"

/** One saved search, as the Discover screen renders it. */
export interface DiscoveryPresetView {
  id: string
  name: string
  roles: string[]
  keywords: string[]
  includeCareerPathRoles: boolean
  alertFrequency: SearchAlertFrequency
  lastRunAt: string | null
  lastRunCount: number | null
  lastAlertedAt: string | null
  createdAt: string
  /** True when an in-app alert is due; this app has no background sender. */
  alertDue: boolean
  nextAlertAt: string | null
}

/** A target role the preset editor can offer, with its provenance. */
export interface PresetRoleOption {
  id: string
  title: string
  source: "USER" | "CAREER_PATH" | "INTAKE"
  discoveryEnabled: boolean
  active: boolean
}
