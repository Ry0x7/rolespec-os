import { memo, type ReactNode } from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Card } from "@/shared/ui/card"
import { cn } from "@/shared/lib/utils"

export interface EmptyStateQuickLink {
  label: string
  href: string
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
  variant?: "card" | "bare"
  /** One-click creates rendered next to the primary action — less friction. */
  quickLinks?: EmptyStateQuickLink[]
  /** e.g. "Press ⌘K for quick actions". */
  hint?: string
}

const QuickLinks = memo(function QuickLinks({ links }: { links: EmptyStateQuickLink[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {links.map((link) => (
        <Link
          key={link.href + link.label}
          href={link.href}
          className="rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {link.label}
        </Link>
      ))}
    </div>
  )
})

export const EmptyState = memo(function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  variant = "card",
  quickLinks,
  hint,
}: EmptyStateProps) {
  const footer = (
    <>
      {action ? <div className="flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
      {quickLinks && quickLinks.length > 0 ? <QuickLinks links={quickLinks} /> : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </>
  )

  // `footer` is cheap JSX (no state) but memoizing the shell avoids
  // re-rendering icon + copy when a parent list re-renders.
  if (variant === "bare") {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-8 gap-2 text-center",
          className
        )}
      >
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">{title}</p>
        {description && (
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
        {footer}
      </div>
    )
  }

  return (
    <Card
      className={cn(
        "flex flex-col items-center justify-center py-12 gap-3 text-center",
        className
      )}
    >
      <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {footer}
    </Card>
  )
})
