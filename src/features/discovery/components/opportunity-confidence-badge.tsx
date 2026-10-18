import { Badge, type BadgeProps } from "@/shared/ui/badge"
import { cn } from "@/shared/lib/utils"

import type {
  ConfidenceSignal,
  ConfidenceSignalTone,
  OpportunityConfidenceLevel,
} from "../services/opportunity-confidence.service"

/**
 * Label and tint per confidence level — the single source for how Opportunity
 * Confidence looks anywhere in the app.
 *
 * No `error` variant on purpose. Low confidence means "the signals are thin",
 * not "this is a scam": the red tint belongs to the risk check, which makes an
 * actual claim. Server-safe, like `VerdictBadge`, so a server component can read
 * this table without getting a client reference proxy.
 */
const CONFIDENCE_CONFIG: Record<
  OpportunityConfidenceLevel,
  { variant: NonNullable<BadgeProps["variant"]>; label: string }
> = {
  HIGH: { variant: "success", label: "High confidence" },
  MEDIUM: { variant: "info", label: "Medium confidence" },
  LOW: { variant: "warning", label: "Low confidence" },
  UNKNOWN: { variant: "neutral", label: "Confidence unknown" },
}

/** Reuses the qualification dot palette so the two assessments read alike. */
export const CONFIDENCE_TONE_DOT: Record<ConfidenceSignalTone, string> = {
  positive: "bg-green-500",
  negative: "bg-amber-500",
  neutral: "bg-muted-foreground/40",
  unknown: "bg-muted-foreground/40",
}

interface Props {
  level: OpportunityConfidenceLevel
  /** One sentence; shown as the badge tooltip. */
  summary: string
  /** The signals behind the level, listed under the badge when asked for. */
  signals?: ConfidenceSignal[]
  /** Off in a triage list, on where there is room to explain the level. */
  showSignals?: boolean
  size?: BadgeProps["size"]
  className?: string
}

export function OpportunityConfidenceBadge({
  level,
  summary,
  signals = [],
  showSignals = false,
  size = "sm",
  className,
}: Props) {
  const { variant, label } = CONFIDENCE_CONFIG[level]
  const badge = (
    <Badge variant={variant} size={size} title={summary}>
      {label}
    </Badge>
  )

  if (!showSignals || signals.length === 0) {
    return className ? <span className={className}>{badge}</span> : badge
  }

  return (
    <div className={cn("space-y-1", className)}>
      {badge}
      <ul className="space-y-0.5">
        {signals.map((signal) => (
          <li key={signal.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CONFIDENCE_TONE_DOT[signal.tone])}
              aria-hidden="true"
            />
            {signal.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
