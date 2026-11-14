"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

import { RequirementBadges } from "@/features/jobs/components/requirement-badges"
import { cn } from "@/shared/lib/utils"
import { Badge } from "@/shared/ui/badge"

import type { OpportunityConfidence } from "../services/opportunity-confidence.service"
import type {
  Qualification,
  QualificationSignal,
} from "../services/qualify.service"
import {
  CONFIDENCE_TONE_DOT,
  OpportunityConfidenceBadge,
} from "./opportunity-confidence-badge"
import { VerdictBadge } from "./verdict-badge"

/** The dot colour per answer, so the five questions read at a glance. */
const SIGNAL_DOT: Record<QualificationSignal, string> = {
  GOOD: "bg-green-500",
  NEUTRAL: "bg-muted-foreground/40",
  CONCERN: "bg-amber-500",
  BLOCKER: "bg-red-500",
}

/** Question order is the qualification order: worth it → eligible → match → risk. */
const QUESTIONS = [
  { key: "worthIt", label: "Worth it?" },
  { key: "eligible", label: "Eligible?" },
  { key: "match", label: "Match?" },
  { key: "risk", label: "Risk?" },
] as const

type QuestionKey = (typeof QUESTIONS)[number]["key"]

/**
 * What an empty reason list means, per question.
 *
 * "Risk?" gets its own sentence because the quick heuristics are not the AI
 * risk check the job page offers: a clean heuristic pass read as "Nothing to
 * flag." next to a Job-risk panel that still says "Not checked yet", which
 * over-claimed. The other questions keep the original wording.
 */
const EMPTY_REASONS: Record<QuestionKey, string> = {
  worthIt: "Nothing to flag.",
  eligible: "Nothing to flag.",
  match: "Nothing to flag.",
  risk: "No scam signals in the quick heuristic check — run the AI risk check for a deeper look.",
}

interface Props {
  qualification: Qualification
  /**
   * The posting-side assessment, when the caller computed one. Optional so a
   * job saved before this existed still renders its fit alone.
   */
  confidence?: OpportunityConfidence
  /**
   * Replaces the snapshot's own `nextAction`. The stored line was written for
   * the discovery list ("Save it and tailor a resume…"); a surface about an
   * already-saved application passes its own next step instead.
   */
  nextAction?: string
  /**
   * Collapsed by default, which is right for a triage list. A page about one
   * job has room for the reasoning, so it opts in.
   */
  defaultExpanded?: boolean
  className?: string
}

/**
 * The deterministic verdict for one discovered posting, with the reasoning
 * behind it one click away.
 *
 * Collapsed by default: the verdict badge and the next action are what a user
 * triaging a list needs, and the per-question detail is what they need once a
 * row has earned a second look. Nothing here is AI output — every line comes
 * from the profile the user filled in and the text the posting published.
 */
export function QualificationSummary({
  qualification,
  confidence,
  nextAction,
  defaultExpanded = false,
  className,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={qualification.verdict} />
        {confidence && (
          <OpportunityConfidenceBadge
            level={confidence.level}
            summary={confidence.summary}
          />
        )}
        <RequirementBadges flags={qualification.requirementFlags} size="sm" />
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {expanded ? "Hide why" : "Why?"}
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {nextAction ?? qualification.nextAction}
      </p>

      {expanded && (
        <dl className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5">
          {QUESTIONS.map(({ key, label }) => {
            const step = qualification[key]
            return (
              <div key={key} className="flex gap-2 text-xs">
                <dt className="flex w-20 shrink-0 items-center gap-1.5 font-medium">
                  <span
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", SIGNAL_DOT[step.signal])}
                    aria-hidden="true"
                  />
                  {label}
                </dt>
                <dd className="min-w-0 text-muted-foreground">
                  {step.reasons.length > 0 ? (
                    <ul className="space-y-0.5">
                      {step.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <span>{EMPTY_REASONS[key]}</span>
                  )}
                </dd>
              </div>
            )
          })}

          {confidence && (
            <div className="space-y-1 border-t border-border pt-2">
              {/*
                Its own block, under a heading, because it answers a different
                question from the four fit steps above it: those are about the
                user, these are about the posting.
              */}
              <p className="text-xs font-medium">Confidence — about the posting</p>
              <ul className="space-y-0.5">
                {confidence.signals.map((signal) => (
                  <li
                    key={signal.key}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        CONFIDENCE_TONE_DOT[signal.tone]
                      )}
                      aria-hidden="true"
                    />
                    {signal.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {qualification.match.matched.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
              {qualification.match.matched.map((capability) => (
                <Badge key={capability} variant="brand" size="sm">
                  {capability}
                </Badge>
              ))}
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
