"use client"

import { Lightbulb } from "lucide-react"

export function SectionTip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}
