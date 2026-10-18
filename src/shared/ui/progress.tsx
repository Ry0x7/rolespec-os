import { forwardRef, type HTMLAttributes } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/shared/lib/utils"

const progressVariants = cva("w-full overflow-hidden rounded-full bg-muted", {
  variants: {
    size: {
      sm: "h-1",
      md: "h-1.5",
      lg: "h-2.5",
    },
  },
  defaultVariants: {
    size: "md",
  },
})

const progressBarVariants = cva(
  "h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none",
  {
    variants: {
      color: {
        brand: "bg-brand-500",
        success: "bg-green-600 dark:bg-green-500",
        warning: "bg-amber-600 dark:bg-amber-500",
        error: "bg-red-600 dark:bg-red-500",
        neutral: "bg-muted-foreground",
      },
    },
    defaultVariants: {
      color: "brand",
    },
  }
)

export interface ProgressProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "color">,
    VariantProps<typeof progressVariants>,
    VariantProps<typeof progressBarVariants> {
  /** Current value. Clamped between 0 and `max`. */
  value: number
  max?: number
  /** Accessible name. Falls back to aria-label / aria-labelledby from props. */
  label?: string
  barClassName?: string
}

const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  (
    { className, barClassName, value, max = 100, size, color, label, ...props },
    ref
  ) => {
    const safeMax = max > 0 ? max : 100
    const clamped = Math.min(Math.max(value, 0), safeMax)
    const percent = (clamped / safeMax) * 100

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
        aria-label={label ?? props["aria-label"]}
        className={cn(progressVariants({ size, className }))}
        {...props}
      >
        <div
          className={cn(progressBarVariants({ color, className: barClassName }))}
          style={{ width: `${percent}%` }}
        />
      </div>
    )
  }
)
Progress.displayName = "Progress"

export { Progress, progressVariants, progressBarVariants }
