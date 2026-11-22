import type { SerializedOpportunityValue } from "@/features/opportunity/serialize"
import type { OpportunityValue, Signal } from "@/features/opportunity/types"
import { cn } from "@/shared/lib/utils"
import { Badge, type BadgeProps } from "@/shared/ui/badge"

/**
 * Opportunity Value, rendered from the server's decision.
 *
 * The component does no scoring and no wording of its own: every sentence, every
 * score and every quote arrives in `value`. That is deliberate — a second place
 * that decided what "light workload" means would eventually disagree with the
 * engine, and the whole point of this panel is that the number can be traced
 * back to a sentence in the posting.
 */

const GRADE: Record<
  OpportunityValue["grade"],
  { label: string; variant: NonNullable<BadgeProps["variant"]> }
> = {
  STRONG: { label: "Strong value", variant: "success" },
  DECENT: { label: "Decent value", variant: "info" },
  WEAK: { label: "Weak value", variant: "warning" },
  BLOCKED: { label: "Blocked", variant: "error" },
}

/**
 * The card renders either the engine's object (tests, server components) or the
 * transport-safe one (a server page handing it to this client component). It
 * only reads fields both shapes share; it never touches the money Decimals.
 */
type OpportunityValueLike = OpportunityValue | SerializedOpportunityValue

const STATE_LABEL: Record<Signal["state"], string> = {
  SUPPORTED: "Stated",
  UNCERTAIN: "Uncertain",
  UNKNOWN: "Unknown",
}

const PRESET_LABEL: Record<OpportunityValue["preset"], string> = {
  BALANCED: "Balanced",
  PAY_OVER_LOAD: "High pay / lighter workload",
}

/** Compact row badge: enough to triage, no breakdown. */
export function OpportunityValueBadge({
  value,
  size = "sm",
  className,
}: {
  value: OpportunityValueLike
  size?: BadgeProps["size"]
  className?: string
}) {
  const grade = GRADE[value.grade]
  return (
    <Badge
      variant={grade.variant}
      size={size}
      className={cn("tabular-nums", className)}
      data-testid="opportunity-value-badge"
      title={`${grade.label}: ${value.score}/100 (${PRESET_LABEL[value.preset]})`}
    >
      Value {value.score}
      <span className="sr-only"> out of 100, {grade.label.toLowerCase()}</span>
    </Badge>
  )
}

function SignalRow({ signal }: { signal: Signal }) {
  return (
    <li
      className="space-y-0.5"
      data-testid={`opportunity-signal-${signal.id}`}
      data-state={signal.state}
    >
      <p className="text-sm">
        {signal.reason}
        <span className="ml-2 text-xs text-muted-foreground">{STATE_LABEL[signal.state]}</span>
      </p>
      {signal.evidence ? (
        <blockquote className="border-l-2 border-border pl-2 text-xs text-muted-foreground">
          “{signal.evidence.excerpt}”
          {signal.evidence.sourceUrl ? (
            <>
              {" "}
              <a
                href={signal.evidence.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                source
              </a>
            </>
          ) : null}
        </blockquote>
      ) : null}
    </li>
  )
}

function SignalGroup({
  title,
  signals,
  emptyReason,
}: {
  title: string
  signals: Signal[]
  emptyReason: string
}) {
  const stated = signals.filter((signal) => signal.state !== "UNKNOWN")
  // A "flexible schedule" finding reads as an absence of load, not a burden; it
  // still belongs here because it is a stated fact about the week.
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {stated.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyReason}</p>
      ) : (
        <ul className="space-y-2">
          {stated.map((signal) => (
            <SignalRow key={signal.id} signal={signal} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function OpportunityValueCard({ value }: { value: OpportunityValueLike }) {
  const grade = GRADE[value.grade]
  const covered = Math.round(value.coverage * 100)

  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      data-testid="opportunity-value"
      aria-label="Opportunity value"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Opportunity value</h3>
          <p className="text-xs text-muted-foreground">
            What this job is worth to you, apart from how well it matches your profile.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold tabular-nums" data-testid="opportunity-score">
            {value.score}
            <span className="text-sm font-normal text-muted-foreground">/100</span>
          </span>
          <Badge variant={grade.variant} data-testid="opportunity-grade">
            {grade.label}
          </Badge>
        </div>
      </header>

      <p className="text-xs text-muted-foreground">
        {PRESET_LABEL[value.preset]} weights · based on {covered}% of the signals you asked to
        weigh.
      </p>

      {value.rejections.length > 0 ? (
        <ul className="space-y-1" aria-label="Rejection reasons">
          {value.rejections.map((rejection) => (
            <li
              key={`${rejection.code}-${rejection.message}`}
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                rejection.severity === "BLOCK"
                  ? "border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-400"
                  : "border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400"
              )}
              data-testid="opportunity-rejection"
              data-severity={rejection.severity}
            >
              <span className="font-medium">
                {rejection.severity === "BLOCK" ? "Blocked" : "Heads-up"}:
              </span>{" "}
              {rejection.message}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="grid gap-1 sm:grid-cols-2" aria-label="Dimensions">
        {value.dimensions.map((dimension) => (
          <li
            key={dimension.id}
            className="flex items-start justify-between gap-2 rounded-md border border-border/60 px-2 py-1"
            data-testid={`opportunity-dimension-${dimension.id}`}
            data-state={dimension.state}
          >
            <div className="min-w-0">
              <p className="text-sm">
                {dimension.label}
                <span className="ml-1 text-xs text-muted-foreground">
                  {Math.round(dimension.weight)}%
                </span>
              </p>
              {/* Wrapped, not truncated: this sentence is the whole reason a
                  dimension is unknown, and an ellipsis turns it into a mystery. */}
              <p className="text-xs leading-snug text-muted-foreground">
                {dimension.reason}
              </p>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {dimension.score === null ? (
                <span className="text-xs font-normal text-muted-foreground">unknown</span>
              ) : (
                dimension.score
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        <SignalGroup
          title="Compensation"
          signals={value.compensation.signals}
          emptyReason="The posting does not state pay."
        />
        <SignalGroup
          title="Workload"
          signals={value.workload.indicators}
          emptyReason="The posting does not describe its workload, so none is assumed."
        />
        <SignalGroup
          title="Application friction"
          signals={value.friction.indicators}
          emptyReason="The posting does not describe its application process."
        />
        {value.hourly.hoursPerWeek !== null ? (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Effective hourly pay
            </h4>
            <p className="text-sm">{value.hourly.reason}</p>
            {value.hourly.evidence ? (
              <blockquote className="border-l-2 border-border pl-2 text-xs text-muted-foreground">
                “{value.hourly.evidence.excerpt}”
              </blockquote>
            ) : null}
          </div>
        ) : null}
      </div>

      {value.contradictions.length > 0 ? (
        <div className="space-y-1" data-testid="opportunity-contradictions">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Contradictions in the posting
          </h4>
          <ul className="space-y-1 text-sm">
            {value.contradictions.map((entry) => (
              <li key={entry.id}>
                It says both “{entry.excerpts[0]}” and “{entry.excerpts[1]}”.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {value.explanation.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label="Why this score">
          {value.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
