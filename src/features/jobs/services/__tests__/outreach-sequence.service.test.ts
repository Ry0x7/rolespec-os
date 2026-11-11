// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const client = {
    outreachContact: { findFirst: vi.fn(), create: vi.fn() },
    outreachSequence: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
    },
    outreachTouch: {
      createMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  }
  return {
    ...client,
    transaction: vi.fn((arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)(client)
        : Promise.all(arg as Promise<unknown>[])
    ),
  }
})

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    outreachContact: mocks.outreachContact,
    outreachSequence: mocks.outreachSequence,
    outreachTouch: mocks.outreachTouch,
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import {
  OutreachSequenceError,
  activateOutreachSequence,
  cancelOutreachSequence,
  completeOutreachTouch,
  createOutreachSequence,
} from "../outreach-sequence.service"

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "seq-1",
    name: "Acme recruiter plan",
    status: "DRAFT",
    idempotencyKey: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-11-12T00:00:00.000Z"),
    updatedAt: new Date("2026-11-12T00:00:00.000Z"),
    contact: {
      id: "contact-1",
      name: "Maya Chen",
      role: "Recruiter",
      company: "Acme",
      email: "maya@acme.example",
      linkedinUrl: null,
      notes: null,
    },
    touches: [
      {
        id: "touch-1",
        order: 1,
        channel: "EMAIL",
        status: "PENDING",
        dueOn: new Date("2026-11-16T00:00:00.000Z"),
        note: "Introduction",
        completedAt: null,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.outreachSequence.findFirst.mockResolvedValue(null)
  mocks.outreachContact.findFirst.mockResolvedValue(null)
  mocks.outreachContact.create.mockResolvedValue({ id: "contact-1" })
  mocks.outreachSequence.create.mockResolvedValue({ id: "seq-1" })
  mocks.outreachSequence.findUniqueOrThrow.mockResolvedValue(row())
  mocks.outreachTouch.createMany.mockResolvedValue({ count: 3 })
})

describe("createOutreachSequence", () => {
  it("creates a contact plus three weekday-spaced manual touches", async () => {
    const sequence = await createOutreachSequence("user-1", {
      name: "Acme recruiter plan",
      startOn: new Date("2026-11-16T00:00:00.000Z"),
      contact: {
        name: "Maya Chen",
        role: "Recruiter",
        company: "Acme",
        email: "maya@acme.example",
      },
    })

    expect(sequence.id).toBe("seq-1")
    expect(mocks.outreachContact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        name: "Maya Chen",
        company: "Acme",
      }),
      select: { id: true },
    })
    expect(mocks.outreachSequence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        contactId: "contact-1",
        name: "Acme recruiter plan",
        idempotencyKey: null,
      }),
      select: { id: true },
    })

    const data = mocks.outreachTouch.createMany.mock.calls[0][0].data as Array<{
      order: number
      channel: string
      dueOn: Date
      note: string
    }>
    expect(data.map((touch) => touch.channel)).toEqual([
      "EMAIL",
      "EMAIL",
      "LINKEDIN",
    ])
    expect(data.map((touch) => touch.dueOn.toISOString().slice(0, 10))).toEqual([
      "2026-11-16",
      "2026-11-23",
      "2026-12-02",
    ])
    expect(data.every((touch) => touch.note.length > 0)).toBe(true)
  })

  it("returns an existing plan for a replayed idempotency key", async () => {
    mocks.outreachSequence.findFirst.mockResolvedValue(row({ id: "seq-existing" }))

    const sequence = await createOutreachSequence("user-1", {
      name: "Acme recruiter plan",
      idempotencyKey: "browser:acme:maya",
      contact: { name: "Maya Chen" },
    })

    expect(sequence.id).toBe("seq-existing")
    expect(mocks.outreachContact.create).not.toHaveBeenCalled()
    expect(mocks.outreachSequence.create).not.toHaveBeenCalled()
    expect(mocks.outreachTouch.createMany).not.toHaveBeenCalled()
  })

  it("refuses a contact id owned by another user", async () => {
    mocks.outreachContact.findFirst.mockResolvedValue(null)

    await expect(
      createOutreachSequence("user-1", {
        name: "Acme recruiter plan",
        contactId: "contact-other",
      })
    ).rejects.toBeInstanceOf(OutreachSequenceError)
    expect(mocks.outreachSequence.create).not.toHaveBeenCalled()
  })

  it("requires a contact or an owned contact id", async () => {
    await expect(
      createOutreachSequence("user-1", { name: "No contact" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(mocks.outreachSequence.create).not.toHaveBeenCalled()
  })
})

describe("activateOutreachSequence", () => {
  it("activates a draft plan", async () => {
    mocks.outreachSequence.findFirst.mockResolvedValue({ id: "seq-1", status: "DRAFT" })
    mocks.outreachSequence.update.mockResolvedValue(row({ status: "ACTIVE" }))

    const sequence = await activateOutreachSequence("user-1", "seq-1")

    expect(sequence.status).toBe("ACTIVE")
    expect(mocks.outreachSequence.update).toHaveBeenCalledWith({
      where: { id: "seq-1" },
      data: { status: "ACTIVE", startedAt: expect.any(Date) },
      select: expect.any(Object),
    })
  })

  it("refuses to reopen a terminal plan", async () => {
    mocks.outreachSequence.findFirst.mockResolvedValue({
      id: "seq-1",
      status: "COMPLETED",
    })

    await expect(activateOutreachSequence("user-1", "seq-1")).rejects.toMatchObject({
      code: "TERMINAL",
    })
    expect(mocks.outreachSequence.update).not.toHaveBeenCalled()
  })
})

describe("completeOutreachTouch", () => {
  it("records a manual touch and completes the plan when nothing is pending", async () => {
    mocks.outreachTouch.findFirst.mockResolvedValue({
      id: "touch-1",
      sequenceId: "seq-1",
      status: "PENDING",
      sequence: { status: "ACTIVE" },
    })
    mocks.outreachTouch.count.mockResolvedValue(0)
    mocks.outreachSequence.findUniqueOrThrow.mockResolvedValue(
      row({ status: "COMPLETED" })
    )

    const sequence = await completeOutreachTouch("user-1", "touch-1", "DONE")

    expect(sequence.status).toBe("COMPLETED")
    expect(mocks.outreachTouch.update).toHaveBeenCalledWith({
      where: { id: "touch-1" },
      data: { status: "DONE", completedAt: expect.any(Date) },
    })
    expect(mocks.outreachSequence.update).toHaveBeenCalledWith({
      where: { id: "seq-1" },
      data: { status: "COMPLETED", completedAt: expect.any(Date) },
    })
  })

  it("does not complete the plan while other touches remain", async () => {
    mocks.outreachTouch.findFirst.mockResolvedValue({
      id: "touch-1",
      sequenceId: "seq-1",
      status: "PENDING",
      sequence: { status: "ACTIVE" },
    })
    mocks.outreachTouch.count.mockResolvedValue(2)

    await completeOutreachTouch("user-1", "touch-1", "SKIPPED")

    expect(mocks.outreachSequence.update).not.toHaveBeenCalled()
  })
})

describe("cancelOutreachSequence", () => {
  it("cancels pending touches with the plan", async () => {
    mocks.outreachSequence.findFirst.mockResolvedValue({ id: "seq-1", status: "ACTIVE" })
    mocks.outreachSequence.findUniqueOrThrow.mockResolvedValue(
      row({ status: "CANCELLED" })
    )

    const sequence = await cancelOutreachSequence("user-1", "seq-1")

    expect(sequence.status).toBe("CANCELLED")
    expect(mocks.outreachTouch.updateMany).toHaveBeenCalledWith({
      where: { sequenceId: "seq-1", status: "PENDING" },
      data: { status: "CANCELLED", completedAt: expect.any(Date) },
    })
  })
})
