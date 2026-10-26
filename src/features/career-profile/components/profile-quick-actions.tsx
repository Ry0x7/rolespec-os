"use client"

import { useEffect } from "react"
import { Briefcase, FileStack, Link2, Sparkles, Target, User } from "lucide-react"
import { Button } from "@/shared/ui/button"

const ACTIONS = [
  { key: "contact", label: "Contact", hint: "1", icon: User, target: "contact" },
  { key: "preferences", label: "Preferences", hint: "2", icon: Briefcase, target: "preferences" },
  { key: "target-roles", label: "Add role", hint: "T", icon: Target, target: "target-role-title" },
  { key: "evidence", label: "Add evidence", hint: "E", icon: FileStack, target: "evidence-title" },
  { key: "capability", label: "Add skill", hint: "C", icon: Sparkles, target: "capability-name" },
  { key: "link", label: "Link evidence", hint: "L", icon: Link2, target: "capabilities" },
] as const

function focusTarget(target: string) {
  // Prefer an input first (add forms), otherwise jump to the section.
  const el =
    document.getElementById(target) ??
    document.querySelector(`[id="${target}"]`) ??
    document.querySelector(`a[href="#${target}"]`)
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    // Inputs get focus; section anchors get a brief highlight.
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      window.setTimeout(() => el.focus({ preventScroll: true }), 250)
    }
  } else {
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth" })
  }
}

/**
 * One-press jump bar for the profile page. Every action is a single click
 * (or single key) that scrolls to and focuses the right field — no hunting
 * through six long sections. Keyboard: 1/2 jump, T/E/C/L focus add-forms.
 */
export function ProfileQuickActions() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const map: Record<string, string> = {
        "1": "contact",
        "2": "preferences",
        t: "target-role-title",
        e: "evidence-title",
        c: "capability-name",
        l: "capabilities",
      }
      const target = map[k]
      if (target) {
        e.preventDefault()
        focusTarget(target)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div
      aria-label="Profile quick actions"
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2"
    >
      <span className="px-1 text-xs text-muted-foreground">Jump to / add:</span>
      {ACTIONS.map((action) => (
        <Button
          key={action.key}
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => focusTarget(action.target)}
          title={`${action.label} (press ${action.hint.toUpperCase()})`}
          className="gap-1.5"
        >
          <action.icon className="h-3.5 w-3.5" aria-hidden="true" />
          {action.label}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            {action.hint.toUpperCase()}
          </kbd>
        </Button>
      ))}
    </div>
  )
}
