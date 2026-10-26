import { memo, useMemo } from "react"
import Link from "next/link"
import { FileText, ScanLine, Send } from "lucide-react"
import { Card, CardHeader, CardTitle } from "@/shared/ui/card"

interface StatsPanelProps {
  resumeCount: number
  atsScannedCount: number
  applicationCount: number
}

export const StatsPanel = memo(function StatsPanel({
  resumeCount,
  atsScannedCount,
  applicationCount,
}: StatsPanelProps) {
  const stats = useMemo(
    () => [
    {
      label: "Resumes",
      value: resumeCount,
      icon: FileText,
      href: "/resumes",
    },
    {
      label: "ATS-scored resumes",
      value: atsScannedCount,
      icon: ScanLine,
      href: "/resumes",
    },
      {
        label: "Applications tracked",
        value: applicationCount,
        icon: Send,
        href: "/jobs",
      },
    ],
    [resumeCount, atsScannedCount, applicationCount]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Your activity</CardTitle>
      </CardHeader>

      <ul className="mt-3 divide-y divide-border">
        {stats.map((stat) => (
          <li key={stat.label}>
            <Link
              href={stat.href}
              className="group flex items-center gap-3 py-2.5 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <stat.icon
                className="h-4 w-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-brand-400"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {stat.label}
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {stat.value}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
})
