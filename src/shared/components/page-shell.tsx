import { memo, type ReactNode } from "react"
import { cn } from "@/shared/lib/utils"

interface PageShellProps {
  children: ReactNode
  className?: string
}

/**
 * The single content container for every route under `(app)`.
 *
 * Before this existed each page picked its own width (max-w-3xl through
 * max-w-7xl), so the content column jumped on every navigation. The shell now
 * uses the desktop width instead of a phone-like reading column: a 1920px cap
 * still keeps very long lines from becoming unreadable on an ultrawide monitor.
 * `(app)/loading.tsx` uses the same measurements so the skeleton does not snap
 * width when the page resolves.
 *
 * The one documented exception is the resume editor (`/resumes/[id]`), a
 * full-bleed split-pane working surface — see the note on that page.
 */
export const PageShell = memo(function PageShell({ children, className }: PageShellProps) {
  return (
    // `content-visibility: auto` lets long pages skip offscreen layout work;
    // `contain-intrinsic-size` reserves space so scrollbars do not jump.
    <div className={cn("mx-auto w-full max-w-[1920px] space-y-6 xl:space-y-5", className)} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 1200px" }}>
      {children}
    </div>
  )
})
