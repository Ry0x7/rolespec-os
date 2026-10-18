import { z } from "zod"

export const signUpSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(50),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100)
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[0-9]/, "Must contain a number"),
  // Optional here on purpose: whether a code is actually required is decided
  // server-side by `SIGNUP_INVITE_CODE`, not by the shape of the submission.
  inviteCode: z.string().max(200).optional(),
})

export const signInSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
})

export const onboardingSchema = z.object({
  currentRole: z.string().min(2).max(100),
  targetRole: z.string().min(2).max(100),
  experienceLevel: z.enum(["JUNIOR", "MID", "SENIOR", "LEAD", "EXECUTIVE"]),
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type SignInInput = z.infer<typeof signInSchema>
export type OnboardingInput = z.infer<typeof onboardingSchema>
