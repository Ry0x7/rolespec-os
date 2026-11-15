import { Prisma } from "@/generated/prisma/client"
import type {
  FollowUpChannel,
  OutreachSequenceStatus,
  OutreachTouchStatus,
} from "@/generated/prisma/enums"
import { addBusinessDays, toCalendarDateString } from "@/shared/lib/dates"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

const log = logger("jobs/outreach-sequence")

/**
 * A named recruiter-outreach plan. Every touch is a reminder for the user to
 * send it themselves; there is no outbound transport in this module.
 */
export const OUTREACH_PLAN: ReadonlyArray<{
  channel: FollowUpChannel
  businessDays: number
  note: string
}> = [
  {
    channel: "EMAIL",
    businessDays: 0,
    note: "Send a short introduction that names the role and one specific reason for reaching out.",
  },
  {
    channel: "EMAIL",
    businessDays: 5,
    note: "Follow up in the same thread if there has been no reply.",
  },
  {
    channel: "LINKEDIN",
    businessDays: 12,
    note: "Send a brief LinkedIn check-in if the email thread is still quiet.",
  },
]

export class OutreachSequenceError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "CONFLICT" | "TERMINAL" | "INVALID_INPUT"
  ) {
    super(message)
    this.name = "OutreachSequenceError"
  }
}

const SEQUENCE_SELECT = {
  id: true,
  name: true,
  status: true,
  idempotencyKey: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  contact: {
    select: {
      id: true,
      name: true,
      role: true,
      company: true,
      email: true,
      linkedinUrl: true,
      notes: true,
    },
  },
  touches: {
    select: {
      id: true,
      order: true,
      channel: true,
      status: true,
      dueOn: true,
      note: true,
      completedAt: true,
    },
    orderBy: { order: "asc" },
  },
} as const

type SequenceRow = {
  id: string
  name: string
  status: OutreachSequenceStatus
  idempotencyKey: string | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
  contact: {
    id: string
    name: string
    role: string | null
    company: string | null
    email: string | null
    linkedinUrl: string | null
    notes: string | null
  }
  touches: Array<{
    id: string
    order: number
    channel: FollowUpChannel
    status: OutreachTouchStatus
    dueOn: Date
    note: string | null
    completedAt: Date | null
  }>
}

export interface OutreachSequenceView {
  id: string
  name: string
  status: OutreachSequenceStatus
  idempotencyKey: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  contact: SequenceRow["contact"]
  touches: Array<{
    id: string
    order: number
    channel: FollowUpChannel
    status: OutreachTouchStatus
    dueOn: string
    note: string | null
    completedAt: string | null
    sent: false
  }>
}

function toView(row: SequenceRow): OutreachSequenceView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contact: row.contact,
    touches: row.touches.map((touch) => ({
      id: touch.id,
      order: touch.order,
      channel: touch.channel,
      status: touch.status,
      dueOn: toCalendarDateString(touch.dueOn),
      note: touch.note,
      completedAt: touch.completedAt?.toISOString() ?? null,
      // Kept explicit for any client: this module never sends anything.
      sent: false,
    })),
  }
}

function startOfDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  )
}

export interface CreateOutreachSequenceInput {
  name: string
  startOn?: Date
  idempotencyKey?: string | null
  contactId?: string
  contact?: {
    name: string
    role?: string | null
    company?: string | null
    email?: string | null
    linkedinUrl?: string | null
    notes?: string | null
  }
}

/**
 * Creates one contact (or reuses an owned one) and the scheduled touches in one
 * transaction. A replayed idempotency key returns the existing plan untouched.
 */
export async function createOutreachSequence(
  userId: string,
  input: CreateOutreachSequenceInput
): Promise<OutreachSequenceView> {
  const name = input.name.trim().slice(0, 160)
  if (!name) throw new OutreachSequenceError("Sequence name is required.", "INVALID_INPUT")
  const idempotencyKey = input.idempotencyKey?.trim() || null

  if (idempotencyKey) {
    const existing = await prisma.outreachSequence.findFirst({
      where: { userId, idempotencyKey },
      select: SEQUENCE_SELECT,
    })
    if (existing) return toView(existing)
  }

  if (!input.contactId && !input.contact?.name?.trim()) {
    throw new OutreachSequenceError("Contact name is required.", "INVALID_INPUT")
  }

  if (input.contactId) {
    const contact = await prisma.outreachContact.findFirst({
      where: { id: input.contactId, userId },
      select: { id: true },
    })
    if (!contact) throw new OutreachSequenceError("Contact not found.", "NOT_FOUND")
  }

  const startOn = startOfDay(input.startOn ?? new Date())

  try {
    const row = await prisma.$transaction(async (tx) => {
      let contactId = input.contactId
      if (!contactId && input.contact) {
        const contact = await tx.outreachContact.create({
          data: {
            userId,
            name: input.contact.name.trim().slice(0, 200),
            role: input.contact.role?.trim().slice(0, 200) || null,
            company: input.contact.company?.trim().slice(0, 200) || null,
            email: input.contact.email?.trim().slice(0, 320) || null,
            linkedinUrl: input.contact.linkedinUrl?.trim().slice(0, 1000) || null,
            notes: input.contact.notes?.slice(0, 2000) || null,
          },
          select: { id: true },
        })
        contactId = contact.id
      }

      const sequence = await tx.outreachSequence.create({
        data: {
          userId,
          contactId: contactId!,
          name,
          idempotencyKey,
        },
        select: { id: true },
      })

      await tx.outreachTouch.createMany({
        data: OUTREACH_PLAN.map((plan, index) => ({
          sequenceId: sequence.id,
          order: index + 1,
          channel: plan.channel,
          dueOn: addBusinessDays(startOn, plan.businessDays),
          note: plan.note,
        })),
      })

      return tx.outreachSequence.findUniqueOrThrow({
        where: { id: sequence.id },
        select: SEQUENCE_SELECT,
      })
    })

    log.info("Outreach sequence created", {
      userId,
      sequenceId: row.id,
      touches: row.touches.length,
    })
    return toView(row)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      if (idempotencyKey) {
        const existing = await prisma.outreachSequence.findFirst({
          where: { userId, idempotencyKey },
          select: SEQUENCE_SELECT,
        })
        if (existing) return toView(existing)
      }
    }
    throw error
  }
}

export async function listOutreachSequences(
  userId: string,
  options: { status?: OutreachSequenceStatus; limit?: number } = {}
): Promise<OutreachSequenceView[]> {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 30)))
  const rows = await prisma.outreachSequence.findMany({
    where: {
      userId,
      ...(options.status ? { status: options.status } : {}),
    },
    select: SEQUENCE_SELECT,
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  return rows.map(toView)
}

export async function getOutreachSequence(
  userId: string,
  id: string
): Promise<OutreachSequenceView | null> {
  const row = await prisma.outreachSequence.findFirst({
    where: { id, userId },
    select: SEQUENCE_SELECT,
  })
  return row ? toView(row) : null
}

export async function activateOutreachSequence(
  userId: string,
  id: string
): Promise<OutreachSequenceView> {
  const existing = await prisma.outreachSequence.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  })
  if (!existing) throw new OutreachSequenceError("Sequence not found.", "NOT_FOUND")
  if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
    throw new OutreachSequenceError(
      "That outreach sequence is already closed.",
      "TERMINAL"
    )
  }
  const row = await prisma.outreachSequence.update({
    where: { id },
    data: { status: "ACTIVE", startedAt: new Date() },
    select: SEQUENCE_SELECT,
  })
  return toView(row)
}

export async function completeOutreachTouch(
  userId: string,
  touchId: string,
  status: "DONE" | "SKIPPED"
): Promise<OutreachSequenceView> {
  const touch = await prisma.outreachTouch.findFirst({
    where: { id: touchId, sequence: { userId } },
    select: {
      id: true,
      sequenceId: true,
      status: true,
      sequence: { select: { status: true } },
    },
  })
  if (!touch) throw new OutreachSequenceError("Touch not found.", "NOT_FOUND")
  if (touch.sequence.status === "CANCELLED" || touch.sequence.status === "COMPLETED") {
    throw new OutreachSequenceError("That outreach sequence is closed.", "TERMINAL")
  }
  if (touch.status === "CANCELLED") {
    throw new OutreachSequenceError("That touch was cancelled.", "TERMINAL")
  }

  const row = await prisma.$transaction(async (tx) => {
    await tx.outreachTouch.update({
      where: { id: touch.id },
      data: { status, completedAt: new Date() },
    })
    const remaining = await tx.outreachTouch.count({
      where: {
        sequenceId: touch.sequenceId,
        status: "PENDING",
      },
    })
    if (remaining === 0) {
      await tx.outreachSequence.update({
        where: { id: touch.sequenceId },
        data: { status: "COMPLETED", completedAt: new Date() },
      })
    }
    return tx.outreachSequence.findUniqueOrThrow({
      where: { id: touch.sequenceId },
      select: SEQUENCE_SELECT,
    })
  })
  return toView(row)
}

export async function cancelOutreachSequence(
  userId: string,
  id: string
): Promise<OutreachSequenceView> {
  const existing = await prisma.outreachSequence.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  })
  if (!existing) throw new OutreachSequenceError("Sequence not found.", "NOT_FOUND")
  if (existing.status === "CANCELLED") {
    const row = await getOutreachSequence(userId, id)
    if (row) return row
  }
  if (existing.status === "COMPLETED") {
    throw new OutreachSequenceError("That outreach sequence is complete.", "TERMINAL")
  }

  const row = await prisma.$transaction(async (tx) => {
    await tx.outreachSequence.update({
      where: { id },
      data: { status: "CANCELLED", completedAt: new Date() },
    })
    await tx.outreachTouch.updateMany({
      where: { sequenceId: id, status: "PENDING" },
      data: { status: "CANCELLED", completedAt: new Date() },
    })
    return tx.outreachSequence.findUniqueOrThrow({
      where: { id },
      select: SEQUENCE_SELECT,
    })
  })
  return toView(row)
}
