"use client"

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowRight,
  Clock3,
  CornerDownLeft,
  FileText,
  Search,
  Sparkles,
  Zap,
} from "lucide-react"
import { navigationGroups, QUICK_ACTIONS, GLOBAL_SHORTCUTS } from "@/config/navigation"
import { getStoredRecentItems, storeRecentItem } from "@/shared/hooks/use-recent-items"
import { cn } from "@/shared/lib/utils"

interface PaletteEntry {
  label: string
  hint?: string
  href: string
  keywords: string
  kind: "go" | "action" | "recent"
}

function allEntries(): PaletteEntry[] {
  const nav: PaletteEntry[] = navigationGroups.flatMap((group) =>
    group.items.map((item) => ({
      label: item.label,
      hint: group.label ?? "Go to",
      href: item.href,
      keywords: `${item.label} ${group.label ?? ""} go`,
      kind: "go" as const,
    }))
  )
  const actions: PaletteEntry[] = QUICK_ACTIONS.map((action) => ({
    label: action.label,
    hint: action.hint,
    href: action.href,
    keywords: action.keywords,
    kind: "action" as const,
  }))
  return [...actions, ...nav]
}

/**
 * Global Cmd+K palette plus single-key navigation. Mount once in the app
 * layout: Ctrl/⌘+K opens, `?` opens the shortcut help, `g` followed by a
 * letter jumps to a section. Recent destinations persist per device.
 */
export const CommandPalette = memo(function CommandPalette({ onNavigate, openToken = 0 }: { onNavigate?: (href: string) => void; openToken?: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [recent, setRecent] = useState(() => getStoredRecentItems())
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingG = useRef(false)
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastToken = useRef(openToken)

  useEffect(() => {
    if (openToken !== lastToken.current) {
      lastToken.current = openToken
      if (openToken > 0) {
        setHelpOpen(false)
        setOpen(true)
      }
    }
  }, [openToken])

  const entries = useMemo(() => allEntries(), [])
  // Defer the filter so fast typing never blocks the input on large nav lists.
  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    if (!q) {
      const recents: PaletteEntry[] = recent
        .filter((item) => item.href !== pathname)
        .slice(0, 4)
        .map((item) => ({
          label: item.label,
          hint: "Recent",
          href: item.href,
          keywords: "",
          kind: "recent" as const,
        }))
      return [...recents, ...entries].filter(
        (entry, index, list) => list.findIndex((other) => other.href + other.label === entry.href + entry.label) === index
      )
    }
    return entries.filter((entry) =>
      `${entry.label} ${entry.hint ?? ""} ${entry.keywords}`.toLowerCase().includes(q)
    )
  }, [entries, deferredQuery, recent, pathname])

  const close = useCallback(() => {
    setOpen(false)
    setHelpOpen(false)
    setQuery("")
    setActiveIndex(0)
  }, [])

  const go = useCallback(
    (entry: PaletteEntry) => {
      storeRecentItem(entry.href, entry.label)
      setRecent(getStoredRecentItems())
      close()
      onNavigate?.(entry.href)
      if (entry.href !== pathname) router.push(entry.href)
    },
    [close, onNavigate, pathname, router]
  )

  // Record visits so recents stay fresh even when navigating via sidebar.
  useEffect(() => {
    const match = entries.find((entry) => entry.href === pathname)
    if (match) {
      storeRecentItem(match.href, match.label)
      setRecent(getStoredRecentItems())
    }
  }, [pathname, entries])

  useEffect(() => {
    if (open) {
      setActiveIndex(0)
      // Focus on the next frame only when opening — not on every keystroke —
      // so typing never triggers extra layout work.
      const frame = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(frame)
    }
  }, [open])

  useEffect(() => {
    function armG() {
      pendingG.current = true
      if (gTimer.current) clearTimeout(gTimer.current)
      gTimer.current = setTimeout(() => {
        pendingG.current = false
      }, 800)
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((prev) => !prev)
        setHelpOpen(false)
        return
      }

      if (open) {
        if (event.key === "Escape") {
          event.preventDefault()
          close()
        } else if (event.key === "ArrowDown") {
          event.preventDefault()
          setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
        } else if (event.key === "ArrowUp") {
          event.preventDefault()
          setActiveIndex((i) => Math.max(i - 1, 0))
        } else if (event.key === "Enter") {
          const entry = filtered[activeIndex]
          if (entry) {
            event.preventDefault()
            go(entry)
          }
        }
        return
      }

      if (typing || helpOpen) {
        if (event.key === "Escape") close()
        return
      }

      if (pendingG.current) {
        const key = event.key.toLowerCase()
        const jumps: Record<string, string> = {
          d: "/dashboard",
          r: "/career-profile",
          j: "/jobs",
          w: "/workspace",
          p: "/planner",
          s: "/settings",
        }
        const href = jumps[key]
        pendingG.current = false
        if (gTimer.current) clearTimeout(gTimer.current)
        if (href) {
          event.preventDefault()
          storeRecentItem(href, href)
          router.push(href)
        }
        return
      }

      if (event.key === "g" || event.key === "G") {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) armG()
      } else if (event.key === "?") {
        setHelpOpen(true)
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      if (gTimer.current) clearTimeout(gTimer.current)
    }
  }, [open, helpOpen, filtered, activeIndex, close, go, router])

  if (!open && !helpOpen) return null

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex items-start justify-center p-4 pt-[12vh]"
      role="presentation"
    >
      <div className="absolute inset-0 bg-black/70" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={helpOpen ? "Keyboard shortcuts" : "Quick actions"}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl"
      >
        {helpOpen ? (
          <div className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
              <button
                type="button"
                onClick={close}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Close (Esc)
              </button>
            </div>
            <ul className="mt-3 space-y-1.5">
              {GLOBAL_SHORTCUTS.map((shortcut) => (
                <li key={shortcut.keys} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{shortcut.description}</span>
                  <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {shortcut.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Go to, create, or tailor… (Esc to close)"
                aria-label="Search quick actions"
                className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:block">
                ⌘K
              </kbd>
            </div>
            <ul role="listbox" aria-label="Quick actions" className="max-h-[50dvh] overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No matches. Try “resume”, “job”, or “workspace”.
                </li>
              ) : (
                filtered.slice(0, 12).map((entry, index) => (
                  <li key={`${entry.kind}-${entry.href}-${entry.label}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => go(entry)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        index === activeIndex ? "bg-muted text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {entry.kind === "recent" ? (
                        <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : entry.kind === "action" ? (
                        <Zap className="h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
                      ) : (
                        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{entry.label}</span>
                        {entry.hint ? (
                          <span className="block truncate text-xs text-muted-foreground">{entry.hint}</span>
                        ) : null}
                      </span>
                      {entry.kind === "action" ? (
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 opacity-0" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" aria-hidden="true" />
                {filtered.length} result{filtered.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="rounded px-1.5 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Press ? for all shortcuts
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
})
