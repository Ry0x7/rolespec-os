import { z } from "zod"

import { parseCalendarDate } from "@/shared/lib/dates"

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .refine((value) => parseCalendarDate(value) !== null, "That date does not exist")

const contactSchema = z
  .object({
    name: z.string().min(1).max(200),
    role: z.string().max(200).optional(),
    company: z.string().max(200).optional(),
    email: z.string().email().max(320).optional(),
    linkedinUrl: z.string().url().max(1000).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()

export const createOutreachSequenceSchema = z
  .object({
    name: z.string().min(1).max(160),
    startOn: calendarDate.optional(),
    idempotencyKey: z.string().min(1).max(120).optional(),
    contactId: z.string().min(1).max(64).optional(),
    contact: contactSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.contactId || value.contact), {
    message: "Provide a contact or an existing contactId",
    path: ["contact"],
  })

export const outreachSequenceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACTIVATE") }).strict(),
  z.object({ action: z.literal("CANCEL") }).strict(),
])

export const outreachTouchActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("DONE") }).strict(),
  z.object({ action: z.literal("SKIPPED") }).strict(),
])
