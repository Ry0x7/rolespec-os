"use client"

import type { WorkspaceJobRow } from "../workspace-board"
import {
  FOLLOW_UP_STATUSES,
  isFollowUpDue,
} from "@/features/jobs/services/follow-up.service"
import { calendarDaysBetween } from "@/shared/lib/dates"

export type WorkspaceFilterState = {
  query: string
  statuses: string[]
  followUpOnly: boolean
}

export const EMPTY_WORKSPACE_FILTER: WorkspaceFilterState = {
  query: "",
  statuses: [],
  followUpOnly: false,
}

function matchesQuery(job: WorkspaceJobRow, q: string) {
  const hay = `${job.job.companyName} ${job.job.title}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => hay.includes(part))
}

export function filterWorkspaceJobs(
  jobs: WorkspaceJobRow[],
  filter: WorkspaceFilterState,
  today: Date | null,
): WorkspaceJobRow[] {
  const q = filter.query.trim()
  return jobs.filter((job) => {
    if (filter.statuses.length > 0 && !filter.statuses.includes(job.status))
      return false
    if (q && !matchesQuery(job, q)) return false
    if (filter.followUpOnly) {
      const followUpAt = FOLLOW_UP_STATUSES.includes(job.status)
        ? job.followUpAt
        : null
      if (!followUpAt) return false
      if (today && !isFollowUpDue(followUpAt, today)) return false
    }
    return true
  })
}

export type FollowUpGroup = "overdue" | "today" | "upcoming"

export type FollowUpItem = {
  job: WorkspaceJobRow
  group: FollowUpGroup
}

export function groupFollowUps(
  jobs: WorkspaceJobRow[],
  today: Date | null,
): FollowUpItem[] {
  if (!today) return []
  const items: FollowUpItem[] = []
  for (const job of jobs) {
    if (!FOLLOW_UP_STATUSES.includes(job.status)) continue
    if (!job.followUpAt) continue
    const diff = calendarDaysBetween(job.followUpAt, today)
    if (diff > 0) items.push({ job, group: "overdue" })
    else if (diff === 0) items.push({ job, group: "today" })
    else items.push({ job, group: "upcoming" })
  }
  // Overdue first (most overdue last so the nearest-due surfaces first),
  // then today, then upcoming by date.
  const rank: Record<FollowUpGroup, number> = {
    overdue: 0,
    today: 1,
    upcoming: 2,
  }
  return items.sort((a, b) => {
    if (rank[a.group] !== rank[b.group]) return rank[a.group] - rank[b.group]
    const at = a.job.followUpAt?.getTime() ?? 0
    const bt = b.job.followUpAt?.getTime() ?? 0
    return at - bt
  })
}

export type WorkspaceSummary = {
  total: number
  active: number
  interviews: number
  offers: number
  responseRate: number
  dueFollowUps: number
  overdueFollowUps: number
}

export function summarizeWorkspace(
  jobs: WorkspaceJobRow[],
  today: Date | null,
): WorkspaceSummary {
  const total = jobs.length
  const active = jobs.filter(
    (j) => j.status !== "REJECTED" && j.status !== "WITHDRAWN",
  ).length
  const interviews = jobs.filter(
    (j) => j.status === "SCREENING" || j.status === "INTERVIEW",
  ).length
  const offers = jobs.filter((j) => j.status === "OFFER").length
  const responded = jobs.filter((j) =>
    (["SCREENING", "INTERVIEW", "OFFER", "REJECTED"] as string[]).includes(
      j.status,
    ),
  ).length
  const appliedBase = jobs.filter((j) => j.status !== "INTERESTED").length
  const responseRate =
    appliedBase === 0 ? 0 : Math.round((responded / appliedBase) * 100)

  let dueFollowUps = 0
  let overdueFollowUps = 0
  if (today) {
    for (const job of jobs) {
      if (!FOLLOW_UP_STATUSES.includes(job.status) || !job.followUpAt)
        continue
      if (isFollowUpDue(job.followUpAt, today)) {
        dueFollowUps += 1
        if (calendarDaysBetween(job.followUpAt, today) > 0)
          overdueFollowUps += 1
      }
    }
  }
  return {
    total,
    active,
    interviews,
    offers,
    responseRate,
    dueFollowUps,
    overdueFollowUps,
  }
}
