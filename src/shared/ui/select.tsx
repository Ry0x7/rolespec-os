import { forwardRef, type CSSProperties, type SelectHTMLAttributes } from "react"
import { cn } from "@/shared/lib/utils"

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

/**
 * Chevron + the room it needs, applied inline rather than as utility classes on
 * purpose: several call sites shrink the control with their own `px-*` (the
 * workspace kanban card uses `h-7 px-2 text-xs`), and tailwind-merge would drop
 * a base `pr-*` in favour of that later `px-*`, dropping the label under the
 * arrow. An inline padding beats any class, so the arrow can never collide.
 * `--select-chevron` is declared per colour mode in globals.css.
 */
const CHEVRON_STYLE: CSSProperties = {
  backgroundImage: "var(--select-chevron)",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.5rem center",
  backgroundSize: "1rem 1rem",
  paddingInlineEnd: "1.75rem",
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, style, ...props }, ref) => {
    return (
      <select
        // Same height, fill, border, radius and focus ring as Input — a select
        // and a text field sitting next to each other have to line up.
        className={cn(
          "flex h-10 w-full appearance-none rounded-md border border-border bg-muted px-3 py-1 text-base text-foreground shadow-sm transition-colors sm:h-9 sm:text-sm",
          "hover:border-input",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        style={{ ...CHEVRON_STYLE, ...style }}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    )
  }
)
Select.displayName = "Select"

export { Select }
