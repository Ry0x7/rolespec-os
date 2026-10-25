"use client"

import { memo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FileText, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/shared/ui/badge"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Card } from "@/shared/ui/card"
import { cn } from "@/shared/lib/utils"
import { calendarDaysBetween, formatCalendarDate } from "@/shared/lib/dates"
import type { SalaryCurrency } from "@/generated/prisma/enums"
import { OpportunityConfidenceBadge } from "@/features/discovery/components/opportunity-confidence-badge"
import { VerdictBadge } from "@/features/discovery/components/verdict-badge"
import type { JobApplicationRow } from "../hooks/use-job-filters"
import type { NextStepTone } from "../services/application-next-step.service"
import type { JobFormApplication } from "./job-form-application"
import {
  JOB_TYPE_LABELS,
  WORK_TYPE_LABELS,
  formatSalary,
  formatSalaryEquivalents,
  salaryEquivalentsHint,
} from "./job-form-options"
import { DeleteJobDialog } from "./delete-job-dialog"
import { EditJobDialog } from "./edit-job-dialog"
import { isTerminalStatus } from "../services/outcome.service"
import { isStaleJob, STALE_AFTER_DAYS } from "../services/job-staleness.service"
import { QuickActionButtons } from "./quick-action-buttons"
import { RequirementBadges } from "./requirement-badges"
import { RiskBadge } from "./risk-badge"
import { StatusBadge } from "./status-badge"

const MS_PER_DAY = 86_400_000

/** A deadline this close gets a warning tint so it reads at a glance. */
const DEADLINE_SOON_DAYS = 7

/**
 * How the next-step line is tinted. `urgent` reuses the error colour the old
 * "Follow up overdue" badge carried, so nothing slipped changes colour; `done`
 * is muted because a closed application is history, not an instruction.
 */
const NEXT_STEP_TONE_CLASS: Record<NextStepTone, string> = {
  urgent: "text-error font-medium",
  soon: "text-warning",
  neutral: "text-muted-foreground",
  done: "text-muted-foreground/70",
}

/** The one cover letter a card links to, plus how many exist in total. */
export interface JobApplicationCardData extends JobApplicationRow {
  coverLetters: { id: string; updatedAt: Date }[]
  _count: { coverLetters: number }
}

/**
 * `deadline` is a calendar date (UTC midnight, `@db.Date`), so it is counted
 * from the user's own calendar day. `today` comes from the server page: reading
 * the host clock here made a UTC server render and a UTC+8 browser disagree.
 */
export function daysUntilDeadline(deadline: Date, today: Date): number {
  return Math.round((deadline.getTime() - today.getTime()) / MS_PER_DAY)
}

/**
 * "Saved today", "Saved 3d ago", then the date once it is a month or more old.
 * Counted against `today` from the server page, never the host clock.
 */
export function savedAgoLabel(savedAt: Date, today: Date): string {
  const days = calendarDaysBetween(new Date(savedAt), today)
  if (days <= 0) return "Saved today"
  if (days < STALE_AFTER_DAYS) return `Saved ${days}d ago`
  return `Saved ${formatCalendarDate(new Date(savedAt))}`
}

/** How many signals working against a posting the card spells out inline. */
const MAX_CONFIDENCE_REASONS = 2

/**
 * "Posted 3 months ago · No posting text" — the first negative-tone signals, or
 * null when nothing is counting against the posting (a clean HIGH row, say).
 */
export function confidenceReasonText(
  signals: JobApplicationRow["confidence"]["signals"],
): string | null {
  const negatives = signals
    .filter((signal) => signal.tone === "negative")
    .slice(0, MAX_CONFIDENCE_REASONS)
  return negatives.length > 0 ? negatives.map((signal) => signal.label).join(" · ") : null
}

interface JobApplicationCardProps {
  application: JobApplicationCardData
  /** Pesos per dollar, resolved server side so every card shares one lookup. */
  usdPhpRate: number
  /** The user's display currency for the salary equivalents line. */
  preferredCurrency: SalaryCurrency
  /** The user's calendar day (UTC midnight), resolved on the server page. */
  today: Date
  /** Present only in the list's select mode: draws a checkbox in the header. */
  selection?: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }
  /** Opens the quick-view drawer instead of navigating. Optional so tests stay green. */
  onPreview?: (application: JobApplicationCardData) => void
}

export const JobApplicationCard = memo(function JobApplicationCard({
  application,
  usdPhpRate,
  preferredCurrency,
  today,
  selection,
  onPreview,
}: JobApplicationCardProps) {
  const router = useRouter()
  const [showEdit, setShowEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const prefetchDetail = () => router.prefetch(`/jobs/${application.id}`)

  // Null when the salary is already in the user's display currency, in which
  // case the muted line is skipped entirely rather than rendered empty.
  const { job } = application

  const salaryEquivalents =
    job.salary !== null
      ? formatSalaryEquivalents(
          job.salary,
          job.salaryPeriod,
          job.salaryCurrency,
          usdPhpRate,
          preferredCurrency
        )
      : null

  const coverLetterCount = application._count.coverLetters
  const mostRecentCoverLetter = application.coverLetters[0]
  // Most-recent-first from the page query, so the first row is the one to open.
  const coverLetterHref = mostRecentCoverLetter
    ? `/jobs/cover-letter/${mostRecentCoverLetter.id}`
    : `/jobs/cover-letter/new?jobId=${application.id}`
  const coverLetterLabel = mostRecentCoverLetter
    ? `Open cover letter for ${job.companyName}${
        coverLetterCount > 1 ? ` (${coverLetterCount} cover letters)` : ""
      }`
    : `Create cover letter for ${job.companyName}`
  // Writing a cover letter for an application that has already ended is not a
  // move, so a closed row drops the offer. An existing letter stays reachable —
  // that one is history, and history is still worth reading back.
  const showCoverLetter =
    mostRecentCoverLetter !== undefined || !isTerminalStatus(application.status)

  const daysLeft = job.deadline ? daysUntilDeadline(job.deadline, today) : null
  const isDeadlineSoon =
    daysLeft !== null && daysLeft >= 0 && daysLeft <= DEADLINE_SOON_DAYS
  const isStale = isStaleJob(application, today)

  // The card used to scatter three separate facts about where this stands — a
  // "Follow up overdue" badge, an outcome line and "Not applied yet". They are
  // now one instruction, decided on the server by `describeNextStep`.
  const nextStep = application.nextStep

  const confidenceReasons = confidenceReasonText(application.confidence.signals)

  const jobTypeLabel = job.jobType ? JOB_TYPE_LABELS[job.jobType] : null

  const workTypeLabel = job.workType ? WORK_TYPE_LABELS[job.workType] : null

  // `requirementFlags` is a Json column, so nothing guarantees its shape at runtime.
  const requirementFlags = Array.isArray(job.requirementFlags)
    ? job.requirementFlags.filter(
        (flag): flag is string => typeof flag === "string",
      )
    : null

  // The edit form's field names are the action's `FormData` keys, so the row is
  // flattened back into that vocabulary for the dialog.
  const editApplication: JobFormApplication = {
    id: application.id,
    companyName: job.companyName,
    jobTitle: job.title,
    status: application.status,
    location: job.location,
    salary: job.salary,
    salaryPeriod: job.salaryPeriod,
    salaryCurrency: job.salaryCurrency,
    dateApplied: application.dateApplied,
    deadline: job.deadline,
    interviewDate: application.interviewDate,
    followUpAt: application.followUpAt,
    jobLink: job.url,
    contact: application.contact,
    jobDescription: job.description,
    notes: application.notes,
    jobType: job.jobType,
    workType: job.workType,
  }

  return (
    <>
      <Card
        variant="interactive"
        onMouseEnter={prefetchDetail}
        className={cn(
          "group relative flex h-full flex-col gap-3",
          // The variant only transitions colours; transform is added here so the
          // hover lift animates too, and is dropped for reduced motion.
          "transition-[background-color,border-color,box-shadow,transform] duration-200",
          "hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          "has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring",
          isDeadlineSoon && "border-warning/40",
          // A likely-scam job outranks the deadline tint.
          job.riskLevel === "HIGH" && "border-error/40"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          {selection ? (
            // Above the stretched company link (z-10) so it takes the click.
            <input
              type="checkbox"
              checked={selection.checked}
              onChange={(e) => selection.onCheckedChange(e.target.checked)}
              aria-label={`Select ${job.title} at ${job.companyName}`}
              className="relative z-10 mt-1 h-4 w-4 shrink-0 rounded border-border bg-muted accent-brand-600"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            {/*
              The company link stretches over the whole card via `after:`, so the
              card is one big target. Action controls sit above it with z-10.
            */}
            <h3 className="truncate text-base font-semibold text-foreground">
              <Link
                href={`/jobs/${application.id}`}
                className="rounded-sm transition-colors after:absolute after:inset-0 after:rounded-lg after:content-[''] group-hover:text-brand-400 focus-visible:outline-none"
              >
                {job.companyName}
              </Link>
            </h3>
            <p className="truncate text-sm text-muted-foreground">
              {job.title}
            </p>
            <p className={cn("mt-1 truncate text-xs", NEXT_STEP_TONE_CLASS[nextStep.tone])}>
              {nextStep.label}
            </p>
            {/* The next step, as something to press, directly under the line
                that asks for it. Its own row: sharing the header row with the
                icon controls truncated the company name to a few characters. */}
            {application.quickActions.length > 0 ? (
              <div className="relative z-10 mt-2 flex flex-wrap items-center gap-1.5">
                <QuickActionButtons
                  applicationId={application.id}
                  companyName={job.companyName}
                  actions={application.quickActions}
                  className="h-7 px-2 text-xs"
                />
              </div>
            ) : null}
          </div>

          <div className="relative z-10 -mr-2 -mt-2 flex shrink-0 items-center gap-0.5">
            {onPreview ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10"
                aria-label={`Quick view ${job.companyName}`}
                title="Quick view"
                onClick={() => onPreview(application)}
              >
                <span aria-hidden="true" className="text-base leading-none">◐</span>
              </Button>
            ) : null}
            {showCoverLetter ? (
              <Link
                href={coverLetterHref}
                aria-label={coverLetterLabel}
                title={mostRecentCoverLetter ? "Open cover letter" : "Create cover letter"}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon" }),
                  "h-10 w-10"
                )}
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                {coverLetterCount > 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-medium leading-none text-white"
                  >
                    {coverLetterCount}
                  </span>
                ) : null}
              </Link>
            ) : null}
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10"
              aria-label={`Edit ${job.companyName}`}
              title="Edit application"
              onClick={() => setShowEdit(true)}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            {/* Destructive control is fenced off: its own divider plus a red
                hover, so it is never the button you hit by accident. */}
            <span
              aria-hidden="true"
              className="mx-1 h-5 w-px shrink-0 self-center bg-border"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 hover:bg-error/10 hover:text-error"
              aria-label={`Delete ${job.companyName}`}
              title="Delete application"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <StatusBadge status={application.status} />
          {/* Fit first, then whether the posting itself is worth the time —
              the same order and wording Discover and the dashboard use. */}
          {application.verdict ? <VerdictBadge verdict={application.verdict} /> : null}
          <OpportunityConfidenceBadge
            level={application.confidence.level}
            summary={application.confidence.summary}
          />
          {confidenceReasons ? (
            // The badge alone hides *why* in a tooltip; the one or two signals
            // working against the posting are what a triage pass needs to see.
            <span
              className="max-w-full truncate"
              data-testid="confidence-reasons"
            >
              {confidenceReasons}
            </span>
          ) : null}
          <RiskBadge level={job.riskLevel} />
          {job.location ? (
            <span className="truncate">{job.location}</span>
          ) : null}
          {job.salary !== null ? (
            <>
              {job.location ? <span aria-hidden="true">&middot;</span> : null}
              <span className="tabular-nums">
                {formatSalary(job.salary, job.salaryPeriod, job.salaryCurrency)}
              </span>
            </>
          ) : null}
          {jobTypeLabel ? (
            <>
              {job.location || job.salary !== null ? (
                <span aria-hidden="true">&middot;</span>
              ) : null}
              <span>{jobTypeLabel}</span>
            </>
          ) : null}
          {workTypeLabel ? (
            <>
              {job.location || job.salary !== null || jobTypeLabel ? (
                <span aria-hidden="true">&middot;</span>
              ) : null}
              <span>{workTypeLabel}</span>
            </>
          ) : null}
          {salaryEquivalents ? (
            // `w-full` breaks the equivalents onto their own line inside the
            // same wrapping row, so it inherits the row's gap rather than the
            // much larger card gap.
            <span
              className="w-full tabular-nums text-muted-foreground/80"
              title={salaryEquivalentsHint(
                usdPhpRate,
                job.salaryCurrency,
                preferredCurrency
              )}
            >
              {salaryEquivalents}
            </span>
          ) : null}
          {/*
            `w-full` breaks the eligibility badges onto their own line inside the
            same wrapping row, same trick as the salary equivalents above.
          */}
          <RequirementBadges flags={requirementFlags} size="sm" className="w-full" />
          {/* Where the posting came from and how old it is, worded exactly as
              the job detail page words it. Own line, same wrapping-row trick. */}
          <span className="w-full truncate text-muted-foreground/80">
            {application.provenance}
          </span>
          {/* Lifecycle entry points: one click to tailor, match, or cover letter. */}
          <span className="relative z-10 flex w-full flex-wrap items-center gap-1.5 pt-1">
            <Link
              href={`/jobs/${application.id}#prepare`}
              aria-label={`Tailor resume for ${job.companyName}`}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-brand-600 hover:text-brand-500"
            >
              Tailor resume
            </Link>
            <Link
              href={`/jobs/${application.id}#prepare`}
              aria-label={`Check match for ${job.companyName}`}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-brand-600 hover:text-brand-500"
            >
              Match score
            </Link>
            {showCoverLetter ? (
              <Link
                href={coverLetterHref}
                aria-label={coverLetterLabel}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-brand-600 hover:text-brand-500"
              >
                {mostRecentCoverLetter ? "Cover letter" : "New letter"}
              </Link>
            ) : null}
          </span>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {savedAgoLabel(application.createdAt, today)}
            {isStale ? (
              <Badge
                variant="neutral"
                size="sm"
                title="Saved over 30 days ago or past its deadline"
              >
                Stale
              </Badge>
            ) : null}
          </span>
          {application.dateApplied ? (
            <span>Applied {formatCalendarDate(application.dateApplied)}</span>
          ) : null}
          {job.deadline ? (
            <span className="ml-auto flex items-center gap-1.5">
              Deadline {formatCalendarDate(job.deadline)}
              {isDeadlineSoon ? (
                <Badge variant="warning" size="sm">
                  {daysLeft === 0 ? "Due today" : `${daysLeft}d left`}
                </Badge>
              ) : null}
            </span>
          ) : null}
        </div>
      </Card>

      <DeleteJobDialog
        application={{ id: application.id, companyName: job.companyName }}
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onDeleted={() => router.refresh()}
      />

      {showEdit ? (
        <EditJobDialog
          application={editApplication}
          onClose={() => setShowEdit(false)}
        />
      ) : null}
    </>
  )
})
