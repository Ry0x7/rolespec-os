"use client"

import { Check, X } from "lucide-react"
import { portfolioOfflineCheck } from "../lib/portfolio-offline-check"

/**
 * URL hygiene checklist shown live as the user types — no AI, no fetch.
 * Complements the AI rating card with instant, always-available feedback.
 */
export function PortfolioOfflineChecklist({ url }: { url: string }) {
  const trimmed = url.trim()
  if (!trimmed) return null
  const checks = portfolioOfflineCheck(trimmed)
  return (
    <ul className="flex flex-wrap gap-2" aria-label="URL checks">
      {checks.map((check) => (
        <li
          key={check.id}
          title={check.hint}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
        >
          {check.pass ? (
            <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
          ) : (
            <X className="h-3 w-3 text-amber-500" aria-hidden="true" />
          )}
          {check.label}
        </li>
      ))}
    </ul>
  )
}
