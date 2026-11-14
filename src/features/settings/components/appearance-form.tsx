"use client"

import { useState } from "react"
import { Bell, Check, EyeOff, Monitor, Moon, Play, SlidersHorizontal, Sparkles, Sun, Upload, X } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card"
import { useAccentTheme } from "@/shared/hooks/use-accent-theme"
import { useThemeMode } from "@/shared/hooks/use-theme-mode"
import { useMotionMode } from "@/shared/hooks/use-motion-mode"
import { useThemePreset } from "@/shared/hooks/use-theme-preset"
import { useNotificationSound } from "@/shared/hooks/use-notification-sound"
import { Button } from "@/shared/ui/button"
import { Select } from "@/shared/ui/select"
import { MAX_CUSTOM_SOUND_BYTES, NOTIFICATION_SOUNDS, type NotificationSoundId } from "@/shared/lib/notification-sound"
import {
  ACCENT_THEMES,
  THEME_MODES,
  THEME_PRESETS,
  MOTION_MODES,
  type ThemeMode,
  type MotionMode,
} from "@/shared/lib/theme"

const MODE_ICONS: Record<ThemeMode, typeof Moon> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
}

const MOTION_ICONS: Record<MotionMode, typeof Sparkles> = {
  system: SlidersHorizontal,
  reduced: EyeOff,
  full: Sparkles,
}

export function AppearanceForm() {
  const { theme, setTheme } = useAccentTheme()
  const { preset, setPreset } = useThemePreset()
  const { mode, setMode } = useThemeMode()
  const { motionMode, setMotionMode, isReducedMotion } = useMotionMode()
  const {
    sound,
    customDataUrl,
    setSound,
    setCustomDataUrl,
    removeCustomDataUrl,
    preview,
  } = useNotificationSound()
  const [soundError, setSoundError] = useState<string | null>(null)

  function handleSoundFile(file: File | undefined) {
    setSoundError(null)
    if (!file) return
    if (!file.type.startsWith("audio/")) {
      setSoundError("Choose an audio file (MP3, WAV, OGG or M4A).")
      return
    }
    if (file.size > MAX_CUSTOM_SOUND_BYTES) {
      setSoundError("That file is larger than 200 KB. Pick a shorter sound.")
      return
    }
    const reader = new FileReader()
    reader.onerror = () => setSoundError("Could not read that file. Try another one.")
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCustomDataUrl(reader.result)
        setSound("custom")
      }
    }
    reader.readAsDataURL(file)
  }

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
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">Theme style</p>
            <p className="text-xs text-muted-foreground">
              Changes the surfaces. Accent stays independent.
            </p>
          </div>
          <div
            role="group"
            aria-label="Theme style"
            className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
          >
            {THEME_PRESETS.map((option) => {
              const selected = option.id === preset
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setPreset(option.id)}
                  title={option.description}
                  className={`flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selected
                      ? "border-brand-500 bg-brand-500/10"
                      : "border-border bg-muted/20 hover:bg-muted/50"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-9 w-9 shrink-0 rounded-md border border-white/10"
                    style={{
                      background: `linear-gradient(135deg, ${option.swatch}, color-mix(in srgb, ${option.swatch} 55%, #ffffff 10%))`,
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {option.label}
                      {selected ? " · selected" : ""}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Motion & Animations</p>
            <span className="text-xs text-muted-foreground">
              {isReducedMotion ? "Reduced motion active" : "Full motion active"}
            </span>
          </div>
          <div
            role="group"
            aria-label="Motion preference"
            className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1"
          >
            {MOTION_MODES.map((option) => {
              const Icon = MOTION_ICONS[option.id]
              const selected = option.id === motionMode
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  title={option.description}
                  onClick={() => setMotionMode(option.id)}
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
          <p className="text-xs text-muted-foreground">
            {motionMode === "reduced"
              ? "All fluid particle canvases, spring layout animations, and transitions are minimized."
              : motionMode === "full"
                ? "Full ambient particles, spring physics, and Framer Motion transitions are enabled."
                : "Automatically respects your operating system's reduced motion accessibility settings."}
          </p>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Notification sound
            </p>
            <p className="text-xs text-muted-foreground">
              Plays when a message appears. Saved to this device.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-52 flex-1 space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Sound</span>
              <Select
                aria-label="Notification sound"
                value={sound}
                onChange={(event) => setSound(event.target.value as NotificationSoundId)}
              >
                {NOTIFICATION_SOUNDS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} — {option.description}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={preview}
              disabled={sound === "off" || (sound === "custom" && !customDataUrl)}
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Preview
            </Button>
          </div>

          {sound === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-input focus-within:ring-2 focus-within:ring-ring">
                <Upload className="h-4 w-4" aria-hidden="true" />
                {customDataUrl ? "Replace audio file" : "Choose audio file"}
                <input
                  type="file"
                  accept="audio/*"
                  className="sr-only"
                  onChange={(event) => {
                    handleSoundFile(event.target.files?.[0])
                    event.target.value = ""
                  }}
                />
              </label>
              {customDataUrl ? (
                <Button type="button" variant="ghost" onClick={removeCustomDataUrl}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Remove file
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  MP3, WAV, OGG or M4A up to 200 KB.
                </span>
              )}
            </div>
          )}

          {soundError && <p role="alert" className="text-xs text-error">{soundError}</p>}
        </div>

        <p className="text-xs text-muted-foreground pt-1">
          Applies instantly. Saved to this device.
        </p>
      </CardContent>
    </Card>
  )
}
