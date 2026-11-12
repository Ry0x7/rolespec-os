"use client"

import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { cn } from "@/shared/lib/utils"

/** Keeps form drafts mounted while exposing one task at a time. Hash links reveal their panel. */
export function TaskTabs({ label, items, children }: {
  label: string
  items: { id: string; label: string }[]
  children: ReactNode
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const panels = Children.toArray(children)
  useEffect(() => {
    let frame = 0
    function reveal(targetId: string) {
      const target = document.getElementById(targetId)
      const index = items.findIndex((_, i) => {
        const panel = root.current?.querySelector(`:scope > [data-task-panel="${i}"]`)
        return panel?.contains(target) || items[i].id === targetId
      })
      if (index < 0) return false
      setActive(index)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (target?.isConnected) target.scrollIntoView?.({ block: "start" })
      })
      return true
    }
    function fragment(hash: string) {
      try { return decodeURIComponent(hash.slice(1)) } catch { return "" }
    }
    const onHash = () => reveal(fragment(window.location.hash))
    function onClick(event: MouseEvent) {
      if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const anchor = (event.target as Element).closest?.('a[href*="#"]')
      if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== location.origin || anchor.pathname !== location.pathname || anchor.search !== location.search) return
      if (reveal(fragment(anchor.hash))) {
        event.preventDefault()
        if (location.hash !== anchor.hash) history.pushState(null, "", anchor.hash)
      }
    }
    onHash()
    window.addEventListener("hashchange", onHash)
    window.addEventListener("popstate", onHash)
    document.addEventListener("click", onClick)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("hashchange", onHash)
      window.removeEventListener("popstate", onHash)
      document.removeEventListener("click", onClick)
    }
  }, [items])
  return <div ref={root} className="min-w-0 space-y-5">
    <div role="tablist" aria-label={label} className="flex max-w-full gap-1 overflow-x-auto border-b border-border pb-1">
      {items.map((item, index) => <button key={item.id} type="button" role="tab" id={`${id}-tab-${index}`} aria-selected={active === index} aria-controls={`${id}-panel-${index}`} tabIndex={active === index ? 0 : -1}
        className={cn("min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", active === index ? "border-brand-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        onClick={() => { setActive(index); history.pushState(null, "", `#${item.id}`) }}
        onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % items.length : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1
          if (next < 0) return
          event.preventDefault()
          setActive(next)
          history.pushState(null, "", `#${items[next].id}`)
          document.getElementById(`${id}-tab-${next}`)?.focus()
          document.getElementById(`${id}-tab-${next}`)?.scrollIntoView({ block: "nearest", inline: "nearest" })
        }}>{item.label}</button>)}
    </div>
    {panels.map((panel, index) => <div key={items[index].id} data-task-panel={index} id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} hidden={active !== index} tabIndex={0} className="min-w-0 space-y-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{panel}</div>)}
  </div>
}
