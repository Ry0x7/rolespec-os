import { forwardRef, type ButtonHTMLAttributes } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { cn } from "@/shared/lib/utils"

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
  {
    variants: {
      variant: {
        // A disabled primary kept its brand fill at half opacity, which still
        // read as a live button next to a disabled secondary. Disabled it drops
        // the glow and the brand fill, so "can't press this" is unambiguous.
        default:
          "bg-brand-700 text-white hover:bg-brand-600 active:bg-brand-800 shadow-glow-sm disabled:bg-muted disabled:text-muted-foreground",
        secondary:
          "bg-muted text-muted-foreground border border-border hover:bg-input active:bg-border",
        ghost:
          "hover:bg-muted text-muted-foreground hover:text-foreground active:bg-input",
        // `error` is the theme's status red; the raw Tailwind palette is not a
        // token, so destructive stayed off-palette wherever the theme changed.
        destructive:
          "bg-error text-white hover:bg-error/90 active:bg-error/80",
        outline:
          "border border-border hover:bg-muted text-foreground active:bg-input",
        link: "text-brand-400 underline-offset-4 hover:underline active:text-brand-300",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner and disables the button. */
  loading?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, loading = false, disabled, children, ...props },
    ref
  ) => {
    return (
      <button
        className={cn(
          buttonVariants({ variant, size }),
          // Loading disables the button, but a spinner on a greyed-out control
          // reads as dead rather than busy — a loading primary keeps its fill.
          loading &&
            (variant ?? "default") === "default" &&
            "disabled:bg-brand-700 disabled:text-white",
          className
        )}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : null}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
