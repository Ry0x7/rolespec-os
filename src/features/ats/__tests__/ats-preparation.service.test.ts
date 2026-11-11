// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { resetAtsStore, store } from "./fake-ats-prisma"

vi.mock("@/shared/lib/prisma", async () => {
  const fake = await import("./fake-ats-prisma")
  return { prisma: fake.prisma }
})
vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  redactText: (value: string, max = 500) => value.slice(0, max),
}))

import {
  AtsError,
  approveAtsAnswer,
  attachAtsResume,
  confirmAtsSubmission,
  createAtsPreparation,
  revokeAtsAnswer,
} from "../services/ats-preparation.service"

const FIELD = {
  fieldId: "af-0",
  label: "Will you require visa sponsorship?",
  tagName: "input",
  type: "text",
  required: true,
}

beforeEach(() => {
  process.env.AUTH_SECRET = "ats-answer-test-secret"
  delete process.env.ENCRYPTION_KEY
  resetAtsStore()
  store.applications.push({
    id: "app-1",
    userId: "user-1",
    status: "INTERESTED",
    dateApplied: null,
    job: { title: "Nurse Manager", companyName: "Acme Health" },
  })
  store.resumes.push({
    id: "resume-1",
    userId: "user-1",
    status: "ACTIVE",
    title: "Marisol — Nurse Manager",
  })
})

describe("createAtsPreparation", () => {
  it("creates one preparation with provenance and a review task per blocked field", async () => {
    const result = await createAtsPreparation("user-1", {
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1?utm_source=x",
      vendor: "greenhouse",
      jobApplicationId: "app-1",
      resumeId: "resume-1",
      fields: [
        {
          fieldId: "af-0",
          label: "First name",
          tagName: "input",
          type: "text",
        },
        FIELD,
      ],
    })

    expect(result.created).toBe(true)
    expect(result.preparation).toMatchObject({
      vendor: "greenhouse",
      jobApplicationId: "app-1",
      resumeId: "resume-1",
      fieldsDetected: 2,
      status: "READY_FOR_REVIEW",
    })
    expect(result.preparation.plan?.fillCount).toBe(1)
    expect(result.preparation.openReviewTasks).toHaveLength(1)
    expect(result.preparation.openReviewTasks[0]).toMatchObject({
      kind: "SENSITIVE_ANSWER",
      question: "Will you require visa sponsorship?",
      category: "ats:sponsorship",
    })
  })

  it("is idempotent for the same form and does not duplicate open tasks", async () => {
    const input = {
      sourceUrl: "https://jobs.lever.co/acme/123",
      vendor: "lever",
      fields: [FIELD],
    }
    const first = await createAtsPreparation("user-1", input)
    const second = await createAtsPreparation("user-1", input)

    expect(second.created).toBe(false)
    expect(second.preparation.id).toBe(first.preparation.id)
    expect(store.preparations).toHaveLength(1)
    expect(store.tasks.filter((task) => task.status === "OPEN")).toHaveLength(1)
  })

  it("expires a review task when a rescan no longer contains that field", async () => {
    const input = {
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
      jobApplicationId: "app-1",
      fields: [
        FIELD,
        {
          fieldId: "af-essay",
          label: "Why do you want this role?",
          tagName: "textarea",
          type: "textarea",
        },
      ],
    }
    const created = await createAtsPreparation("user-1", input)
    expect(created.preparation.openReviewTasks).toHaveLength(2)

    await approveAtsAnswer("user-1", {
      preparationId: created.preparation.id,
      questionText: FIELD.label,
      value: "No",
      scope: "APPLICATION",
    })

    const rescanned = await createAtsPreparation("user-1", {
      ...input,
      fields: [FIELD],
    })

    expect(rescanned.preparation.openReviewTasks).toHaveLength(0)
    expect(rescanned.preparation.status).toBe("READY_TO_SUBMIT")
    expect(
      store.tasks.find(
        (task) => task.question === "Why do you want this role?"
      )?.status
    ).toBe("EXPIRED")
  })

  it("refuses another user's application or resume", async () => {
    await expect(
      createAtsPreparation("user-2", {
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
        jobApplicationId: "app-1",
        fields: [FIELD],
      })
    ).rejects.toBeInstanceOf(AtsError)

    await expect(
      createAtsPreparation("user-1", {
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/2",
        resumeId: "resume-for-someone-else",
        fields: [FIELD],
      })
    ).rejects.toMatchObject({ code: "RESUME_NOT_FOUND" })
  })
})

describe("approved answers", () => {
  it("approves an application answer, resolves the task and reuses it in the plan", async () => {
    const created = await createAtsPreparation("user-1", {
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
      jobApplicationId: "app-1",
      fields: [FIELD],
    })
    const result = await approveAtsAnswer("user-1", {
      preparationId: created.preparation.id,
      questionText: FIELD.label,
      value: "No",
      scope: "APPLICATION",
    })

    expect(result.answer).toMatchObject({
      scope: "APPLICATION",
      value: "No",
      source: "USER_APPROVED",
    })
    const stored = store.answers[0]!
    expect(typeof stored.value).toBe("string")
    expect(stored.value as string).toMatch(/^enc\.v1\./)
    expect(stored.value as string).not.toContain('"No"')
    const resolvedTask = store.tasks.find((task) => task.status === "RESOLVED")!
    expect(resolvedTask.answer as string).toMatch(/^enc\.v1\./)
    expect(result.resolvedTaskIds).toHaveLength(1)
    expect(result.preparation?.openReviewTasks).toHaveLength(0)
    expect(result.preparation?.status).toBe("READY_TO_SUBMIT")
  })

  it("refuses a different value until replacement is explicit", async () => {
    const created = await createAtsPreparation("user-1", {
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
      jobApplicationId: "app-1",
      fields: [FIELD],
    })
    await approveAtsAnswer("user-1", {
      preparationId: created.preparation.id,
      questionText: FIELD.label,
      value: "No",
    })

    await expect(
      approveAtsAnswer("user-1", {
        preparationId: created.preparation.id,
        questionText: FIELD.label,
        value: "Yes",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })

    expect(
      store.tasks.filter(
        (task) => task.kind === "CONFLICTING_ANSWER" && task.status === "OPEN"
      )
    ).toHaveLength(1)

    const replaced = await approveAtsAnswer("user-1", {
      preparationId: created.preparation.id,
      questionText: FIELD.label,
      value: "Yes",
      replace: true,
    })
    expect(replaced.answer.value).toBe("Yes")
    expect(
      store.tasks.filter(
        (task) => task.kind === "CONFLICTING_ANSWER" && task.status === "OPEN"
      )
    ).toHaveLength(0)
  })

  it("refuses a question that was not detected on this application", async () => {
    const created = await createAtsPreparation("user-1", {
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
      fields: [FIELD],
    })
    await expect(
      approveAtsAnswer("user-1", {
        preparationId: created.preparation.id,
        questionText: "What is your desired salary?",
        value: "100000",
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })

  it("does not let another owner revoke an answer", async () => {
    const created = await createAtsPreparation("user-1", {
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
      fields: [FIELD],
    })
    const approved = await approveAtsAnswer("user-1", {
      preparationId: created.preparation.id,
      questionText: FIELD.label,
      value: "No",
    })
    await expect(revokeAtsAnswer("user-2", approved.answer.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })
})

describe("resume attachment and submission confirmation", () => {
  it("rejects a resume the owner does not have", async () => {
    const created = await createAtsPreparation("user-1", {
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
      fields: [{ fieldId: "af-file", label: "Resume", type: "file", tagName: "input" }],
    })
    await expect(
      attachAtsResume("user-1", created.preparation.id, "foreign-resume")
    ).rejects.toMatchObject({ code: "RESUME_NOT_FOUND" })
  })

  it("moves the tracker only when the user confirms submission", async () => {
    const created = await createAtsPreparation("user-1", {
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
      jobApplicationId: "app-1",
      fields: [FIELD],
    })
    const notSubmitted = await confirmAtsSubmission("user-1", created.preparation.id, {
      submitted: false,
    })
    expect(notSubmitted.applicationStatus).toBeNull()
    expect(store.applications[0].status).toBe("INTERESTED")
    expect(store.statusEvents).toHaveLength(0)

    const submitted = await confirmAtsSubmission("user-1", created.preparation.id, {
      submitted: true,
      note: "confirmation page",
    })
    expect(submitted.applicationStatus).toBe("APPLIED")
    expect(store.applications[0].status).toBe("APPLIED")
    expect(store.statusEvents).toHaveLength(1)
    expect(store.statusEvents[0]).toMatchObject({
      jobApplicationId: "app-1",
      fromStatus: "INTERESTED",
      toStatus: "APPLIED",
      source: "EXTENSION",
    })

    // A submission confirmation is one-way. A later "not submitted" click must
    // not erase it or leave the tracker on APPLIED with no explanation.
    await expect(
      confirmAtsSubmission("user-1", created.preparation.id, { submitted: false })
    ).rejects.toMatchObject({ code: "TERMINAL" })
    expect(store.applications[0].status).toBe("APPLIED")
    expect(store.statusEvents).toHaveLength(1)
  })
})
