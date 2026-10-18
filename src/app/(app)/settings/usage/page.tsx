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
import { getUserAiUsage } from "@/features/settings/services/ai-usage.service"

export const dynamic = "force-dynamic"

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
        {typeof value === "number" ? value.toLocaleString() : value}
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

export default async function SettingsUsagePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const usage = await getUserAiUsage(session.user.id)

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Your AI usage</h1>
        <p className="text-sm text-muted-foreground">
          Tokens your account has used in the last {usage.windowDays} days, billed
          to your own provider key.
        </p>
      </div>

      {usage.totals.calls === 0 ? (
        <EmptyState
          icon={Activity}
          title="No AI calls yet"
          description={`Nothing has run on your account in the last ${usage.windowDays} days. Usage appears here as soon as you use an AI feature.`}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile label="AI requests" value={usage.totals.calls} />
            <StatTile label="Total tokens" value={usage.totals.totalTokens} />
            <StatTile
              label="Estimated cost"
              value={formatCostUsd(usage.totals.estimatedCostUsd)}
              hint="Estimated from public list prices; your provider bill is authoritative."
            />
            <StatTile label="Input tokens" value={usage.totals.inputTokens} />
            <StatTile label="Output tokens" value={usage.totals.outputTokens} />
            <StatTile label="Failed requests" value={usage.totals.failedCalls} />
          </div>

          <section className="space-y-3">
            <SectionHeading
              title="Activity"
              hint={`Daily token totals for the last ${usage.windowDays} UTC days.`}
            />
            <Card className="p-4">
              <MiniBarChart data={usage.tokensByDay} label="Total tokens" />
            </Card>
          </section>

          <section className="space-y-3">
            <SectionHeading title="By model" hint="Highest token use first." />
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3">Provider</TableHead>
                    <TableHead className="px-3">Model</TableHead>
                    <TableHead className="px-3 text-right">Requests</TableHead>
                    <TableHead className="px-3 text-right">Input</TableHead>
                    <TableHead className="px-3 text-right">Output</TableHead>
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
                        {row.calls.toLocaleString()}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {row.inputTokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {row.outputTokens.toLocaleString()}
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
                        {row.calls.toLocaleString()}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums text-muted-foreground">
                        {row.failedCalls.toLocaleString()}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {row.totalTokens.toLocaleString()}
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
