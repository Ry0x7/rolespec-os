import { z } from "zod"

export const followUpTaskStatusSchema = z.enum([
  "PENDING",
  "DONE",
  "DISMISSED",
  "CANCELLED",
])

export const closeFollowUpTaskSchema = z.object({
  action: z.enum(["DONE", "DISMISS"]),
})
