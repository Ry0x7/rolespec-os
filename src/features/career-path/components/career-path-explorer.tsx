"use client"

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { Compass, ExternalLink, Plus, Route } from "lucide-react"
import { toast } from "sonner"

import { EVIDENCE_KIND_LABELS } from "@/features/career-profile/constants/labels"
import { EmptyState } from "@/shared/components/empty-state"
import { cn } from "@/shared/lib/utils"
import { Badge } from "@/shared/ui/badge"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"

import { approveCareerPathRole } from "../actions/career-path.actions"
import {
  CAREER_PATH_GROUP_LABELS,
  type CareerPathGroupId,
  type CareerPathResult,
  type CareerRecommendation,
} from "../types"

const GROUP_ORDER: CareerPathGroupId[] = ["QUALIFIED_NOW", "ADJACENT", "GROWTH"]

const GROUP_DESCRIPTIONS: Record<CareerPathGroupId, string> = {
  QUALIFIED_NOW:
    "Roles your confirmed, evidence-backed capabilities already cover. Missing requirements are listed, never hidden.",
  ADJACENT:
    "Careers where your transferable strengths cover most of the role, with a small, specific bridge left to build.",
  GROWTH:
    "Realistic next branches that need learning or another step first. These are directions, not claims that you are ready today.",
}

const STATUS_LABELS: Record<CareerRecommendation["matched"][number]["status"], string> = {
  SUPPORTED: "Supported",
  SELF_DECLARED: "Self-declared",
  MISSING: "Missing",
}

const CONFIDENCE_BADGE = {
  HIGH: "success",
  MEDIUM: "brand",
  LOW: "neutral",
} as const

const FEASIBILITY_BADGE = {
  FEASIBLE: "success",
  STRETCH: "warning",
  UNKNOWN: "neutral",
  BLOCKED: "error",
} as const

const GEOGRAPHY_BADGE = {
  ELIGIBLE: "success",
  UNKNOWN: "neutral",
  RESTRICTED: "error",
} as const

function defaultGroup(result: CareerPathResult): CareerPathGroupId {
  return (
    GROUP_ORDER.find((group) => result.groups[group].length > 0) ?? "QUALIFIED_NOW"
  )
}

function isHttpUrl(value: string | null): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value)
}

function normalizedTitle(value: string): string {
  return value.trim().toLowerCase()
}

function formatSalary(role: CareerRecommendation): string | null {
  const salary = role.salaryPotential
  if (!salary) return null
  try {
    const format = new Intl.NumberFormat("en", {
      style: "currency",
      currency: salary.currency,
      maximumFractionDigits: 2,
    })
    const range =
      salary.min === salary.max
        ? format.format(salary.min)
        : `${format.format(salary.min)} – ${format.format(salary.max)}`
    return `${range} ${salary.period.toLowerCase()} · ${salary.region} · source ${salary.source}, ${salary.asOf}`
  } catch {
    // An unknown currency code is a data error, not a reason to print a figure
    // in the wrong currency.
    return null
  }
}

interface CareerPathExplorerProps {
  result: CareerPathResult
  approvedTitles: readonly string[]
}

export function CareerPathExplorer({ result, approvedTitles }: CareerPathExplorerProps) {
  const router = useRouter()
  const idPrefix = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [activeGroup, setActiveGroup] = useState<CareerPathGroupId>(() =>
    defaultGroup(result)
  )
  const [visibleCounts, setVisibleCounts] = useState<Record<CareerPathGroupId, number>>({
    QUALIFIED_NOW: 3,
    ADJACENT: 3,
    GROWTH: 3,
  })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState("")
  const [localApproved, setLocalApproved] = useState<ReadonlySet<string>>(new Set())

  const rolesById = useMemo(() => {
    const map = new Map<
      string,
      { role: CareerRecommendation; group: CareerPathGroupId; index: number }
    >()
    for (const group of GROUP_ORDER) {
      result.groups[group].forEach((role, index) => {
        map.set(role.occupationId, { role, group, index })
      })
    }
    return map
  }, [result])

  const approvedTitlesNormalized = useMemo(
    () => new Set(approvedTitles.map(normalizedTitle)),
    [approvedTitles]
  )

  const groupsAreEmpty = GROUP_ORDER.every(
    (group) => result.groups[group].length === 0
  )

  function isApproved(role: CareerRecommendation): boolean {
    return (
      localApproved.has(role.occupationId) ||
      approvedTitlesNormalized.has(normalizedTitle(role.title))
    )
  }

  function selectGroup(group: CareerPathGroupId) {
    if (group === activeGroup) return
    setActiveGroup(group)
    setVisibleCounts((current) => ({ ...current, [group]: 3 }))
    setExpandedId(null)
    setApprovalError(null)
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = GROUP_ORDER.length - 1
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % GROUP_ORDER.length
        : event.key === "ArrowLeft"
          ? (index + GROUP_ORDER.length - 1) % GROUP_ORDER.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1
    if (next < 0) return
    event.preventDefault()
    selectGroup(GROUP_ORDER[next])
    requestAnimationFrame(() => tabRefs.current[next]?.focus())
  }

  function focusRelated(occupationId: string) {
    const target = rolesById.get(occupationId)
    if (!target) return
    setActiveGroup(target.group)
    setVisibleCounts((current) => ({
      ...current,
      [target.group]: Math.max(current[target.group], target.index + 1),
    }))
    setExpandedId(occupationId)
    setApprovalError(null)
    requestAnimationFrame(() => {
      const heading = document.getElementById(titleId(occupationId))
      heading?.scrollIntoView?.({ block: "center" })
      heading?.focus()
    })
  }

  async function approve(role: CareerRecommendation) {
    if (isApproved(role)) return
    setPendingId(role.occupationId)
    setApprovalError(null)
    setStatusMessage("")
    try {
      const response = await approveCareerPathRole(role.occupationId)
      if ("error" in response) {
        setApprovalError(response.error)
        setStatusMessage(response.error)
        toast.error(response.error)
        return
      }
      setLocalApproved((current) => new Set(current).add(role.occupationId))
      const message = response.alreadyExists
        ? "Already on your Target Roles"
        : "Added to Target Roles"
      setStatusMessage(message)
      toast.success(message)
      router.refresh()
    } catch {
      const message = "Could not add that role. Try again."
      setApprovalError(message)
      setStatusMessage(message)
      toast.error(message)
    } finally {
      setPendingId(null)
    }
  }

  function titleId(occupationId: string): string {
    return `${idPrefix}-role-${occupationId}`
  }

  function detailId(occupationId: string): string {
    return `${idPrefix}-detail-${occupationId}`
  }

  const activeRoles = result.groups[activeGroup]
  const visibleRoles = activeRoles.slice(0, visibleCounts[activeGroup])
  const hiddenCount = Math.max(0, activeRoles.length - visibleRoles.length)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Career paths</CardTitle>
            <CardDescription>
              Deterministic recommendations built from your confirmed capabilities and
              confirmed evidence. Adding a role never changes that evidence.
            </CardDescription>
          </div>
          <Badge variant="outline" size="sm">
            Deterministic
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {result.evaluatedCount} catalogue{" "}
            {result.evaluatedCount === 1 ? "role" : "roles"} evaluated
          </span>
          <span className="break-all">Catalogue version {result.taxonomyVersion}</span>
        </div>

        {result.attribution.length > 0 && (
          <details className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Data sources
            </summary>
            <ul className="mt-2 space-y-1.5 text-muted-foreground">
              {result.attribution.map((line) => (
                <li key={line} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          </details>
        )}

        {result.notices.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Before you read these paths</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              {result.notices.map((notice) => (
                <li key={notice} className="break-words">
                  {notice}
                </li>
              ))}
            </ul>
          </div>
        )}

        {approvalError && (
          <p role="alert" className="text-sm text-destructive">
            {approvalError}
          </p>
        )}

        {result.conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <p className="font-medium">Conflicting capability records</p>
            <p className="mt-1">
              The stronger evidence-backed rating was used once for each skill. The
              records were not added together, and nothing was changed automatically.
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              {result.conflicts.map((conflict) => (
                <li key={conflict.capabilityKey} className="break-words">
                  <span className="font-medium">{conflict.label}:</span> {conflict.detail}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!result.hasEnoughEvidence || groupsAreEmpty ? (
          <EmptyState
            icon={Compass}
            variant="bare"
            title="Not enough confirmed evidence yet"
            description="Career paths need at least two confirmed skills and one confirmed piece of evidence. Nothing has been guessed from unconfirmed candidates."
            action={
              <a
                href="#capabilities"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                Go to skills
              </a>
            }
          />
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Career path groups"
              className="flex max-w-full flex-wrap gap-1 border-b border-border pb-1"
            >
              {GROUP_ORDER.map((group, index) => {
                const selected = group === activeGroup
                return (
                  <button
                    key={group}
                    ref={(element) => {
                      tabRefs.current[index] = element
                    }}
                    id={`${idPrefix}-tab-${group}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`${idPrefix}-panel-${group}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectGroup(group)}
                    onKeyDown={(event) => onTabKeyDown(event, index)}
                    className={cn(
                      "inline-flex min-h-11 max-w-full flex-wrap items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      selected
                        ? "border-brand-500 text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span>{CAREER_PATH_GROUP_LABELS[group]}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      ({result.counts[group]})
                    </span>
                  </button>
                )
              })}
            </div>

            <div
              id={`${idPrefix}-panel-${activeGroup}`}
              role="tabpanel"
              aria-labelledby={`${idPrefix}-tab-${activeGroup}`}
              tabIndex={0}
              className="min-w-0 space-y-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-xs text-muted-foreground">
                {GROUP_DESCRIPTIONS[activeGroup]}
              </p>

              {activeRoles.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No roles in this group yet. Confirm more evidence or explore another
                  group.
                </p>
              ) : (
                <div className="space-y-3">
                  {visibleRoles.map((role) => {
                    const expanded = expandedId === role.occupationId
                    const salaryLabel = formatSalary(role)
                    const matchedCritical = role.missing.filter(
                      (item) => item.critical && item.source === "REQUIRED"
                    )
                    const headingId = titleId(role.occupationId)
                    const panelId = detailId(role.occupationId)
                    const approved = isApproved(role)
                    return (
                      <article
                        key={role.occupationId}
                        aria-labelledby={headingId}
                        className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <h4
                              id={headingId}
                              tabIndex={-1}
                              className="break-words text-base font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {role.title}
                            </h4>
                            <p className="max-w-2xl break-words text-sm text-muted-foreground">
                              {role.summary}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="neutral" size="sm">
                                {role.familyLabel}
                              </Badge>
                              <Badge variant="outline" size="sm">
                                {role.entryLevel.toLowerCase()} level
                              </Badge>
                              <Badge
                                variant={CONFIDENCE_BADGE[role.confidence]}
                                size="sm"
                              >
                                {role.confidence.toLowerCase()} confidence
                              </Badge>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-baseline gap-1 rounded-md border border-border bg-muted px-2.5 py-1">
                            <span className="text-lg font-semibold tabular-nums">
                              {role.score}
                            </span>
                            <span className="text-[11px] text-muted-foreground">/100</span>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                          <span className="tabular-nums">
                            {role.coverage}% catalogue coverage
                          </span>
                          <span>
                            {role.evidenceBackedCapabilities} evidence-backed{" "}
                            {role.evidenceBackedCapabilities === 1 ? "skill" : "skills"}
                          </span>
                          <Badge
                            variant={FEASIBILITY_BADGE[role.entryFeasibility.status]}
                            size="sm"
                          >
                            {role.entryFeasibility.label}
                          </Badge>
                          <Badge variant={GEOGRAPHY_BADGE[role.geography.status]} size="sm">
                            {role.geography.label}
                          </Badge>
                        </div>

                        {(role.matched.length > 0 || matchedCritical.length > 0) && (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            {role.matched.slice(0, 3).map((item) => (
                              <Badge key={item.key} variant="brand" size="sm">
                                {item.label}
                              </Badge>
                            ))}
                            {role.matched.length > 3 && (
                              <span className="text-xs text-muted-foreground">
                                +{role.matched.length - 3} more
                              </span>
                            )}
                            {matchedCritical.map((item) => (
                              <Badge key={`missing-${item.key}`} variant="warning" size="sm">
                                Needs {item.label}
                              </Badge>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            onClick={() =>
                              setExpandedId(expanded ? null : role.occupationId)
                            }
                          >
                            {expanded ? "Hide evidence & steps" : "Explore evidence & steps"}
                          </Button>
                          <span className="inline-flex flex-wrap items-center gap-2">
                            {approved && (
                              <Badge variant="success" size="sm">
                                On your target list
                              </Badge>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant={approved ? "secondary" : "default"}
                              disabled={approved}
                              loading={pendingId === role.occupationId}
                              onClick={() => approve(role)}
                            >
                              {pendingId === role.occupationId ? "Adding…" : "Add to Target Roles"}
                              {!approved && pendingId !== role.occupationId && (
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                            </Button>
                          </span>
                        </div>

                        {expanded && (
                          <div
                            id={panelId}
                            role="region"
                            aria-labelledby={headingId}
                            className="mt-4 min-w-0 space-y-4 border-t border-border pt-4"
                          >
                            {role.reasons.length > 0 && (
                              <section aria-labelledby={`${panelId}-reasons`}>
                                <h5
                                  id={`${panelId}-reasons`}
                                  className="text-sm font-semibold"
                                >
                                  Why this role appears here
                                </h5>
                                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                                  {role.reasons.map((reason) => (
                                    <li key={reason} className="break-words">
                                      {reason}
                                    </li>
                                  ))}
                                </ul>
                              </section>
                            )}

                            <section aria-labelledby={`${panelId}-score`}>
                              <h5 id={`${panelId}-score`} className="text-sm font-semibold">
                                Score breakdown
                              </h5>
                              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                                <div>
                                  <dt className="text-muted-foreground">
                                    Required coverage
                                  </dt>
                                  <dd className="font-medium tabular-nums">
                                    {role.breakdown.requiredCoverage}%
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">
                                    Preferred coverage
                                  </dt>
                                  <dd className="font-medium tabular-nums">
                                    {role.breakdown.preferredCoverage}%
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">Evidence share</dt>
                                  <dd className="font-medium tabular-nums">
                                    {role.breakdown.evidenceShare}%
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">Critical penalty</dt>
                                  <dd className="font-medium tabular-nums">
                                    {role.breakdown.criticalPenalty === 0
                                      ? "0"
                                      : `−${role.breakdown.criticalPenalty}`}
                                  </dd>
                                </div>
                              </dl>
                              <p className="mt-1.5 text-[11px] text-muted-foreground">
                                A deterministic weighted score: required coverage 70%,
                                preferred coverage 20%, evidence share 10%, minus 4 points
                                for each missing critical requirement.
                              </p>
                            </section>

                            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                              <section aria-labelledby={`${panelId}-matched`} className="min-w-0">
                                <h5
                                  id={`${panelId}-matched`}
                                  className="text-sm font-semibold"
                                >
                                  Matched capabilities
                                </h5>
                                {role.matched.length === 0 ? (
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    No requirement is matched by confirmed evidence yet.
                                  </p>
                                ) : (
                                  <ul className="mt-2 space-y-2">
                                    {role.matched.map((item) => (
                                      <li
                                        key={item.key}
                                        className="min-w-0 rounded-md border border-border px-2.5 py-2"
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                                          <span className="break-words text-sm font-medium">
                                            {item.label}
                                          </span>
                                          <span className="flex items-center gap-1.5">
                                            <Badge
                                              variant={
                                                item.status === "SUPPORTED"
                                                  ? "success"
                                                  : "warning"
                                              }
                                              size="sm"
                                            >
                                              {STATUS_LABELS[item.status]}
                                            </Badge>
                                            <span className="text-xs tabular-nums text-muted-foreground">
                                              {item.strength}/100 · w{item.weight}
                                            </span>
                                          </span>
                                        </div>
                                        <p className="mt-1 break-words text-xs text-muted-foreground">
                                          {item.explanation}
                                        </p>
                                        {item.evidence.length > 0 && (
                                          <ul className="mt-1.5 space-y-1 text-xs">
                                            {item.evidence.map((evidence) => (
                                              <li
                                                key={evidence.id}
                                                className="break-words text-muted-foreground"
                                              >
                                                {isHttpUrl(evidence.sourceUrl) ? (
                                                  <a
                                                    href={evidence.sourceUrl}
                                                    target="_blank"
                                                    rel="noreferrer noopener"
                                                    className="inline-flex items-center gap-1 text-brand-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                  >
                                                    {evidence.title}
                                                    <ExternalLink
                                                      className="h-3 w-3 shrink-0"
                                                      aria-hidden="true"
                                                    />
                                                  </a>
                                                ) : (
                                                  <span>{evidence.title}</span>
                                                )}{" "}
                                                <span className="text-muted-foreground/80">
                                                  · {EVIDENCE_KIND_LABELS[evidence.kind]}
                                                </span>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </section>

                              <section aria-labelledby={`${panelId}-missing`} className="min-w-0">
                                <h5
                                  id={`${panelId}-missing`}
                                  className="text-sm font-semibold"
                                >
                                  Missing requirements
                                </h5>
                                {role.missing.length === 0 ? (
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    Nothing from this catalogue role is missing.
                                  </p>
                                ) : (
                                  <ul className="mt-2 space-y-1.5 text-sm">
                                    {role.missing.map((item) => (
                                      <li
                                        key={item.key}
                                        className="flex flex-wrap items-center justify-between gap-1.5 rounded-md border border-border px-2.5 py-1.5"
                                      >
                                        <span className="break-words">{item.label}</span>
                                        <span className="text-xs text-muted-foreground">
                                          {item.critical ? "critical · " : ""}
                                          weight {item.weight} ·{" "}
                                          {item.source === "REQUIRED"
                                            ? "required"
                                            : "preferred"}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}

                                {role.steps.length > 0 && (
                                  <div className="mt-3">
                                    <p className="text-xs font-medium text-foreground">
                                      Suggested skill-building steps
                                    </p>
                                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                                      {role.steps.map((step) => (
                                        <li key={step} className="break-words">
                                          {step}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </section>
                            </div>

                            <section aria-labelledby={`${panelId}-fit`} className="space-y-1.5">
                              <h5 id={`${panelId}-fit`} className="text-sm font-semibold">
                                Entry and location fit
                              </h5>
                              <p className="break-words text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  Entry level:{" "}
                                </span>
                                {role.entryFeasibility.explanation}
                              </p>
                              <p className="break-words text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  Geography:{" "}
                                </span>
                                {role.geography.explanation}
                              </p>
                            </section>

                            {role.branch.length > 0 && (
                              <section aria-labelledby={`${panelId}-branch`}>
                                <h5
                                  id={`${panelId}-branch`}
                                  className="text-sm font-semibold"
                                >
                                  Branch
                                </h5>
                                <p className="mt-1 break-words text-xs text-muted-foreground">
                                  {role.branch.join(" → ")}
                                </p>
                              </section>
                            )}

                            {role.related.filter((related) =>
                              rolesById.has(related.occupationId)
                            ).length > 0 && (
                              <section aria-labelledby={`${panelId}-related`}>
                                <h5
                                  id={`${panelId}-related`}
                                  className="text-sm font-semibold"
                                >
                                  Related branches
                                </h5>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {role.related
                                    .filter((related) =>
                                      rolesById.has(related.occupationId)
                                    )
                                    .map((related) => (
                                      <Button
                                        key={`${related.occupationId}-${related.relationship}`}
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => focusRelated(related.occupationId)}
                                      >
                                        <Route className="h-3.5 w-3.5" aria-hidden="true" />
                                        {related.title}
                                        <span className="text-[11px] text-muted-foreground">
                                          {related.relationship === "NEXT"
                                            ? "next step"
                                            : "adjacent"}
                                        </span>
                                      </Button>
                                    ))}
                                </div>
                              </section>
                            )}

                            <p className="break-words text-xs text-muted-foreground">
                              {salaryLabel ??
                                "No verified regional pay data for this role, so no salary figure is shown."}
                            </p>

                          </div>
                        )}
                      </article>
                    )
                  })}

                  {hiddenCount > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setVisibleCounts((current) => ({
                          ...current,
                          [activeGroup]: current[activeGroup] + 3,
                        }))
                      }
                    >
                      Show {Math.min(3, hiddenCount)} more
                      {hiddenCount > 3 ? ` (${hiddenCount} hidden)` : ""}
                    </Button>
                  )}
                </div>
              )}
            </div>

            <p
              role="status"
              aria-live="polite"
              className="min-h-4 text-xs text-muted-foreground"
            >
              {statusMessage}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
