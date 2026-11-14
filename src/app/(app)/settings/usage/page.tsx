import { Activity } from "lucide-react"
import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import { EmptyState } from "@/shared/components/empty-state"
import { Card, CardDescription, CardTitle } from "@/shared/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table"
import { MiniBarChart } from "@/features/settings/components/mini-bar-chart"
import { formatCostUsd } from "@/shared/lib/ai-pricing"
import {
  getUserAiUsage,
  type UserAiUsageTotals,
} from "@/features/settings/services/ai-usage.service"

export const dynamic = "force-dynamic"

function formatCount(value: number): string {
  return value.toLocaleString()
}

function formatPercent(value: number | null): string {
  if (value === null) return "—"
  return `${Math.round(value * 100)}%`
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <Card className="p-4">
      <CardDescription>{label}</CardDescription>
      <CardTitle className="mt-1 text-3xl tabular-nums">
        {typeof value === "number" ? formatCount(value) : value}
      </CardTitle>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  )
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/**
 * A stacked view of the same totals, split into non-overlapping parts.
 *
 * Providers report cache reads inside input and reasoning inside output. Showing
 * all four raw numbers as separate slices would therefore count those tokens
 * twice, so the bar subtracts both first and the legend says where they came
 * from.
 */
function TokenMix({ totals }: { totals: UserAiUsageTotals }) {
  const cached = Math.min(totals.cachedInputTokens, totals.inputTokens)
  const newInput = Math.max(totals.inputTokens - cached, 0)
  const reasoning = Math.min(totals.reasoningTokens, totals.outputTokens)
  const textOutput = Math.max(totals.outputTokens - reasoning, 0)

  const segments = [
    { label: "New input", value: newInput, className: "bg-brand-500" },
    { label: "Cached input", value: cached, className: "bg-cyan-500" },
    { label: "Output", value: textOutput, className: "bg-violet-500" },
    { label: "Reasoning", value: reasoning, className: "bg-amber-500" },
  ]
  const plotted = segments.reduce((sum, segment) => sum + segment.value, 0)

  return (
    <div className="space-y-3">
      <div
        className="flex h-3 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={segments
          .map((segment) => `${segment.label}: ${formatCount(segment.value)} tokens`)
          .join(", ")}
      >
        {plotted > 0
          ? segments.map((segment) =>
              segment.value > 0 ? (
                <div
                  key={segment.label}
                  className={segment.className}
                  style={{ width: `${(segment.value / plotted) * 100}%` }}
                  title={`${segment.label}: ${formatCount(segment.value)}`}
                />
              ) : null,
            )
          : null}
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
        {segments.map((segment) => (
          <div key={segment.label} className="rounded-md border border-border p-2">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${segment.className}`} aria-hidden="true" />
              {segment.label}
            </dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">
              {formatCount(segment.value)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {plotted > 0 ? `(${Math.round((segment.value / plotted) * 100)}%)` : ""}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Cached input is already inside input, and reasoning is already inside output.
        This view subtracts them so nothing is counted twice.
      </p>
    </div>
  )
}

export default async function SettingsUsagePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/unlock")

  const usage = await getUserAiUsage(session.user.id)

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">AI usage</h2>
        <p className="text-sm text-muted-foreground">
          How much AI work RoleSpec did for you in the last {usage.windowDays} days.
          Your own provider bill is the final word on cost.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">What counts</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          <li>A failed request counts as an attempt, even when the provider returned no tokens.</li>
          <li>Cached input is part of input, and reasoning is part of output. They are never added twice.</li>
          <li>
            CLI and local models only appear when they report usage. An empty or partial
            number there means the provider did not send it, not that the work was free.
          </li>
        </ul>
      </div>

      {usage.totals.calls === 0 ? (
        <EmptyState
          icon={Activity}
          title="No AI calls yet"
          description={`Nothing has run on your account in the last ${usage.windowDays} days. Usage appears here as soon as you use an AI feature.`}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            <StatTile label="AI attempts" value={usage.totals.calls} />
            <StatTile
              label="Successful"
              value={usage.totals.okCalls}
              hint={`${formatPercent(usage.totals.successRate)} of attempts`}
            />
            <StatTile
              label="Failed"
              value={usage.totals.failedCalls}
              hint="Still counts against the daily limit"
            />
            <StatTile
              label="Estimated cost"
              value={formatCostUsd(usage.totals.estimatedCostUsd)}
              hint="Public list prices; your provider bill is authoritative."
            />
            <StatTile label="Total tokens" value={usage.totals.totalTokens} />
            <StatTile
              label="Input tokens"
              value={usage.totals.inputTokens}
              hint={`Includes ${formatCount(usage.totals.cachedInputTokens)} cached`}
            />
            <StatTile
              label="Output tokens"
              value={usage.totals.outputTokens}
              hint={`Includes ${formatCount(usage.totals.reasoningTokens)} reasoning`}
            />
            <StatTile
              label="Cache-hit rate"
              value={formatPercent(usage.totals.cacheHitRate)}
              hint="Cached input ÷ input tokens"
            />
            <StatTile
              label="Cache read"
              value={usage.totals.cachedInputTokens}
              hint="Already counted inside input"
            />
            <StatTile
              label="Reasoning"
              value={usage.totals.reasoningTokens}
              hint="Already counted inside output"
            />
          </div>

          <section className="space-y-3">
            <SectionHeading
              title="Token mix"
              hint="One view of where the tokens went, without double counting."
            />
            <Card className="p-4">
              <TokenMix totals={usage.totals} />
            </Card>
          </section>

          <section className="space-y-3">
            <SectionHeading
              title="Daily activity"
              hint={`Total tokens per UTC day for the last ${usage.windowDays} days.`}
            />
            <Card className="p-4">
              <MiniBarChart data={usage.tokensByDay} label="Total tokens" />
            </Card>
          </section>

          <section className="space-y-3">
            <SectionHeading title="By model" hint="Highest total token use first." />
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3">Provider</TableHead>
                    <TableHead className="px-3">Model</TableHead>
                    <TableHead className="px-3 text-right">Requests</TableHead>
                    <TableHead className="px-3 text-right">Input</TableHead>
                    <TableHead className="px-3 text-right">Cache read</TableHead>
                    <TableHead className="px-3 text-right">Output</TableHead>
                    <TableHead className="px-3 text-right">Reasoning</TableHead>
                    <TableHead className="px-3 text-right">Total</TableHead>
                    <TableHead className="px-3 text-right">Cache hit</TableHead>
                    <TableHead className="px-3 text-right">Est. cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.byModel.map((row) => (
                    <TableRow key={`${row.provider}:${row.model}`}>
                      <TableCell className="px-3 text-muted-foreground">
                        {row.provider}
                      </TableCell>
                      <TableCell className="px-3 font-medium">{row.model}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatCount(row.calls)}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatCount(row.inputTokens)}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatCount(row.cachedInputTokens)}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatCount(row.outputTokens)}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatCount(row.reasoningTokens)}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatCount(row.totalTokens)}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatPercent(row.cacheHitRate)}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatCostUsd(row.estimatedCostUsd)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading title="By feature" hint="Highest token use first." />
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3">Feature</TableHead>
                    <TableHead className="px-3 text-right">Requests</TableHead>
                    <TableHead className="px-3 text-right">Failed</TableHead>
                    <TableHead className="px-3 text-right">Tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.byFeature.map((row) => (
                    <TableRow key={row.feature}>
                      <TableCell className="px-3 font-medium">{row.feature}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatCount(row.calls)}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums text-muted-foreground">
                        {formatCount(row.failedCalls)}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {formatCount(row.totalTokens)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
