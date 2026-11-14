import { forwardRef, type HTMLAttributes } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/shared/lib/utils"

const cardVariants = cva("rounded-lg border border-border bg-card p-4 sm:p-6", {
  variants: {
    variant: {
      default: "",
      /** Clickable surface: border + elevation shift on hover, press feedback. */
      interactive:
        "transition-[background-color,border-color,box-shadow] duration-150 hover:border-input hover:shadow-md active:bg-muted/40 focus-within:border-input",
      elevated: "shadow-md",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, className }))}
      {...props}
    />
  )
)
Card.displayName = "Card"

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5", className)} {...props} />
  )
)
CardHeader.displayName = "CardHeader"

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        "font-display text-lg font-semibold text-foreground",
        className
      )}
      {...props}
    />
  )
)
CardTitle.displayName = "CardTitle"

const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

/**
 * Card owns the outer padding; CardContent only adds the gap that separates it
 * from a preceding CardHeader. As the first child it adds nothing, so a
 * header-less card is not double-padded at the top.
 */
const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("[&:not(:first-child)]:pt-4", className)}
      {...props}
    />
  )
)
CardContent.displayName = "CardContent"

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  cardVariants,
}
