import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"

interface PaginationProps {
  /** 1-based. */
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  /** Accessible name for the nav landmark, e.g. "Capabilities pages". */
  label?: string
  size?: "sm" | "default"
  className?: string
}

/**
 * Previous / "Page x of y" / Next for a bounded list. Renders nothing when
 * everything fits on one page; the end buttons disable rather than wrap.
 */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  label,
  size = "sm",
  className,
}: PaginationProps) {
  if (pageCount <= 1) return null
  return (
    <nav
      aria-label={label ?? "Pagination"}
      className={cn(
        "flex items-center justify-between gap-2 text-muted-foreground",
        size === "sm" ? "text-xs" : "text-sm",
        className
      )}
    >
      <Button
        type="button"
        size={size}
        variant="ghost"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <Button
        type="button"
        size={size}
        variant="ghost"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}
