import { z } from "zod"

/**
 * One client-lead search. Either a catalogue service id or a service the user
 * typed; a location is only meaningful for on-site work and is capped like any
 * other short field.
 */
export const clientLeadSearchSchema = z
  .object({
    serviceId: z.string().trim().min(1).max(60),
    customService: z.string().trim().max(80).optional(),
    arrangement: z.enum(["REMOTE", "ONSITE", "ANY"]).default("REMOTE"),
    location: z.string().trim().max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.serviceId === "custom" && !value.customService) {
      ctx.addIssue({ code: "custom", message: "Describe the service you offer.", path: ["customService"] })
    }
  })

export type ClientLeadSearchInput = z.input<typeof clientLeadSearchSchema>
