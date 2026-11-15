"use client"

import Link from "next/link"
import { useState } from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ListOrdered,
  Sparkles,
  XCircle,
} from "lucide-react"
import type { FitFactor, FitFactorState, RankedEntry, RankingResult } from "../types"
import type { RankingSnapshotView } from "../services/ranking-snapshot.service"
import { apiRequest } from "@/shared/lib/api-client"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import { useMediaQuery } from "@/shared/hooks/use-media-query"
import { ResourceState } from "@/shared/components/resource-state"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Badge, type BadgeProps } from "@/shared/ui/badge"
import { Progress } from "@/shared/ui/progress"
import { cn } from "@/shared/lib/utils"

export interface OpportunityIdentity {
  id: string
  jobId: string
  status: string
  job: { title: string; companyName: string; location: string | null; workType: string | null }
}

type RankingResponse = RankingResult & { reranked: boolean; warnings: string[]; poolSize: number; snapshotId: string | null }

const FACTOR_STATE = {
  MATCH: {
    label: "Match",
    variant: "success",
    dot: "bg-green-500",
    Icon: CheckCircle2,
  },
  PARTIAL: {
    label: "Partial",
    variant: "warning",
    dot: "bg-amber-500",
    Icon: AlertTriangle,
  },
  MISMATCH: {
    label: "Gap",
    variant: "error",
    dot: "bg-red-500",
    Icon: XCircle,
  },
  UNKNOWN: {
    label: "Unknown",
    variant: "neutral",
    dot: "bg-muted-foreground",
    Icon: CircleHelp,
  },
} as const satisfies Record<
  FitFactorState,
  {
    label: string
    variant: NonNullable<BadgeProps["variant"]>
    dot: string
    Icon: typeof CheckCircle2
  }
>

const AI_VERDICT = {
  FIT: { label: "Fit", variant: "success" },
  PARTIAL: { label: "Partial", variant: "warning" },
  MISMATCH: { label: "Mismatch", variant: "error" },
} as const satisfies Record<
  NonNullable<RankedEntry["ai"]>["verdict"],
  { label: string; variant: NonNullable<BadgeProps["variant"]> }
>

function coverageState(coverage: number) {
  const pct = Math.round(coverage * 100)
  if (pct >= 70) {
    return { pct, label: `Strong evidence · ${pct}%`, variant: "success" as const }
  }
  if (pct >= 40) {
    return { pct, label: `Some evidence · ${pct}%`, variant: "warning" as const }
  }
  return { pct, label: `Thin evidence · ${pct}%`, variant: "neutral" as const }
}

function FactorList({ factors }: { factors: FitFactor[] }) {
  return (
    <ul className="space-y-2">
      {factors.map((factor) => {
        const config = FACTOR_STATE[factor.state]
        const Icon = config.Icon
        // A rank explanation can carry an empty evidence string; rendering it
        // produced a blank chip with no meaning. Keep only real evidence.
        const evidence = factor.evidence.filter((item) => item.trim().length > 0)
        return (
          <li
            key={factor.id}
            className="rounded-md border border-border bg-background/40 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <p className="break-words text-sm font-semibold">{factor.label}</p>
              <Badge variant={config.variant} size="sm">
                <Icon className="h-3 w-3" aria-hidden="true" />
                {config.label}
              </Badge>
            </div>
            <p className="mt-1 break-words text-sm leading-snug text-muted-foreground">
              {factor.reason}
            </p>
            {evidence.length > 0 && (
              <ul
                aria-label={`${factor.label} evidence`}
                className="mt-2 flex flex-wrap gap-1.5"
              >
                {evidence.map((item, index) => (
                  <li key={`${item}-${index}`} className="max-w-full">
                    <Badge
                      variant="outline"
                      size="sm"
                      className="h-auto whitespace-normal break-words text-left font-normal"
                    >
                      {item}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Importance</span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn("block h-full rounded-full", config.dot)}
                  style={{ width: `${factor.weight}%` }}
                />
              </span>
              <span className="tabular-nums">{factor.weight}%</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function FactorGroup({
  title,
  dot,
  factors,
}: {
  title: string
  dot: string
  factors: FitFactor[]
}) {
  if (factors.length === 0) return null
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <span
          className={cn("h-1.5 w-1.5 rounded-full", dot)}
          aria-hidden="true"
        />
        {title}
        <span className="text-xs font-normal text-muted-foreground">
          {factors.length}
        </span>
      </h4>
      <FactorList factors={factors} />
    </section>
  )
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string
  value: string | number
  suffix?: string
}) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
        {value}
        {suffix && (
          <span className="ml-0.5 font-sans text-xs font-normal text-muted-foreground">
            {suffix}
          </span>
        )}
      </dd>
    </div>
  )
}

export function MatchExplanation({ entry }: { entry: RankedEntry }) {
  const coverage = coverageState(entry.coverage)
  const matches = entry.factors.filter((factor) => factor.state === "MATCH")
  const partial = entry.factors.filter((factor) => factor.state === "PARTIAL")
  const gaps = entry.factors.filter((factor) => factor.state === "MISMATCH")
  const unknown = entry.factors.filter((factor) => factor.state === "UNKNOWN")
  const knownCount = entry.factors.length - unknown.length

  return (
    <div className="space-y-5 pt-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Overall fit
          </p>
          <p className="mt-1 flex items-baseline gap-1">
            <span className="font-mono text-3xl font-bold tabular-nums">
              {entry.score}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
          </p>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            A prioritization aid built from your saved facts and this posting.
            It is not a hiring prediction.
          </p>
        </div>
        <Badge variant={coverage.variant}>{coverage.label}</Badge>
      </div>

      <Progress
        value={entry.score}
        className="border border-input"
        color={entry.score >= 70 ? "success" : "brand"}
        label={`Overall match: ${entry.score} out of 100`}
      />

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Profile fit" value={entry.fitScore} suffix="/100" />
        <Metric
          label="Facts checked"
          value={`${knownCount} of ${entry.factors.length}`}
        />
        <Metric label="Evidence known" value={coverage.pct} suffix="%" />
      </dl>

      {entry.lexicalScore === null && (
        <div className="flex items-start gap-2 rounded-md border border-amber-600/20 bg-amber-600/5 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-400">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <p>
            <span className="font-medium">No job description was saved.</span>{" "}
            Keyword matching is unavailable, so the score relies on the profile
            facts below.
          </p>
        </div>
      )}

      {knownCount === 0 ? (
        <p className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
          No confirmed fact matched yet. Add confirmed skills, salary
          expectations and work authorization to your profile for a sharper
          explanation.
        </p>
      ) : (
        <div className="space-y-4">
          <FactorGroup
            title="What helped"
            dot="bg-green-500"
            factors={matches}
          />
          <FactorGroup
            title="Partly matched"
            dot="bg-amber-500"
            factors={partial}
          />
          <FactorGroup title="Gaps" dot="bg-red-500" factors={gaps} />
        </div>
      )}

      {unknown.length > 0 && (
        <details className="group rounded-md border border-border bg-background/30">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <CircleHelp
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span>Not enough information</span>
            <Badge variant="neutral" size="sm">
              {unknown.length}
            </Badge>
            <ChevronDown
              className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="border-t border-border p-3">
            <FactorList factors={unknown} />
          </div>
        </details>
      )}

      {entry.ai && (
        <div className="rounded-md border border-brand-500/20 bg-brand-500/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-brand-400" aria-hidden="true" />
              AI second opinion
            </h4>
            <Badge variant={AI_VERDICT[entry.ai.verdict].variant} size="sm">
              {AI_VERDICT[entry.ai.verdict].label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{entry.ai.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Confidence {entry.ai.confidence}%. The score above is unchanged.
          </p>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Unknown</span> means the
        posting or profile did not include that fact, so it earned no points. It
        is not a penalty.
      </p>
    </div>
  )
}

const INITIAL_VISIBLE_ENTRIES = 5

export function OpportunityLeaderboard({ jobs }: { jobs: OpportunityIdentity[] }) {
  const resource = useApiResource<{ snapshot: RankingSnapshotView | null }>("/api/ranking")
  const [latest, setLatest] = useState<RankingResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [topK, setTopK] = useState(20)
  const [minScore, setMinScore] = useState(40)
  const [rerank, setRerank] = useState(false)
  // The dashboard is a triage surface, not the full ranking report: a 20-row
  // shortlist turned one card into several screens of scrolling. Show the
  // shortlist first and let the reader explicitly expand it. Phones get two
  // rows instead of five — five filled most of the screen before the reader
  // reached anything else.
  const [showAllEntries, setShowAllEntries] = useState(false)
  const isWide = useMediaQuery("(min-width: 640px)")
  const initialVisibleEntries = isWide ? INITIAL_VISIBLE_ENTRIES : 2
  const stored = resource.data?.snapshot
  const result = latest ?? stored?.result
  const identity = new Map(jobs.map(job => [job.jobId, job]))

  async function rank(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setShowAllEntries(false)
    try {
      const next = await apiRequest<RankingResponse>("/api/ranking", { method: "POST", body: JSON.stringify({ topK, minScore, rerank }) })
      setLatest(next)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rank. Please try again.") }
    finally { setBusy(false) }
  }

  const visibleEntries = result
    ? showAllEntries
      ? result.entries
      : result.entries.slice(0, initialVisibleEntries)
    : []
  const hiddenEntryCount = (result?.entries.length ?? 0) - visibleEntries.length

  return <section id="opportunities" aria-labelledby="opportunity-heading" className="scroll-mt-24 space-y-5 rounded-lg border border-border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="opportunity-heading" className="flex items-center gap-2 text-lg font-semibold"><ListOrdered className="h-5 w-5 text-brand-400" aria-hidden="true" />Ranked opportunities</h2><p className="mt-1 max-w-prose text-sm text-muted-foreground">Prioritize saved jobs using confirmed profile evidence. Manual ranking works without AI.</p></div>
      <Link href="/jobs/discover" className={buttonVariants({ variant: "outline", size: "sm" })}>Find opportunities</Link>
    </div>
    <form onSubmit={rank} className="flex flex-wrap items-center gap-2 border-y border-border py-3">
      <Button type="submit" loading={busy} disabled={resource.offline || jobs.length === 0} className="w-full sm:order-last sm:ml-auto sm:w-auto">{result ? "Refresh ranking" : "Rank saved jobs"}</Button>
      {/* Phones fold the numbers behind a disclosure. They are setup knobs,
          not the action, and three stacked rows of them pushed the actual
          shortlist below the fold. */}
      <details className="w-full min-w-0 sm:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-muted-foreground">Ranking options</summary>
        <div className="grid grid-cols-2 gap-3 pb-1 pt-2">
          <label className="space-y-1 text-xs text-muted-foreground"><span>Show top</span><Input className="w-full" type="number" min={1} max={100} required value={topK} onChange={e => setTopK(Number(e.target.value))} /></label>
          <label className="space-y-1 text-xs text-muted-foreground"><span>Minimum score</span><Input className="w-full" type="number" min={0} max={100} required value={minScore} onChange={e => setMinScore(Number(e.target.value))} /></label>
          <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm"><input className="h-4 w-4 accent-[var(--color-brand-700)]" type="checkbox" checked={rerank} onChange={e => setRerank(e.target.checked)} />Use AI to reorder shortlist</label>
        </div>
      </details>
      <div className="hidden flex-wrap items-end gap-3 sm:flex">
        <label className="space-y-1 text-xs text-muted-foreground"><span>Show top</span><Input className="w-20" type="number" min={1} max={100} required value={topK} onChange={e => setTopK(Number(e.target.value))} /></label>
        <label className="space-y-1 text-xs text-muted-foreground"><span>Minimum score</span><Input className="w-24" type="number" min={0} max={100} required value={minScore} onChange={e => setMinScore(Number(e.target.value))} /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input className="h-4 w-4 accent-[var(--color-brand-700)]" type="checkbox" checked={rerank} onChange={e => setRerank(e.target.checked)} />Use AI to reorder shortlist</label>
      </div>
    </form>
    <ResourceState {...resource} retry={() => void resource.reload()} hasData={Boolean(result)} />
    {error && <p role="alert" className="text-sm text-error">{error} Your previous ranking is preserved. Use the ranking button to retry.</p>}
    {latest?.warnings.map((warning, i) => <p role="status" key={i} className="text-sm text-warning">{warning}</p>)}
    {latest && !latest.snapshotId && <p role="status" className="text-sm text-warning">Ranking calculated, but the snapshot could not be saved. Refreshing the page will show the last saved ranking.</p>}
    {!result && !resource.loading && !resource.error && <div className="space-y-3 py-5"><h3 className="font-medium">{jobs.length ? "Choose what deserves your attention" : "Your shortlist starts with a saved job"}</h3><p className="max-w-prose text-sm text-muted-foreground">{jobs.length ? "Run a ranking when you’re ready. Scores and explanations appear only after the backend has evaluated your saved postings." : "Discover a posting or add a job manually. Nothing is ranked until you ask."}</p><Link className="text-sm text-brand-400 underline underline-offset-4" href="/jobs">Open your job list</Link></div>}
    {result && <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><time dateTime={result.snapshot.rankedAt}>Ranked {new Date(result.snapshot.rankedAt).toLocaleString()}</time><span>· {latest?.poolSize ?? stored?.poolSize ?? result.snapshot.corpusSize} saved postings</span>          <span>· {showAllEntries || result.entries.length <= initialVisibleEntries ? `all ${result.entries.length} ranked` : `top ${visibleEntries.length} of ${result.entries.length}`}</span><Badge variant="neutral">{(latest?.reranked ?? stored?.reranked) ? "AI reordered" : "Deterministic"}</Badge></div>
      {result.entries.length === 0 && <p className="py-4 text-sm text-muted-foreground">No jobs meet these filters. Lower the minimum score or review all saved jobs.</p>}
      <ol className="divide-y divide-border">{visibleEntries.map(entry => {
        const job = identity.get(entry.postingId)
        const coverage = coverageState(entry.coverage)
        return <li key={entry.postingId} className="py-3 first:pt-0 sm:py-4">
          <div className="flex items-start gap-3 sm:gap-5"><span className="w-6 shrink-0 pt-0.5 font-mono text-sm tabular-nums text-muted-foreground" aria-label={`Rank ${entry.rank}`}>{entry.rank}</span>
            <div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{job ? <Link href={`/jobs/${job.id}#decide`} className="underline-offset-4 hover:underline">{job.job.title}</Link> : "Posting unavailable in current job list"}</h3><p className="mt-1 text-sm text-muted-foreground">{job ? [job.job.companyName, job.job.location, job.job.workType?.replaceAll("_", " ")].filter(Boolean).join(" · ") : "Open Jobs to review the current saved postings."}</p><p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs tabular-nums sm:hidden"><Badge variant="brand" size="sm">{entry.score}/100</Badge><Badge variant={coverage.variant} size="sm">{coverage.pct}% evidence</Badge>{job && <Link className="text-brand-400 underline underline-offset-4" href={`/jobs/${job.id}#preparation`}>Apply</Link>}</p></div>
            <div className="hidden shrink-0 text-right sm:block"><span className="text-xl font-semibold tabular-nums">{entry.score}</span><span className="text-xs text-muted-foreground"> /100</span><p className="text-xs text-muted-foreground">{coverage.pct}% evidence</p></div>
            {job && <Link href={`/jobs/${job.id}#preparation`} aria-label={`Apply to ${job.job.title} at ${job.job.companyName} with the agent`} className="hidden min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"><ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>}
          </div>
          <details className="group mt-3 sm:ml-11">
            <summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-2 rounded-md px-1 text-sm font-medium text-brand-400 transition-colors hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <CircleHelp className="h-4 w-4" aria-hidden="true" />
              Why this rank?
              <Badge variant="brand" size="sm">{entry.score}/100</Badge>
              <Badge variant={coverage.variant} size="sm" className="hidden sm:inline-flex">{coverage.pct}% evidence</Badge>
              <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-2 rounded-lg border border-border bg-background/30 p-3 sm:p-4">
              <MatchExplanation entry={entry} />
            </div>
          </details>
        </li>
      })}</ol>
      {hiddenEntryCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAllEntries(true)}
          aria-expanded={false}
          className="min-h-11 w-full rounded-md border border-border px-3 text-sm font-medium text-brand-400 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show all {result.entries.length} ranked roles
        </button>
      )}
      {showAllEntries && result.entries.length > initialVisibleEntries && (
        <button
          type="button"
          onClick={() => setShowAllEntries(false)}
          aria-expanded
          className="min-h-11 w-full rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show top {initialVisibleEntries}
        </button>
      )}
      {result.excluded.length > 0 && <details className="border-t border-border pt-4 text-sm"><summary className="min-h-8 cursor-pointer text-muted-foreground">{result.excluded.length} outside these ranking filters · still in Jobs</summary><ul className="mt-3 space-y-2">{result.excluded.map(item => { const job = identity.get(item.postingId); return <li key={item.postingId}>{job ? <Link className="underline underline-offset-4" href={`/jobs/${job.id}`}>{job.job.companyName} — {job.job.title}</Link> : "Saved posting"}<span className="text-muted-foreground"> · {item.reason === "below-threshold" ? "below minimum score" : "outside top results"}</span></li> })}</ul></details>}
    </>}
  </section>
}
