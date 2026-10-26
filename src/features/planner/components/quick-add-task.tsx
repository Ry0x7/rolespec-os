"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Select } from "@/shared/ui/select"
import { createTodo } from "../actions/todo.actions"
import type { JobLinkOption } from "../types"

/**
 * One-line task capture for the dashboard sidebar or planner header: title +
 * optional job link, due date left for the full Todos tab. Keeps the friction
 * of logging the next follow-up to a single Enter press.
 */
export function QuickAddTask({ jobOptions }: { jobOptions: JobLinkOption[] }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim()
    if (!title) {
      toast.error("Type the task first.")
      return
    }
    setLoading(true)
    const result = await createTodo(formData)
    setLoading(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      formRef.current?.reset()
      toast.success("Task added")
      router.refresh()
    }
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row"
      aria-label="Quick add task"
    >
      <Input
        name="title"
        placeholder="Add a task… e.g. Nudge Acme recruiter"
        aria-label="Task title"
        required
        maxLength={200}
        className="flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-1"
      />
      <div className="flex gap-2">
        <Select
          name="jobApplicationId"
          defaultValue=""
          aria-label="Link a job (optional)"
          className="w-40"
        >
          <option value="">No job</option>
          {jobOptions.map((job) => (
            <option key={job.id} value={job.id}>
              {job.companyName}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" disabled={loading}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {loading ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  )
}
