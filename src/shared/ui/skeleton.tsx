import { forwardRef, type HTMLAttributes } from "react"
import { cn } from "@/shared/lib/utils"

/**
 * Loading placeholder. Uses the `shimmer` keyframe from globals.css.
 * Prefer this over spinners for content that has a known shape.
 */
const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "animate-shimmer rounded-md bg-muted",
        "bg-[linear-gradient(90deg,var(--color-muted)_0%,var(--color-input)_50%,var(--color-muted)_100%)] bg-[length:200%_100%]",
        "motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
)
Skeleton.displayName = "Skeleton"

export { Skeleton }
