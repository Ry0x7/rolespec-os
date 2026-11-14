// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockRevalidate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    todo: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    jobApplication: { findUnique: vi.fn() },
  },
  mockRevalidate: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }))

import { createTodo, updateTodo, deleteTodo } from "../todo.actions"

const USER_ID = "user-1"
const JOB_ID = "cmtu9cdzu000c54dwggslf4su"
const OTHER_JOB_ID = "cmtu9cdzu000c54dwggslf4sv"

function formData(entries: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.set(key, value)
  return fd
}

/** Every path revalidated by the last action, in no particular order. */
function revalidated() {
  return mockRevalidate.mock.calls.map((call) => call[0])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: USER_ID } })
  mockPrisma.jobApplication.findUnique.mockImplementation(
    async ({ where }: { where: { id: string; userId: string } }) =>
      where.userId === USER_ID ? { id: where.id } : null,
  )
  mockPrisma.todo.create.mockResolvedValue({ id: "todo-1" })
  mockPrisma.todo.update.mockResolvedValue({})
  mockPrisma.todo.delete.mockResolvedValue({})
})

describe("createTodo", () => {
  it("refreshes the planner, the dashboard and the job it was added from", async () => {
    const result = await createTodo(
      formData({ title: "Email the recruiter", jobApplicationId: JOB_ID }),
    )

    expect(result).toEqual({ success: true, id: "todo-1" })
    expect(revalidated()).toEqual(
      expect.arrayContaining(["/planner", "/dashboard", `/jobs/${JOB_ID}`]),
    )
  })

  it("has no job page to refresh for a standalone todo", async () => {
    await createTodo(formData({ title: "Update the portfolio" }))

    expect(revalidated()).toEqual(["/planner", "/dashboard"])
  })
})

describe("updateTodo", () => {
  it("marks a todo done and refreshes the job it hangs off", async () => {
    mockPrisma.todo.findUnique.mockResolvedValue({
      id: "todo-1",
      jobApplicationId: JOB_ID,
    })

    const result = await updateTodo("todo-1", formData({ done: "true" }))

    expect(result).toEqual({ success: true })
    expect(mockPrisma.todo.update).toHaveBeenCalledWith({
      where: { id: "todo-1" },
      data: { done: true },
    })
    expect(revalidated()).toEqual(
      expect.arrayContaining(["/planner", "/dashboard", `/jobs/${JOB_ID}`]),
    )
  })

  it("refreshes both the old job page and the new one when a todo is re-linked", async () => {
    mockPrisma.todo.findUnique.mockResolvedValue({
      id: "todo-1",
      jobApplicationId: JOB_ID,
    })

    await updateTodo("todo-1", formData({ jobApplicationId: OTHER_JOB_ID }))

    expect(revalidated()).toEqual(
      expect.arrayContaining([`/jobs/${JOB_ID}`, `/jobs/${OTHER_JOB_ID}`]),
    )
  })

  it("refuses a todo that is not the caller's", async () => {
    mockPrisma.todo.findUnique.mockResolvedValue(null)

    expect(await updateTodo("todo-1", formData({ done: "true" }))).toEqual({
      error: "Not found",
    })
    expect(mockRevalidate).not.toHaveBeenCalled()
  })
})

describe("deleteTodo", () => {
  it("refreshes the planner, the dashboard and the linked job", async () => {
    mockPrisma.todo.findUnique.mockResolvedValue({
      id: "todo-1",
      jobApplicationId: JOB_ID,
    })

    expect(await deleteTodo("todo-1")).toEqual({ success: true })
    expect(mockPrisma.todo.delete).toHaveBeenCalledWith({ where: { id: "todo-1" } })
    expect(revalidated()).toEqual(
      expect.arrayContaining(["/planner", "/dashboard", `/jobs/${JOB_ID}`]),
    )
  })
})
