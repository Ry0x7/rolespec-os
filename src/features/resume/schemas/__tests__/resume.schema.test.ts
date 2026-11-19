import { describe, expect, it } from "vitest"
import {
  createJobTailoredResumeSchema,
  createResumeSchema,
  createRoleFamilyResumeSchema,
  updateResumeSchema,
} from "../resume.schema"

describe("resume.schema", () => {
  describe("createResumeSchema", () => {
    it("trims valid titles and defaults template to MINIMAL", () => {
      const parsed = createResumeSchema.parse({ title: "  Master Resume  " })
      expect(parsed.title).toBe("Master Resume")
      expect(parsed.template).toBe("MINIMAL")
    })

    it("rejects empty and whitespace-only titles", () => {
      expect(createResumeSchema.safeParse({ title: "" }).success).toBe(false)
      expect(createResumeSchema.safeParse({ title: "   " }).success).toBe(false)
      expect(createResumeSchema.safeParse({ title: "\t\n " }).success).toBe(false)
    })

    it("rejects titles longer than 100 characters", () => {
      expect(createResumeSchema.safeParse({ title: "a".repeat(101) }).success).toBe(false)
    })
  })

  describe("updateResumeSchema", () => {
    it("trims non-empty titles", () => {
      const parsed = updateResumeSchema.parse({ title: "  Updated Title  " })
      expect(parsed.title).toBe("Updated Title")
    })

    it("rejects whitespace-only titles when title is provided", () => {
      expect(updateResumeSchema.safeParse({ title: "   " }).success).toBe(false)
    })

    it("allows partial updates without title", () => {
      const parsed = updateResumeSchema.parse({ template: "MODERN", status: "ACTIVE" })
      expect(parsed).toEqual({ template: "MODERN", status: "ACTIVE" })
    })
  })

  describe("derived resume schemas", () => {
    it("trims and validates role-family resume input", () => {
      expect(
        createRoleFamilyResumeSchema.safeParse({
          title: "   ",
          sourceResumeId: "src-1",
          roleFamilyId: "rf-1",
        }).success
      ).toBe(false)

      const missingSource = createRoleFamilyResumeSchema.safeParse({
        title: "Role Family Resume",
        sourceResumeId: "",
        roleFamilyId: "rf-1",
      })
      expect(missingSource.success).toBe(false)
      if (!missingSource.success) {
        expect(missingSource.error.flatten().fieldErrors.sourceResumeId).toContain(
          "Select a source master resume"
        )
      }

      const missingFamily = createRoleFamilyResumeSchema.safeParse({
        title: "Role Family Resume",
        sourceResumeId: "src-1",
        roleFamilyId: "",
      })
      expect(missingFamily.success).toBe(false)
      if (!missingFamily.success) {
        expect(missingFamily.error.flatten().fieldErrors.roleFamilyId).toContain(
          "Select a role family"
        )
      }
    })

    it("trims and validates job-tailored resume input", () => {
      expect(
        createJobTailoredResumeSchema.safeParse({
          title: "   ",
          sourceResumeId: "src-1",
          jobApplicationId: "job-1",
        }).success
      ).toBe(false)

      const missingSource = createJobTailoredResumeSchema.safeParse({
        title: "Tailored Resume",
        sourceResumeId: "",
        jobApplicationId: "job-1",
      })
      expect(missingSource.success).toBe(false)
      if (!missingSource.success) {
        expect(missingSource.error.flatten().fieldErrors.sourceResumeId).toContain(
          "Select a source resume"
        )
      }

      const missingJob = createJobTailoredResumeSchema.safeParse({
        title: "Tailored Resume",
        sourceResumeId: "src-1",
        jobApplicationId: "",
      })
      expect(missingJob.success).toBe(false)
      if (!missingJob.success) {
        expect(missingJob.error.flatten().fieldErrors.jobApplicationId).toContain(
          "Select a job application"
        )
      }
    })
  })
})
