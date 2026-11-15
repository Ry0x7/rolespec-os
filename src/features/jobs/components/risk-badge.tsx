import { cn } from "@/shared/lib/utils"
import { Badge, type BadgeProps } from "@/shared/ui/badge"
import { JobRiskLevel } from "@/generated/prisma/enums"

const RISK_CONFIG: Record<
  JobRiskLevel,
  {
    variant: NonNullable<BadgeProps["variant"]>
    label: string
    className?: string
  }
> = {
  LOW: { variant: "warning", label: "Low risk" },
  MEDIUM: { variant: "warning", label: "Possible scam" },
  HIGH: { variant: "error", label: "Likely scam" },
}

interface RiskBadgeProps {
  /** Null when the job was never checked, or checked and cleared. */
  level: JobRiskLevel | null | undefined
  size?: BadgeProps["size"]
  className?: string
}

/** Renders nothing for an unflagged job — the absence of a badge is the "fine" state. */
export function RiskBadge({ level, size, className }: RiskBadgeProps) {
  if (!level) return null

  const config = RISK_CONFIG[level]
  return (
    <Badge
      variant={config.variant}
      size={size}
      className={cn(config.className, className)}
    >
      {config.label}
    </Badge>
  )
}
