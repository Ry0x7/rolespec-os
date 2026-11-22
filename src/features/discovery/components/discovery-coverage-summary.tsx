import { BarChart3 } from "lucide-react"

import type { DiscoveryCoverage } from "../lib/coverage"

function line(label: string, value: string) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

/**
 * What the run could and could not check, in counts.
 *
 * The wording matters: pay "stated" is a posting fact, pay "readable" is our
 * parser's inference, and user feedback is neither.
 */
export function DiscoveryCoverageSummary({ coverage }: { coverage: DiscoveryCoverage }) {
  return (
    <details className="rounded-md border border-border px-3 py-2 text-xs">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 rounded-sm font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
        Coverage · {coverage.unique} unique, {coverage.pay.stated} with stated pay,{" "}
        {coverage.freshness.undated} undated
      </summary>
      <dl className="mt-5 space-y-0.5">
        {line(
          "Postings received",
          `${coverage.received} (${coverage.duplicatesRemoved} duplicate${
            coverage.duplicatesRemoved === 1 ? "" : "s"
          } removed, ${coverage.unreadable} unreadable)`
        )}
        {line(
          "Pay",
          `${coverage.pay.stated} stated · ${coverage.pay.parsed} parsed by us · ${coverage.pay.unknown} no pay`
        )}
        {line(
          "Regional eligibility",
          `${coverage.regionalEligibility.known} with a stated scope · ${coverage.regionalEligibility.restricted} restricted · ${coverage.regionalEligibility.unknown} unknown`
        )}
        {line(
          "Freshness",
          `${coverage.freshness.fresh} fresh · ${coverage.freshness.stale} stale · ${coverage.freshness.undated} undated`
        )}
        {line("Your feedback", `${coverage.userFeedback} posting(s)`)}
      </dl>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        Posting facts come from the source. Reading a salary line into an amount,
        currency and period is our inference and is labelled as such. Your feedback
        is your own statement. None of these counts is a guess about your skills.
      </p>
    </details>
  )
}
