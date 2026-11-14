"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowUpRight, ListOrdered } from "lucide-react"
import type { RankedEntry, RankingResult } from "../types"
import type { RankingSnapshotView } from "../services/ranking-snapshot.service"
import { apiRequest } from "@/shared/lib/api-client"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import { ResourceState } from "@/shared/components/resource-state"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Badge } from "@/shared/ui/badge"

export interface OpportunityIdentity {
  id: string
  jobId: string
  status: string
  job: { title: string; companyName: string; location: string | null; workType: string | null }
}

type RankingResponse = RankingResult & { reranked: boolean; warnings: string[]; poolSize: number; snapshotId: string | null }

export function MatchExplanation({ entry }: { entry: RankedEntry }) {
  return <div className="space-y-4 pt-3 text-sm">
    <p className="text-muted-foreground">Evidence coverage: {Math.round(entry.coverage * 100)}%. Unknown factors earn no points. This is a prioritization aid, not a hiring prediction.</p>
    <dl className="grid gap-2 sm:grid-cols-3">
      <div><dt className="text-xs text-muted-foreground">Composite</dt><dd className="tabular-nums">{entry.score}/100</dd></div>
      <div><dt className="text-xs text-muted-foreground">Factor fit</dt><dd className="tabular-nums">{entry.fitScore}/100</dd></div>
      <div><dt className="text-xs text-muted-foreground">Raw BM25</dt><dd className="tabular-nums">{entry.lexicalScore === null ? "Unavailable — no description" : entry.lexicalScore.toFixed(2)}</dd></div>
    </dl>
    <ul className="space-y-2">{entry.explanation.map((line, i) => <li key={i}>{line}</li>)}</ul>
    <dl className="divide-y divide-border">{entry.factors.map(factor => <div key={factor.id} className="py-3">
      <dt className="flex flex-wrap items-center justify-between gap-2 font-medium"><span>{factor.label}</span><span className="text-xs text-muted-foreground">{factor.state.toLowerCase()} · weight {factor.weight}</span></dt>
      <dd className="mt-1 text-muted-foreground">{factor.reason}{factor.evidence.length > 0 && <p className="mt-1 text-xs">Evidence: {factor.evidence.join(" · ")}</p>}</dd>
    </div>)}</dl>
    {entry.ai && <p>AI shortlist judgment: {entry.ai.verdict.toLowerCase()} — {entry.ai.reason} (confidence {entry.ai.confidence}%). The deterministic score is unchanged.</p>}
  </div>
}

export function OpportunityLeaderboard({ jobs }: { jobs: OpportunityIdentity[] }) {
  const resource = useApiResource<{ snapshot: RankingSnapshotView | null }>("/api/ranking")
  const [latest, setLatest] = useState<RankingResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [topK, setTopK] = useState(20)
  const [minScore, setMinScore] = useState(40)
  const [rerank, setRerank] = useState(false)
  const stored = resource.data?.snapshot
  const result = latest ?? stored?.result
  const identity = new Map(jobs.map(job => [job.jobId, job]))

  async function rank(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      const next = await apiRequest<RankingResponse>("/api/ranking", { method: "POST", body: JSON.stringify({ topK, minScore, rerank }) })
      setLatest(next)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rank. Please try again.") }
    finally { setBusy(false) }
  }

  return <section id="opportunities" aria-labelledby="opportunity-heading" className="scroll-mt-24 space-y-5 rounded-lg border border-border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="opportunity-heading" className="flex items-center gap-2 text-lg font-semibold"><ListOrdered className="h-5 w-5 text-brand-400" aria-hidden="true" />Ranked opportunities</h2><p className="mt-1 max-w-prose text-sm text-muted-foreground">Prioritize saved jobs using confirmed profile evidence. Manual ranking works without AI.</p></div>
      <Link href="/jobs/discover" className={buttonVariants({ variant: "outline", size: "sm" })}>Find opportunities</Link>
    </div>
    <form onSubmit={rank} className="flex flex-wrap items-end gap-3 border-y border-border py-4">
      <label className="space-y-1 text-xs text-muted-foreground"><span>Show top</span><Input className="w-20" type="number" min={1} max={100} required value={topK} onChange={e => setTopK(Number(e.target.value))} /></label>
      <label className="space-y-1 text-xs text-muted-foreground"><span>Minimum score</span><Input className="w-24" type="number" min={0} max={100} required value={minScore} onChange={e => setMinScore(Number(e.target.value))} /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input className="h-4 w-4 accent-[var(--color-brand-700)]" type="checkbox" checked={rerank} onChange={e => setRerank(e.target.checked)} />Use AI to reorder shortlist</label>
      <Button type="submit" loading={busy} disabled={resource.offline || jobs.length === 0} className="sm:ml-auto">{result ? "Refresh ranking" : "Rank saved jobs"}</Button>
    </form>
    <ResourceState {...resource} retry={() => void resource.reload()} hasData={Boolean(result)} />
    {error && <p role="alert" className="text-sm text-error">{error} Your previous ranking is preserved. Use the ranking button to retry.</p>}
    {latest?.warnings.map((warning, i) => <p role="status" key={i} className="text-sm text-warning">{warning}</p>)}
    {latest && !latest.snapshotId && <p role="status" className="text-sm text-warning">Ranking calculated, but the snapshot could not be saved. Refreshing the page will show the last saved ranking.</p>}
    {!result && !resource.loading && !resource.error && <div className="space-y-3 py-5"><h3 className="font-medium">{jobs.length ? "Choose what deserves your attention" : "Your shortlist starts with a saved job"}</h3><p className="max-w-prose text-sm text-muted-foreground">{jobs.length ? "Run a ranking when you’re ready. Scores and explanations appear only after the backend has evaluated your saved postings." : "Discover a posting or add a job manually. Nothing is ranked until you ask."}</p><Link className="text-sm text-brand-400 underline underline-offset-4" href="/jobs">Open your job list</Link></div>}
    {result && <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><time dateTime={result.snapshot.rankedAt}>Ranked {new Date(result.snapshot.rankedAt).toLocaleString()}</time><span>· {latest?.poolSize ?? stored?.poolSize ?? result.snapshot.corpusSize} saved postings</span><Badge variant="neutral">{(latest?.reranked ?? stored?.reranked) ? "AI reordered" : "Deterministic"}</Badge></div>
      {result.entries.length === 0 && <p className="py-4 text-sm text-muted-foreground">No jobs meet these filters. Lower the minimum score or review all saved jobs.</p>}
      <ol className="divide-y divide-border">{result.entries.map(entry => {
        const job = identity.get(entry.postingId)
        return <li key={entry.postingId} className="py-4 first:pt-0">
          <div className="flex items-start gap-3 sm:gap-5"><span className="w-6 shrink-0 pt-0.5 font-mono text-sm tabular-nums text-muted-foreground" aria-label={`Rank ${entry.rank}`}>{entry.rank}</span>
            <div className="min-w-0 flex-1"><h3 className="font-semibold">{job ? <Link href={`/jobs/${job.id}#decide`} className="underline-offset-4 hover:underline">{job.job.title}</Link> : "Posting unavailable in current job list"}</h3><p className="mt-1 text-sm text-muted-foreground">{job ? [job.job.companyName, job.job.location, job.job.workType?.replaceAll("_", " ")].filter(Boolean).join(" · ") : "Open Jobs to review the current saved postings."}</p><p className="mt-2 text-xs tabular-nums sm:hidden">{entry.score}/100 · {Math.round(entry.coverage * 100)}% evidence{job && <> · <Link className="text-brand-400 underline underline-offset-4" href={`/jobs/${job.id}#preparation`}>Apply</Link></>}</p></div>
            <div className="hidden shrink-0 text-right sm:block"><span className="text-xl font-semibold tabular-nums">{entry.score}</span><span className="text-xs text-muted-foreground"> /100</span><p className="text-xs text-muted-foreground">{Math.round(entry.coverage * 100)}% evidence</p></div>
            {job && <Link href={`/jobs/${job.id}#preparation`} aria-label={`Apply to ${job.job.title} at ${job.job.companyName} with the agent`} className="hidden min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"><ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>}
          </div>
          <details className="mt-3 sm:ml-11"><summary className="min-h-8 cursor-pointer text-sm text-brand-400">Why this rank?</summary><MatchExplanation entry={entry} /></details>
        </li>
      })}</ol>
      {result.excluded.length > 0 && <details className="border-t border-border pt-4 text-sm"><summary className="min-h-8 cursor-pointer text-muted-foreground">{result.excluded.length} outside these ranking filters · still in Jobs</summary><ul className="mt-3 space-y-2">{result.excluded.map(item => { const job = identity.get(item.postingId); return <li key={item.postingId}>{job ? <Link className="underline underline-offset-4" href={`/jobs/${job.id}`}>{job.job.companyName} — {job.job.title}</Link> : "Saved posting"}<span className="text-muted-foreground"> · {item.reason === "below-threshold" ? "below minimum score" : "outside top results"}</span></li> })}</ul></details>}
    </>}
  </section>
}
