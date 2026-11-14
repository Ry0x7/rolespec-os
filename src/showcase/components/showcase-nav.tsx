import React, { useEffect, useRef, useState } from "react"
import { LogoMarkIcon, MenuIcon, XIcon, DownloadIcon, SunIcon, MoonIcon } from "./icons"

interface ShowcaseNavProps {
  isReducedMotion: boolean
  onToggleMotion: () => void
  theme: "light" | "dark"
  onToggleTheme: () => void
}

const LINKS = [
  { href: "#hyperframes", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#models", label: "AI models" },
  { href: "#quickstart", label: "Download" },
]

export function ShowcaseNav({ isReducedMotion, onToggleMotion, theme, onToggleTheme }: ShowcaseNavProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  useEffect(() => {
    if (!open && wasOpen.current) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <header className="sticky top-0 z-50 w-full border-b" style={{ background: "var(--nav-bg)", borderColor: "var(--border-soft)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
        <a href="#" className="flex shrink-0 items-center gap-2" aria-label="RoleSpec OS home" style={{ color: "var(--text)" }}>
          <LogoMarkIcon className="h-6 w-6" />
          <span className="text-sm font-semibold tracking-tight">RoleSpec OS</span>
        </a>

        <nav aria-label="Main" className="hidden items-center gap-7 text-sm md:flex" style={{ color: "var(--text-2)" }}>
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="opacity-80 transition-opacity hover:opacity-100">{l.label}</a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}
            aria-pressed={theme === "dark"}
            title={theme === "dark" ? "Light appearance" : "Dark appearance"}
            className="hidden h-9 w-9 items-center justify-center rounded-full transition-opacity hover:opacity-70 sm:inline-flex"
            style={{ color: "var(--text-2)" }}
          >
            {theme === "dark" ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={onToggleMotion}
            aria-label={isReducedMotion ? "Reduced motion active. Click to enable full animations." : "Full motion active. Click to reduce animations."}
            aria-pressed={isReducedMotion}
            className="hidden rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:block"
            style={{ color: "var(--text-2)" }}
          >
            Motion: {isReducedMotion ? "reduced" : "full"}
          </button>

          <a
            href="https://github.com/Ry0x7/rolespec-os/releases/latest"
            target="_blank"
            rel="noreferrer"
            className="btn-primary !px-4 !py-1.5 !text-sm"
          >
            <DownloadIcon className="h-4 w-4" />
            Download
          </a>

          <button
            ref={triggerRef}
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="showcase-mobile-menu"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full md:hidden"
            style={{ color: "var(--text)" }}
          >
            {open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="showcase-mobile-menu" aria-label="Mobile" className="border-t md:hidden" style={{ borderColor: "var(--border-soft)", background: "var(--background)" }}>
          <ul className="mx-auto w-full max-w-5xl px-4 py-2 sm:px-6">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center text-base" style={{ color: "var(--text)" }}>{l.label}</a>
              </li>
            ))}
            <li>
              <button type="button" onClick={onToggleTheme} className="flex min-h-11 w-full items-center justify-between text-base" style={{ color: "var(--text)" }}>
                <span>Dark appearance</span>
                <span className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: "var(--surface)", color: "var(--text-2)" }}>{theme === "dark" ? "On" : "Off"}</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={onToggleMotion} className="flex min-h-11 w-full items-center justify-between text-base" style={{ color: "var(--text)" }}>
                <span>Reduce motion</span>
                <span className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: "var(--surface)", color: "var(--text-2)" }}>{isReducedMotion ? "On" : "Off"}</span>
              </button>
            </li>
          </ul>
        </nav>
      )}
    </header>
  )
}
