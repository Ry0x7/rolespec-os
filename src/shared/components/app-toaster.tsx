"use client"

import { Toaster } from "sonner"
import { useThemeMode } from "@/shared/hooks/use-theme-mode"

/**
 * Client boundary around Sonner so toasts follow the colour mode. Sonner accepts
 * "system" directly, so the stored mode maps straight onto its `theme` prop; the
 * surface colours come from the semantic tokens either way.
 */
export function AppToaster() {
  const { mode } = useThemeMode()

  return (
    <Toaster
      theme={mode}
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          color: "var(--color-card-foreground)",
        },
      }}
    />
  )
}
