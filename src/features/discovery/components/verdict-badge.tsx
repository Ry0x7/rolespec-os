import { Badge, type BadgeProps } from "@/shared/ui/badge"

import type { QualificationVerdict } from "../services/qualify.service"

/**
 * Label and tint per verdict — the single source for how a qualification verdict
 * looks anywhere in the app.
 *
 * Deliberately in its own module rather than inside `QualificationSummary`: that
 * is a `"use client"` file, and a server component reading a plain object out of
 * a client module gets a client reference proxy, not the object.
 */
const VERDICT_CONFIG: Record<
  QualificationVerdict,
  { variant: NonNullable<BadgeProps["variant"]>; label: string }
> = {
  STRONG: { variant: "success", label: "Strong fit" },
  WORTH_A_LOOK: { variant: "info", label: "Worth a look" },
  WEAK: { variant: "warning", label: "Weak fit" },
  BLOCKED: { variant: "error", label: "Ruled out" },
}

interface Props {
  verdict: QualificationVerdict
  size?: BadgeProps["size"]
}

export function VerdictBadge({ verdict, size = "sm" }: Props) {
  const { variant, label } = VERDICT_CONFIG[verdict]
  return (
    <Badge variant={variant} size={size}>
      {label}
    </Badge>
  )
}
