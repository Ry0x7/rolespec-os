import { forwardRef, type HTMLAttributes } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/shared/lib/utils"

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-md border font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-border bg-muted text-muted-foreground",
        brand: "border-brand-500/20 bg-brand-500/10 text-brand-300",
        success:
          "border-green-600/20 bg-green-600/10 text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400",
        warning:
          "border-amber-600/20 bg-amber-600/10 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400",
        error:
          "border-red-600/20 bg-red-600/10 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400",
        info:
          "border-blue-600/20 bg-blue-600/10 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400",
        outline: "border-border bg-transparent text-foreground",
      },
      size: {
        sm: "px-1.5 py-0 text-[11px] leading-5",
        md: "px-2 py-0.5 text-xs",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "md",
    },
  }
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant, size, className }))}
      {...props}
    />
  )
)
Badge.displayName = "Badge"

export { Badge, badgeVariants }
