"use client"

import { useRef, useState, type KeyboardEvent } from "react"
import { ListTodo, StickyNote, CalendarDays, Target } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { TodoList } from "./todo-list"
import { NotesList } from "./notes-list"
import { CalendarAgenda } from "./calendar-agenda"
import { GoalsTracker } from "./goals-tracker"
import type { AgendaItem } from "../services/calendar.service"
import type { JobLinkOption, NoteRow, TodoRow } from "../types"

type Tab = "todos" | "notes" | "calendar" | "goals"

const TABS: { id: Tab; label: string; icon: typeof ListTodo }[] = [
  { id: "todos", label: "Todos", icon: ListTodo },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "goals", label: "Goals", icon: Target },
]

interface PlannerTabsProps {
  todos: TodoRow[]
  notes: NoteRow[]
  agenda: AgendaItem[]
  jobOptions: JobLinkOption[]
  /** The user's calendar day, handed through to the todo list. */
  today: Date
}

/**
 * Todos is the default, except when there are none and the agenda has
 * something — landing on "No todos yet" while a follow-up is overdue one tab
 * over is the wrong first screen.
 */
export function resolveInitialTab(todoCount: number, agendaCount: number): Tab {
  return todoCount === 0 && agendaCount > 0 ? "calendar" : "todos"
}

export function PlannerTabs({ todos, notes, agenda, jobOptions, today }: PlannerTabsProps) {
  const [tab, setTab] = useState<Tab>(() =>
    resolveInitialTab(todos.length, agenda.length)
  )
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % TABS.length
        break
      case "ArrowLeft":
        next = (index - 1 + TABS.length) % TABS.length
        break
      case "Home":
        next = 0
        break
      case "End":
        next = TABS.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    setTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Planner sections"
        className="flex gap-1 rounded-lg border border-border bg-muted p-1"
      >
        {TABS.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            ref={(node) => {
              tabRefs.current[index] = node
            }}
            id={`planner-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`planner-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground active:bg-input"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`planner-panel-${tab}`}
        aria-labelledby={`planner-tab-${tab}`}
      >
        {tab === "todos" && <TodoList todos={todos} jobOptions={jobOptions} today={today} />}
        {tab === "notes" && <NotesList notes={notes} />}
        {tab === "calendar" && <CalendarAgenda items={agenda} />}
        {tab === "goals" && (
          <GoalsTracker
            jobOptions={jobOptions}
            openTodos={todos.filter((t) => !t.done).length}
            completedTodos={todos.filter((t) => t.done).length}
          />
        )}
      </div>
    </div>
  )
}
