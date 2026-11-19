import { z } from "zod"
import { parseCalendarDate } from "@/shared/lib/dates"

const optionalJobApplicationId = z
  .string()
  .cuid()
  .optional()
  .or(z.literal(""))

const optionalCalendarDate = z
  .string()
  .trim()
  .refine(
    (v) => v === "" || parseCalendarDate(v) !== null,
    "Enter a valid YYYY-MM-DD date"
  )
  .optional()

export const createTodoSchema = z.object({
  title: z
    .string("Title is required")
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or fewer"),
  dueDate: optionalCalendarDate,
  jobApplicationId: optionalJobApplicationId,
})

export const updateTodoSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or fewer")
    .optional(),
  done: z
    .preprocess(
      (v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : v),
      z.boolean()
    )
    .optional(),
  dueDate: optionalCalendarDate,
  jobApplicationId: optionalJobApplicationId,
})

export const createNoteSchema = z.object({
  content: z
    .string("Content is required")
    .trim()
    .min(1, "Content is required")
    .max(10000, "Note must be 10,000 characters or fewer"),
})

export const updateNoteSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .max(10000, "Note must be 10,000 characters or fewer")
    .optional(),
})

export type CreateTodoInput = z.infer<typeof createTodoSchema>
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>
export type CreateNoteInput = z.infer<typeof createNoteSchema>
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>
