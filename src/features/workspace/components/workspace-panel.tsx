"use client"

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ChevronDown, GripVertical, Maximize2, Minimize2 } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import type { PanelId, PanelSize } from "../constants/panels"

interface WorkspacePanelProps {
  id: PanelId
  title: string
  collapsed: boolean
  size: PanelSize
  onToggleCollapse: () => void
  onToggleSize: () => void
  children: React.ReactNode
}

export function WorkspacePanel({
  id,
  title,
  collapsed,
  size,
  onToggleCollapse,
  onToggleSize,
  children,
}: WorkspacePanelProps) {
  const shouldReduceMotion = useReducedMotion()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: shouldReduceMotion ? undefined : transition,
      }}
      className={cn(
        "glass rounded-lg border border-border",
        size === "full" && "lg:col-span-2",
        isDragging && "z-10 opacity-60",
      )}
    >
      <div className="flex w-full items-center gap-2 px-4 py-2.5">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none rounded p-2 hover:bg-muted active:cursor-grabbing sm:p-1"
          aria-label={`Drag to reorder ${title} panel`}
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <span className="flex-1 font-semibold text-sm">{title}</span>
        <button
          onClick={onToggleSize}
          aria-label={
            size === "full"
              ? `Shrink ${title} panel to half width`
              : `Expand ${title} panel to full width`
          }
          title={size === "full" ? "Half width" : "Full width"}
          className="rounded p-2 hover:bg-muted sm:p-1"
        >
          {size === "full" ? (
            <Minimize2 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title} panel` : `Collapse ${title} panel`}
          className="rounded p-2 hover:bg-muted sm:p-1"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              collapsed && "-rotate-90",
            )}
          />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="panel-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
