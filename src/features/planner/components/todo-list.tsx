"use client"

import { useMemo, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Link2, ListTodo } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/shared/ui/card"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Select } from "@/shared/ui/select"
import { Label } from "@/shared/ui/label"
import { Pagination } from "@/shared/ui/pagination"
import { SegmentedControl } from "@/shared/ui/segmented-control"
import { EmptyState } from "@/shared/components/empty-state"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import { formatCalendarDate } from "@/shared/lib/dates"
import { createTodo, updateTodo, deleteTodo } from "../actions/todo.actions"
import type { JobLinkOption, TodoRow } from "../types"

interface TodoListProps {
  todos: TodoRow[]
  jobOptions: JobLinkOption[]
  /** The user's calendar day (UTC midnight), resolved on the server page. */
  today: Date
}

/**
 * An active todo whose due date is strictly before the user's own calendar
 * day. Mirrors `daysUntilDeadline` in `job-application-card.tsx`: `dueDate` is
 * a calendar date (UTC midnight) and `today` is the user's day from the server
 * page, so a UTC server render and the reader's browser agree.
 */
function isTodoOverdue(todo: TodoRow, today: Date): boolean {
  if (todo.done || !todo.dueDate) return false
  return todo.dueDate.getTime() < today.getTime()
}

const TODOS_PAGE_SIZE = 10

type TodoFilter = "open" | "completed" | "all"

const EMPTY_FILTER_MESSAGE: Record<TodoFilter, string> = {
  open: "No open todos.",
  completed: "No completed todos.",
  all: "No todos.",
}

/**
 * A done toggle shown before the server round-trip finishes. `base` is the
 * server value it was made against: once the props carry a different value the
 * server has caught up, so the override stops applying on its own.
 */
interface DoneOverride {
  value: boolean
  base: boolean
}

export function TodoList({ todos, jobOptions, today }: TodoListProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, DoneOverride>>({})
  // Deleted rows are hidden at once; a refresh drops them from the props too.
  const [deletedIds, setDeletedIds] = useState<Record<string, true>>({})
  const [filter, setFilter] = useState<TodoFilter>("open")

  function clearOverride(id: string) {
    setOverrides((current) => {
      const rest = { ...current }
      delete rest[id]
      return rest
    })
  }

  async function handleAdd(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await createTodo(formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else {
      formRef.current?.reset()
      toast.success("Todo added")
      router.refresh()
    }
  }

  async function handleToggle(todo: TodoRow) {
    const next = !todo.done
    // Keyed to the props value, not the overridden one, so a server refresh
    // that already carries `next` supersedes the override.
    const base = todos.find((row) => row.id === todo.id)?.done ?? !next
    setOverrides((current) => ({ ...current, [todo.id]: { value: next, base } }))
    setPendingId(todo.id)
    const fd = new FormData()
    fd.set("done", String(next))
    const result = await updateTodo(todo.id, fd)
    setPendingId(null)
    if (result?.error) {
      clearOverride(todo.id)
      toast.error(result.error)
    } else {
      router.refresh()
    }
  }

  async function handleDelete(id: string) {
    setPendingId(id)
    const result = await deleteTodo(id)
    setPendingId(null)
    if (result?.error) {
      toast.error(result.error)
    } else {
      setDeletedIds((current) => ({ ...current, [id]: true }))
      toast.success("Todo deleted")
      router.refresh()
    }
  }

  const rows = useMemo(
    () =>
      todos
        .filter((t) => !deletedIds[t.id])
        .map((t) => {
          const override = overrides[t.id]
          return override && override.base === t.done ? { ...t, done: override.value } : t
        }),
    [todos, deletedIds, overrides]
  )
  const active = useMemo(() => rows.filter((t) => !t.done), [rows])
  const completed = useMemo(() => rows.filter((t) => t.done), [rows])
  const overdue = active.filter((t) => isTodoOverdue(t, today))
  const notOverdue = active.filter((t) => !isTodoOverdue(t, today))
  const counts: Record<TodoFilter, number> = {
    open: active.length,
    completed: completed.length,
    all: rows.length,
  }
  // Overdue is a subset of open and stays above the paged list in the Open and
  // All views, so only the rest of the selected view is paged.
  const showOverdue = filter !== "completed" && overdue.length > 0
  const pagedSource =
    filter === "open" ? notOverdue : filter === "completed" ? completed : [...notOverdue, ...completed]
  // Clamped, so completing the last row on the last page lands on the previous
  // page instead of an empty one; a filter change goes back to page 1.
  const paged = usePagedList(pagedSource, { pageSize: TODOS_PAGE_SIZE, resetKey: filter })

  return (
    <div className="space-y-6">
      {/* Add form */}
      <Card>
        <CardContent>
          <form ref={formRef} action={handleAdd} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="todo-title">New todo</Label>
              <Input
                id="todo-title"
                name="title"
                placeholder="e.g. Follow up with recruiter"
                required
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="todo-dueDate">Due date (optional)</Label>
                <Input
                  id="todo-dueDate"
                  name="dueDate"
                  type="date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="todo-job">Link a job (optional)</Label>
                <Select id="todo-job" name="jobApplicationId" defaultValue="">
                  <option value="">— none —</option>
                  {jobOptions.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.companyName} — {job.jobTitle}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={loading}>
                <Plus className="h-4 w-4" />
                {loading ? "Adding..." : "Add Todo"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      {rows.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No todos yet"
          description="Add your first task above to start tracking your job hunt."
        />
      ) : (
        <div className="space-y-6">
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            label="Filter todos"
            options={[
              { value: "open", label: "Open", count: counts.open },
              { value: "completed", label: "Completed", count: counts.completed },
              { value: "all", label: "All", count: counts.all },
            ]}
          />
          {showOverdue && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-error">Overdue</h3>
              <div className="space-y-2">
                {overdue.map((todo) => (
                  <TodoRowItem
                    key={todo.id}
                    todo={todo}
                    pending={pendingId === todo.id}
                    onToggle={() => handleToggle(todo)}
                    onDelete={() => handleDelete(todo.id)}
                  />
                ))}
              </div>
            </div>
          )}
          {paged.total > 0 ? (
            <div className="space-y-2">
              {paged.pageItems.map((todo) => (
                <TodoRowItem
                  key={todo.id}
                  todo={todo}
                  pending={pendingId === todo.id}
                  onToggle={() => handleToggle(todo)}
                  onDelete={() => handleDelete(todo.id)}
                />
              ))}
            </div>
          ) : (
            !showOverdue && (
              <p className="text-sm text-muted-foreground">{EMPTY_FILTER_MESSAGE[filter]}</p>
            )
          )}
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onPageChange={paged.setPage}
            label="Todos pages"
          />
        </div>
      )}
    </div>
  )
}

interface TodoRowItemProps {
  todo: TodoRow
  pending: boolean
  onToggle: () => void
  onDelete: () => void
}

function TodoRowItem({ todo, pending, onToggle, onDelete }: TodoRowItemProps) {
  return (
    <div className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <input
        type="checkbox"
        checked={todo.done}
        disabled={pending}
        onChange={onToggle}
        aria-label={todo.done ? `Mark ${todo.title} incomplete` : `Mark ${todo.title} complete`}
        className="mt-1 h-4 w-4 shrink-0 rounded border-border bg-muted accent-brand-600"
      />
      <div className="min-w-0 flex-1">
        <p className={todo.done ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>
          {todo.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {todo.dueDate && <span>Due {formatCalendarDate(todo.dueDate)}</span>}
          {todo.job && (
            <span className="inline-flex items-center gap-1">
              <Link2 className="h-3 w-3" />
              {todo.job.companyName} — {todo.job.jobTitle}
            </span>
          )}
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        aria-label={`Delete ${todo.title}`}
        disabled={pending}
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
