import { z } from "zod"

export const onboardingSchema = z.object({
  currentRole: z
    .string()
    .trim()
    .min(2, "Current role must be at least 2 characters")
    .max(100, "Current role must be 100 characters or fewer"),
  targetRole: z
    .string()
    .trim()
    .min(2, "Target role must be at least 2 characters")
    .max(100, "Target role must be 100 characters or fewer"),
  experienceLevel: z.enum(["JUNIOR", "MID", "SENIOR", "LEAD", "EXECUTIVE"]),
})

export type OnboardingInput = z.infer<typeof onboardingSchema>
