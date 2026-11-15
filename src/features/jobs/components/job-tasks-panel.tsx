"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { formatCalendarDate, localCalendarDateString } from "@/shared/lib/dates"
import {
  createTodo,
  deleteTodo,
  updateTodo,
} from "@/features/planner/actions/todo.actions"

export interface JobTask {
  id: string
  title: string
  done: boolean
  /** Calendar date as `YYYY-MM-DD`, or null. Serialized for the client boundary. */
  dueDate: string | null
}

interface JobTasksPanelProps {
  jobApplicationId: string
  todos: JobTask[]
}

/**
 * This application's tasks, on the job itself.
 *
 * The same `Todo` rows the planner lists, only with the job already decided —
 * the planner's add form re-asks "which job?" from a long select, which is the
 * reason a task never got written down while looking at the job it belongs to.
 *
 * Every write goes through the planner's own server actions, which revalidate
 * the planner, this page and the dashboard.
 */
export function JobTasksPanel({ jobApplicationId, todos }: JobTasksPanelProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [adding, setAdding] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function handleAdd(formData: FormData) {
    // The job is not a choice here — it is the page the user is on.
    formData.set("jobApplicationId", jobApplicationId)
    setAdding(true)
    const result = await createTodo(formData)
    setAdding(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    formRef.current?.reset()
    toast.success("Task added")
    router.refresh()
  }

  async function handleToggle(task: JobTask) {
    setPendingId(task.id)
    const formData = new FormData()
    formData.set("done", String(!task.done))
    const result = await updateTodo(task.id, formData)
    setPendingId(null)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    router.refresh()
  }

  async function handleDelete(task: JobTask) {
    setPendingId(task.id)
    const result = await deleteTodo(task.id)
    setPendingId(null)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    toast.success("Task deleted")
    router.refresh()
  }

  // `dueDate` is a calendar date, so "past" is decided on the reader's own
  // calendar — the same framing `isTodoOverdue` uses in the planner list.
  const today = localCalendarDateString()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {todos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet</p>
        ) : (
          <ul className="space-y-2">
            {todos.map((task) => {
              const overdue = !task.done && task.dueDate !== null && task.dueDate < today
              return (
                <li
                  key={task.id}
                  className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <input
                    type="checkbox"
                    checked={task.done}
                    disabled={pendingId === task.id}
                    onChange={() => handleToggle(task)}
                    aria-label={
                      task.done
                        ? `Mark ${task.title} incomplete`
                        : `Mark ${task.title} complete`
                    }
                    className="mt-1 h-4 w-4 shrink-0 rounded border-border bg-muted accent-brand-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        task.done
                          ? "text-sm text-muted-foreground line-through"
                          : "text-sm font-medium"
                      }
                    >
                      {task.title}
                    </p>
                    {task.dueDate && (
                      <p
                        className={`mt-1 text-xs ${overdue ? "text-error" : "text-muted-foreground"}`}
                      >
                        Due {formatCalendarDate(task.dueDate)}
                        {overdue ? " — overdue" : ""}
                      </p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                    aria-label={`Delete ${task.title}`}
                    disabled={pendingId === task.id}
                    onClick={() => handleDelete(task)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <form
          ref={formRef}
          action={handleAdd}
          className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="job-task-title">New task</Label>
            <Input
              id="job-task-title"
              name="title"
              placeholder="e.g. Email the recruiter"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-task-dueDate">Due date (optional)</Label>
            <Input id="job-task-dueDate" name="dueDate" type="date" />
          </div>
          <Button type="submit" disabled={adding}>
            <Plus className="h-4 w-4" />
            {adding ? "Adding..." : "Add"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
