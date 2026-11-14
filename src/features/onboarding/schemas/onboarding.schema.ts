import { z } from "zod"

export const onboardingSchema = z.object({
  currentRole: z.string().min(2).max(100),
  targetRole: z.string().min(2).max(100),
  experienceLevel: z.enum(["JUNIOR", "MID", "SENIOR", "LEAD", "EXECUTIVE"]),
})

export type OnboardingInput = z.infer<typeof onboardingSchema>
