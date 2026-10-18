/**
 * Accent themes and light/dark mode.
 *
 * The whole mechanism is one class on <html> (`theme-<id>`) which plain-CSS
 * blocks in globals.css use to override `--color-brand-*` / `--color-accent` /
 * `--color-ring`. The default (violet) needs no class, so it has none.
 *
 * Persisted per device in localStorage — no DB column, no server round trip.
 */

export const ACCENT_THEMES = [
  { id: "violet", label: "Violet", swatch: "#9333EA" },
  { id: "blue", label: "Blue", swatch: "#155DFC" },
  { id: "emerald", label: "Emerald", swatch: "#009966" },
  { id: "amber", label: "Amber", swatch: "#E17100" },
  { id: "rose", label: "Rose", swatch: "#EC003F" },
  { id: "cyan", label: "Cyan", swatch: "#0092B8" },
] as const

export type AccentTheme = (typeof ACCENT_THEMES)[number]["id"]

export const DEFAULT_ACCENT_THEME: AccentTheme = "violet"

export const ACCENT_STORAGE_KEY = "rolespec-accent"

export function isAccentTheme(value: unknown): value is AccentTheme {
  return ACCENT_THEMES.some((theme) => theme.id === value)
}

/**
 * Swaps the `theme-*` class on <html>. The default theme carries no class so it
 * always matches the @theme defaults, even if this never runs.
 */
export function applyTheme(theme: AccentTheme): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  for (const candidate of ACCENT_THEMES) {
    root.classList.remove(`theme-${candidate.id}`)
  }
  if (theme !== DEFAULT_ACCENT_THEME) {
    root.classList.add(`theme-${theme}`)
  }
}

/** Reads the stored theme, falling back to the default on anything unexpected. */
export function getStoredTheme(): AccentTheme {
  if (typeof window === "undefined") return DEFAULT_ACCENT_THEME
  try {
    const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY)
    return isAccentTheme(stored) ? stored : DEFAULT_ACCENT_THEME
  } catch {
    // Private modes and blocked storage throw on access.
    return DEFAULT_ACCENT_THEME
  }
}

export function storeTheme(theme: AccentTheme): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, theme)
  } catch {
    // Non-fatal: the accent still applies for this session.
  }
}

/**
 * Colour mode. `system` follows the OS; the other two pin it. Persisted per
 * device alongside the accent, and applied as a `dark` / `light` class on <html>
 * which globals.css uses to swap the semantic tokens.
 */
export const THEME_MODES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
] as const

export type ThemeMode = (typeof THEME_MODES)[number]["id"]

/** Dark, so existing users see no change when they have nothing stored. */
export const DEFAULT_THEME_MODE: ThemeMode = "dark"

export const MODE_STORAGE_KEY = "rolespec-mode"

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)"

export function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.some((mode) => mode.id === value)
}

/** Collapses `system` to the concrete class the document should carry. */
export function resolveMode(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode
  if (typeof window === "undefined" || !window.matchMedia) return "dark"
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light"
}

/** Swaps the `dark` / `light` class on <html>. Exactly one is ever present. */
export function applyMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return
  const resolved = resolveMode(mode)
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.classList.toggle("light", resolved === "light")
}

/** Reads the stored mode, falling back to the default on anything unexpected. */
export function getStoredMode(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME_MODE
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY)
    return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE
  } catch {
    // Private modes and blocked storage throw on access.
    return DEFAULT_THEME_MODE
  }
}

export function storeMode(mode: ThemeMode): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // Non-fatal: the mode still applies for this session.
  }
}

/**
 * Blocking <head> script that applies the stored accent and mode before first
 * paint, so neither the accent nor the background flashes. Kept tiny and
 * dependency-free on purpose — it runs as a string, so it cannot import from
 * this module. Anything other than an explicit "light" resolves to dark, which
 * matches the class the server renders.
 */
export const ACCENT_INIT_SCRIPT = `try{var d=document.documentElement;var t=localStorage.getItem("${ACCENT_STORAGE_KEY}");var v=${JSON.stringify(
  ACCENT_THEMES.map((theme) => theme.id).filter(
    (id) => id !== DEFAULT_ACCENT_THEME
  )
)};if(v.indexOf(t)>-1)d.classList.add("theme-"+t);var m=localStorage.getItem("${MODE_STORAGE_KEY}");if(m==="system")m=matchMedia("${DARK_SCHEME_QUERY}").matches?"dark":"light";if(m!=="light")m="dark";d.classList.toggle("dark",m==="dark");d.classList.toggle("light",m==="light")}catch(e){}`
