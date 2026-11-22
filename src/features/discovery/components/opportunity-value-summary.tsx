"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

import type { SerializedOpportunityValue } from "../actions/discovery.actions"
import { cn } from "@/shared/lib/utils"

type OpportunityDimensionState = "SUPPORTED" | "UNCERTAIN" | "UNKNOWN"
type EvidenceQuote = { excerpt: string; sourceUrl: string | null; source: string }

const STATE_LABEL: Record<OpportunityDimensionState, string> = {
  SUPPORTED: "Supported",
  UNCERTAIN: "Uncertain",
  UNKNOWN: "Unknown",
}

const STATE_CLASS: Record<OpportunityDimensionState, string> = {
  SUPPORTED: "bg-green-500",
  UNCERTAIN: "bg-amber-500",
  UNKNOWN: "bg-muted-foreground/40",
}

const GRADE_LABEL: Record<SerializedOpportunityValue["grade"], string> = {
  STRONG: "Strong value",
  DECENT: "Decent value",
  WEAK: "Weak value",
  BLOCKED: "Excluded",
}

const GRADE_CLASS: Record<SerializedOpportunityValue["grade"], string> = {
  STRONG: "border-green-500/40 bg-green-500/10 text-green-400",
  DECENT: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  WEAK: "border-border bg-muted/40 text-muted-foreground",
  BLOCKED: "border-red-500/40 bg-red-500/10 text-red-400",
}

/** A quoted sentence is evidence; the link is where it came from. */
function Evidence({ evidence }: { evidence: EvidenceQuote }) {
  return (
    <blockquote className="border-l-2 border-border pl-2 text-xs text-muted-foreground">
      “{evidence.excerpt}”
      {evidence.sourceUrl ? (
        <>
          {" "}
          <a
            href={evidence.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            source
          </a>
        </>
      ) : null}
    </blockquote>
  )
}

interface Props {
  value: SerializedOpportunityValue
  /** Collapsed is right for a triage list; the detail page opts in. */
  defaultExpanded?: boolean
  className?: string
}

/**
 * "What is this job actually worth to me?" — separate from the qualification
 * verdict right above it.
 *
 * An unknown dimension is shown as unknown, never as zero: a posting that does
 * not state working hours has not told us its effective hourly pay, and printing
 * `0` would read as "pays nothing". Every indicator carries the sentence it came
 * from, because a workload claim without a quote is an assumption.
 */
export function OpportunityValueSummary({ value, defaultExpanded = false, className }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const warnings = value.rejections.filter((rejection) => rejection.severity === "WARN")
  const blocks = value.rejections.filter((rejection) => rejection.severity === "BLOCK")

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
            GRADE_CLASS[value.grade]
          )}
        >
          {GRADE_LABEL[value.grade]}
          <span className="tabular-nums text-foreground">{value.score}</span>
          <span className="text-muted-foreground">/100</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {Math.round(value.coverage * 100)}% of the picture is known
        </span>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {expanded ? "Hide value breakdown" : "Value breakdown"}
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </div>

      {blocks.length > 0 && (
        <ul className="space-y-1" data-testid="opportunity-blocks">
          {blocks.map((rejection) => (
            <li key={`${rejection.code}-${rejection.message}`} className="text-xs text-red-400">
              {rejection.message}
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-0.5" data-testid="opportunity-warnings">
          {warnings.map((rejection) => (
            <li key={`${rejection.code}-${rejection.message}`} className="text-xs text-amber-400/90">
              {rejection.message}
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
          <dl className="space-y-1.5">
            {value.dimensions.map((dimension) => (
              <div key={dimension.id} className="flex gap-2 text-xs">
                <dt className="flex w-40 shrink-0 items-start gap-1.5 font-medium">
                  <span
                    className={cn(
                      "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                      STATE_CLASS[dimension.state]
                    )}
                    aria-hidden="true"
                  />
                  <span>
                    {dimension.label}
                    <span className="ml-1 font-normal text-muted-foreground">
                      {STATE_LABEL[dimension.state]}
                    </span>
                  </span>
                </dt>
                <dd className="min-w-0 flex-1 text-muted-foreground">
                  <span className="mr-1 tabular-nums text-foreground">
                    {dimension.score === null ? "—" : `${dimension.score}/100`}
                  </span>
                  {dimension.reason}
                </dd>
              </div>
            ))}
          </dl>

          {value.hourly.hoursPerWeek !== null ? (
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">
              Effective hourly pay is based on the {value.hourly.hoursPerWeek} hours a week the
              posting states.
            </p>
          ) : (
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">
              The posting does not state working hours, so no hourly figure is estimated.
            </p>
          )}

          <div className="space-y-1.5 border-t border-border pt-2">
            <p className="text-xs font-medium">Workload evidence</p>
            {value.workload.indicators
              .filter((signal) => signal.evidence)
              .map((signal) => (
                <div key={signal.id} className="space-y-0.5">
                  <p className="text-xs">
                    <span className="font-medium">{signal.id.replace(/_/g, " ").toLowerCase()}</span>{" "}
                    <span className="text-muted-foreground">
                      {STATE_LABEL[signal.state]} — {signal.reason}
                    </span>
                  </p>
                  {signal.evidence ? <Evidence evidence={signal.evidence} /> : null}
                </div>
              ))}
            {value.workload.indicators.every((signal) => !signal.evidence) && (
              <p className="text-xs text-muted-foreground">
                The posting does not describe its workload, so none is assumed.
              </p>
            )}
          </div>

          <div className="space-y-1.5 border-t border-border pt-2">
            <p className="text-xs font-medium">Application friction</p>
            {value.friction.indicators
              .filter((signal) => signal.evidence)
              .map((signal) => (
                <div key={signal.id} className="space-y-0.5">
                  <p className="text-xs">
                    <span className="font-medium">{signal.id.replace(/_/g, " ").toLowerCase()}</span>{" "}
                    <span className="text-muted-foreground">
                      {STATE_LABEL[signal.state]} — {signal.reason}
                    </span>
                  </p>
                  {signal.evidence ? <Evidence evidence={signal.evidence} /> : null}
                </div>
              ))}
            {value.friction.indicators.every((signal) => !signal.evidence) && (
              <p className="text-xs text-muted-foreground">
                The posting does not describe its application process.
              </p>
            )}
          </div>

          {value.contradictions.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2" data-testid="opportunity-contradictions">
              <p className="text-xs font-medium">The posting contradicts itself</p>
              {value.contradictions.map((entry) => (
                <div key={entry.id} className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    {entry.id.replace(/_/g, " ").toLowerCase()}
                  </p>
                  <Evidence
                    evidence={{ excerpt: entry.excerpts[0], sourceUrl: null, source: "POSTING_TEXT" }}
                  />
                  <Evidence
                    evidence={{ excerpt: entry.excerpts[1], sourceUrl: null, source: "POSTING_TEXT" }}
                  />
                </div>
              ))}
            </div>
          )}

          {value.explanation.length > 0 && (
            <ul className="space-y-0.5 border-t border-border pt-2">
              {value.explanation.map((line) => (
                <li key={line} className="text-xs text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
