import { cn } from "@/shared/lib/utils"
import { Badge, type BadgeProps } from "@/shared/ui/badge"
import {
  JOB_REQUIREMENT_FLAGS,
  type JobRequirementFlag,
} from "../services/job-requirements.service"

const REQUIREMENT_CONFIG: Record<
  JobRequirementFlag,
  { variant: NonNullable<BadgeProps["variant"]>; label: string }
> = {
  // Restrictive: these can rule a candidate out, so they read as warnings.
  [JOB_REQUIREMENT_FLAGS.US_ONLY]: { variant: "warning", label: "US only" },
  [JOB_REQUIREMENT_FLAGS.CITIZENSHIP_REQUIRED]: {
    variant: "warning",
    label: "Citizenship required",
  },
  [JOB_REQUIREMENT_FLAGS.RESIDENCY_REQUIRED]: {
    variant: "warning",
    label: "Residency required",
  },
  [JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP]: { variant: "warning", label: "No sponsorship" },
  [JOB_REQUIREMENT_FLAGS.SECURITY_CLEARANCE]: {
    variant: "warning",
    label: "Security clearance",
  },
  // Good news for anyone who needs it.
  [JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE]: {
    variant: "success",
    label: "Sponsorship available",
  },
  // Informational: worth knowing before applying, but not a knockout on its own.
  [JOB_REQUIREMENT_FLAGS.WORK_AUTH_REQUIRED]: {
    variant: "neutral",
    label: "Work authorization",
  },
  [JOB_REQUIREMENT_FLAGS.LOCATION_RESTRICTED]: {
    variant: "neutral",
    label: "Location restricted",
  },
  [JOB_REQUIREMENT_FLAGS.ONSITE_REQUIRED]: { variant: "neutral", label: "Onsite required" },
}

interface RequirementBadgesProps {
  /** Straight off the `requirementFlags` Json column, so nothing guarantees its shape. */
  flags: string[] | null | undefined
  size?: BadgeProps["size"]
  className?: string
}

/**
 * Renders the eligibility requirements a posting states, so the restriction that
 * would disqualify you shows up before you spend an hour on the application.
 * Renders nothing when the posting stated none — the absence is the "no
 * restrictions found" state.
 */
export function RequirementBadges({ flags, size, className }: RequirementBadgesProps) {
  if (!Array.isArray(flags)) return null

  const known = flags.filter(
    (flag): flag is JobRequirementFlag =>
      typeof flag === "string" && flag in REQUIREMENT_CONFIG
  )
  if (known.length === 0) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {known.map((flag) => {
        const config = REQUIREMENT_CONFIG[flag]
        return (
          <Badge key={flag} variant={config.variant} size={size}>
            {config.label}
          </Badge>
        )
      })}
    </div>
  )
}
