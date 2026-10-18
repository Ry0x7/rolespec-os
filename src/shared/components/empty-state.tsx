import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Card } from "@/shared/ui/card"
import { cn } from "@/shared/lib/utils"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
  variant?: "card" | "bare"
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  variant = "card",
}: EmptyStateProps) {
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
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {action}
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
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </Card>
  )
}
