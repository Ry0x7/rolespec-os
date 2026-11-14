import { cn } from "@/shared/lib/utils"

/**
 * RoleSpec mark: a hand-drawn "R" monogram (stroke geometry, 24x24 grid).
 * Solid brand tile with a white glyph — the app-icon treatment — so it reads
 * at 24px in the sidebar, nav and favicon. No gradient.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white",
        className
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-[62%] w-[62%]">
        <path d="M7 19.5v-15h5.5a3.75 3.75 0 0 1 0 7.5H7" />
        <path d="M12.5 12 17.5 19.5" />
      </svg>
    </span>
  )
}
