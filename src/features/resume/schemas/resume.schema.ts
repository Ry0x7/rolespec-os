import { z } from "zod"

export const createResumeSchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  targetRole: z.string().max(100).optional(),
  targetCompany: z.string().max(100).optional(),
  template: z
    .enum(["MINIMAL", "MODERN", "HARVARD", "CORPORATE", "EXECUTIVE", "CREATIVE", "TECH", "ELEGANT"])
    .default("MINIMAL"),
})

export const createRoleFamilyResumeSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  sourceResumeId: z.string().trim().min(1).max(64),
  roleFamilyId: z.string().trim().min(1).max(64),
})

export const createJobTailoredResumeSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  sourceResumeId: z.string().trim().min(1).max(64),
  jobApplicationId: z.string().trim().min(1).max(64),
})

export const updateResumeSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  targetRole: z.string().max(100).optional(),
  targetCompany: z.string().max(100).optional(),
  template: z
    .enum(["MINIMAL", "MODERN", "HARVARD", "CORPORATE", "EXECUTIVE", "CREATIVE", "TECH", "ELEGANT"])
    .optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
})

export type CreateResumeInput = z.infer<typeof createResumeSchema>
export type CreateRoleFamilyResumeInput = z.infer<typeof createRoleFamilyResumeSchema>
export type CreateJobTailoredResumeInput = z.infer<typeof createJobTailoredResumeSchema>
export type UpdateResumeInput = z.infer<typeof updateResumeSchema>
