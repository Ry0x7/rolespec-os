import Link from "next/link"
import { cn } from "@/shared/lib/utils"

export function WorkspaceViews({ active }: { active: "board" | "runs" | "tracking" }) {
  // Wraps instead of scrolling sideways. Three labels fit on a phone in two
  // rows, and an off-screen tab was easy to miss entirely.
  return <nav aria-label="Workspace views" className="flex flex-wrap gap-1 border-b border-border pb-2">{[
    { key: "board", label: "Pipeline board", href: "/workspace" },
    { key: "runs", label: "Preparation runs", href: "/workspace?view=runs" },
    { key: "tracking", label: "Staging & follow-ups", href: "/workspace?view=tracking" },
  ].map(view => <Link key={view.key} href={view.href} aria-current={active === view.key ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-md px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring", active === view.key ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted")}>{view.label}</Link>)}</nav>
}
