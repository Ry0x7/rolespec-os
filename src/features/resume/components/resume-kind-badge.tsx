import { Badge } from "@/shared/ui/badge"

export type ResumeKind = "MASTER" | "ROLE_FAMILY" | "JOB_TAILORED"

interface Props {
  variant: ResumeKind
  /** Shown beside the badge for a role-family resume; ignored otherwise. */
  roleFamilyName?: string | null
}

/**
 * What kind of resume this is — Master, Role family (with its family name) or
 * Job tailored. Shared by the list card and the editor header so both name the
 * kind the same way. Renders siblings rather than a wrapper, so it sits in
 * whatever flex row the caller already lays out.
 */
export function ResumeKindBadge({ variant, roleFamilyName }: Props) {
  return (
    <>
      <Badge variant={variant === "MASTER" ? "neutral" : "brand"} size="sm">
        {variant === "MASTER"
          ? "Master"
          : variant === "ROLE_FAMILY"
            ? "Role family"
            : "Job tailored"}
      </Badge>
      {variant === "ROLE_FAMILY" && roleFamilyName && (
        <span className="truncate text-xs text-muted-foreground">
          {roleFamilyName}
        </span>
      )}
    </>
  )
}
