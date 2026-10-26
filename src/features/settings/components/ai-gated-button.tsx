"use client"

import type { ReactNode } from "react"
import { cn } from "@/shared/lib/utils"

/**
 * AI-optional gate: never hides the action, only disables it with an
 * explanatory tooltip when no provider key is configured. Keeps the UI
 * discoverable offline — the user sees what AI would do and where to enable it.
 */
export function AiGatedButton({
  hasKey,
  tooltip = "Add an AI provider key in Settings → AI to enable this. Manual editing still works.",
  settingsHref = "/settings/ai",
  children,
  className,
}: {
  hasKey: boolean
  tooltip?: string
  settingsHref?: string
  children: ReactNode
  className?: string
}) {
  if (hasKey) return <>{children}</>

  return (
    <span
      title={tooltip}
      aria-disabled="true"
      className={cn("inline-flex cursor-not-allowed opacity-70", className)}
      data-ai-gated="true"
    >
      <span className="pointer-events-none inline-flex [&_button]:pointer-events-none">
        {children}
      </span>
      <a
        href={settingsHref}
        className="sr-only focus:not-sr-only focus:underline"
        tabIndex={-1}
      >
        Open AI settings
      </a>
    </span>
  )
}

/** Small inline hint rendered next to a disabled AI action. */
export function AiDisabledHint({ text }: { text?: string }) {
  return (
    <span
      className="text-xs text-muted-foreground"
      title="AI is optional. This action needs a provider key; everything else works offline."
    >
      {text ?? "Needs AI key — manual path available"}
    </span>
  )
}
