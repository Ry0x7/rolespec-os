import { cn } from "@/shared/lib/utils"
import { Badge, type BadgeProps } from "@/shared/ui/badge"
import { ApplicationStatus } from "@/generated/prisma/enums"

const STATUS_CONFIG: Record<
  ApplicationStatus,
  {
    variant: NonNullable<BadgeProps["variant"]>
    label: string
    className?: string
  }
> = {
  INTERESTED: { variant: "info", label: "Interested" },
  APPLIED: { variant: "brand", label: "Applied" },
  SCREENING: {
    variant: "info",
    label: "Screening",
    // Kept visually distinct from INTERESTED; cyan is not a Badge variant.
    className: "border-cyan-500/20 bg-cyan-500/10 text-cyan-400",
  },
  INTERVIEW: { variant: "warning", label: "Interview" },
  OFFER: { variant: "success", label: "Offer" },
  REJECTED: { variant: "error", label: "Rejected" },
  WITHDRAWN: { variant: "neutral", label: "Withdrawn" },
}

interface StatusBadgeProps {
  status: ApplicationStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return (
    <Badge variant={config.variant} className={cn(config.className, className)}>
      {config.label}
    </Badge>
  )
}
