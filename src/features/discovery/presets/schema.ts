import { z } from "zod"

import { SearchAlertFrequency } from "@/generated/prisma/enums"

import { MAX_DISCOVERY_KEYWORDS, MAX_DISCOVERY_QUERIES } from "../services/derive-queries.service"

const roleList = z
  .array(z.string().trim().min(1).max(200))
  .max(MAX_DISCOVERY_QUERIES, `A saved search can hold at most ${MAX_DISCOVERY_QUERIES} roles`)
  .transform((roles) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const role of roles) {
      const title = role.replace(/\s+/g, " ").trim()
      if (!title) continue
      const key = title.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(title)
    }
    return out
  })

const keywordList = z
  .array(z.string().trim().min(1).max(80))
  .max(MAX_DISCOVERY_KEYWORDS)
  .transform((words) => [...new Set(words)])

export const saveDiscoveryPresetSchema = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1, "Give the search a name").max(80),
    roles: roleList.default([]),
    keywords: keywordList.default([]),
    includeCareerPathRoles: z.boolean().default(false),
    alertFrequency: z.nativeEnum(SearchAlertFrequency).default("OFF"),
  })
  .strict()

export type SaveDiscoveryPresetInput = z.infer<typeof saveDiscoveryPresetSchema>

export const presetIdSchema = z.string().trim().min(1).max(64)
