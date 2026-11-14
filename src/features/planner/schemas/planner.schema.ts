import { z } from "zod"

const optionalJobApplicationId = z
  .string()
  .cuid()
  .optional()
  .or(z.literal(""))

export const createTodoSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  dueDate: z.string().optional(),
  jobApplicationId: optionalJobApplicationId,
})

export const updateTodoSchema = z.object({
  title: z.string().min(1, "Title is required").max(200).optional(),
  done: z
    .preprocess(
      (v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : v),
      z.boolean()
    )
    .optional(),
  dueDate: z.string().optional(),
  jobApplicationId: optionalJobApplicationId,
})

export const createNoteSchema = z.object({
  content: z.string().min(1, "Content is required").max(10000),
})

export const updateNoteSchema = z.object({
  content: z.string().min(1, "Content is required").max(10000).optional(),
})

export type CreateTodoInput = z.infer<typeof createTodoSchema>
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>
export type CreateNoteInput = z.infer<typeof createNoteSchema>
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>
