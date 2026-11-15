"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { updateTodo } from "../actions/todo.actions"

interface TodoDoneToggleProps {
  todoId: string
  title: string
  done: boolean
}

/**
 * Ticking a todo off from the agenda, which otherwise could only show that one
 * was due. Deliberately just the checkbox the todo list already uses — the rest
 * of editing a todo still belongs on the Todos tab.
 */
export function TodoDoneToggle({ todoId, title, done }: TodoDoneToggleProps) {
  const router = useRouter()
  const [isPending, startToggle] = useTransition()

  function handleChange() {
    startToggle(async () => {
      const formData = new FormData()
      formData.set("done", String(!done))
      const result = await updateTodo(todoId, formData)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <input
      type="checkbox"
      checked={done}
      disabled={isPending}
      onChange={handleChange}
      aria-label={done ? `Mark ${title} incomplete` : `Mark ${title} complete`}
      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-muted accent-brand-600"
    />
  )
}
