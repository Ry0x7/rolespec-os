"use client"

import { Check, Monitor, Moon, Sun } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card"
import { useAccentTheme } from "@/shared/hooks/use-accent-theme"
import { useThemeMode } from "@/shared/hooks/use-theme-mode"
import { ACCENT_THEMES, THEME_MODES, type ThemeMode } from "@/shared/lib/theme"

const MODE_ICONS: Record<ThemeMode, typeof Moon> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
}

export function AppearanceForm() {
  const { theme, setTheme } = useAccentTheme()
  const { mode, setMode } = useThemeMode()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Pick the colour mode and accent used across RoleSpec.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">Mode</p>
          <div
            role="group"
            aria-label="Colour mode"
            className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1"
          >
            {THEME_MODES.map((option) => {
              const Icon = MODE_ICONS[option.id]
              const selected = option.id === mode
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMode(option.id)}
                  className={`inline-flex h-11 min-w-[44px] items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                    selected
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Accent</p>
          <div role="group" aria-label="Accent colour" className="flex flex-wrap gap-2">
            {ACCENT_THEMES.map((accent) => {
              const selected = accent.id === theme
              return (
                <button
                  key={accent.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={accent.label}
                  title={accent.label}
                  onClick={() => setTheme(accent.id)}
                  className={`flex h-11 w-11 items-center justify-center rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                    selected
                      ? "ring-2 ring-ring ring-offset-2 ring-offset-card"
                      : "ring-1 ring-border hover:ring-input"
                  }`}
                  style={{ backgroundColor: accent.swatch }}
                >
                  {selected ? (
                    <Check className="h-5 w-5 text-white" aria-hidden="true" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Applies instantly. Saved to this device.
        </p>
      </CardContent>
    </Card>
  )
}
