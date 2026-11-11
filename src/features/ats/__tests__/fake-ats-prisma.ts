/** In-memory Prisma slice used by the ATS preparation service tests. */

export type Row = Record<string, unknown>

export const store = {
  preparations: [] as Row[],
  answers: [] as Row[],
  tasks: [] as Row[],
  applications: [] as Row[],
  resumes: [] as Row[],
  statusEvents: [] as Row[],
  submissionAttempts: [] as Row[],
}

let nextId = 1
export function resetAtsStore(): void {
  store.preparations.length = 0
  store.answers.length = 0
  store.tasks.length = 0
  store.applications.length = 0
  store.resumes.length = 0
  store.statusEvents.length = 0
  store.submissionAttempts.length = 0
  nextId = 1
}

function id(prefix: string): string {
  return `${prefix}-${nextId++}`
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue
    if (key === "OR") {
      const clauses = expected as Row[]
      if (!clauses.some((clause) => matches(row, clause))) return false
      continue
    }
    if (key === "status" && expected && typeof expected === "object" && "in" in expected) {
      if (!(expected as { in: unknown[] }).in.includes(row.status)) return false
      continue
    }
    if (key === "status" && expected && typeof expected === "object" && "not" in expected) {
      if ((expected as { not: unknown }).not === row.status) return false
      continue
    }
    if (key === "revokedAt" && expected === null) {
      if (row.revokedAt != null) return false
      continue
    }
    if (key === "questionKey" && expected && typeof expected === "object" && "in" in expected) {
      if (!(expected as { in: unknown[] }).in.includes(row.questionKey)) return false
      continue
    }
    if (row[key] !== expected) return false
  }
  return true
}

type FakeClient = Record<string, unknown> & {
  $transaction: (fn: (tx: FakeClient) => Promise<unknown>) => Promise<unknown>
}

export const prisma: FakeClient = {
  atsPreparation: {
    findUnique: async ({
      where,
    }: {
      where: { userId_preparationKey: { userId: string; preparationKey: string } }
    }) =>
      store.preparations.find(
        (row) =>
          row.userId === where.userId_preparationKey.userId &&
          row.preparationKey === where.userId_preparationKey.preparationKey
      ) ?? null,
    findFirst: async ({ where }: { where: Row }) =>
      store.preparations.find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: { where: Row } = { where: {} }) =>
      store.preparations.filter((row) => matches(row, where)),
    create: async ({ data }: { data: Row }) => {
      const row: Row = {
        id: id("prep"),
        status: "DRAFT",
        reviewTaskIds: [],
        results: null,
        fieldsFilled: 0,
        fieldsBlocked: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }
      store.preparations.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.preparations.find((entry) => entry.id === where.id)
      if (!row) throw new Error("preparation not found")
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === "object" && "increment" in (value as Row)) {
          row[key] =
            Number(row[key] ?? 0) + Number((value as { increment: number }).increment)
        } else {
          row[key] = value
        }
      }
      row.updatedAt = new Date()
      return row
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = store.preparations.filter((row) => {
        if (where.id && row.id !== where.id) return false
        if (where.status && typeof where.status === "object" && "notIn" in where.status) {
          if ((where.status as { notIn: unknown[] }).notIn.includes(row.status)) return false
        }
        return true
      })
      for (const row of rows) Object.assign(row, data, { updatedAt: new Date() })
      return { count: rows.length }
    },
  },
  atsAnswer: {
    findMany: async ({ where }: { where: Row } = { where: {} }) =>
      store.answers.filter((row) => {
        if (where.userId && row.userId !== where.userId) return false
        if (where.revokedAt === null && row.revokedAt != null) return false
        if (where.preparationId && row.preparationId !== where.preparationId) return false
        if (where.OR) {
          const clauses = where.OR as Row[]
          if (!clauses.some((clause) => matches(row, clause))) return false
        }
        if (
          where.questionKey &&
          typeof where.questionKey === "object" &&
          "in" in (where.questionKey as Row)
        ) {
          if (
            !(where.questionKey as { in: unknown[] }).in.includes(row.questionKey)
          ) {
            return false
          }
        }
        return true
      }),
    findFirst: async ({ where }: { where: Row }) =>
      store.answers.find((row) => matches(row, where)) ?? null,
    findUnique: async ({
      where,
    }: {
      where: { userId_dedupeKey: { userId: string; dedupeKey: string } }
    }) =>
      store.answers.find(
        (row) =>
          row.userId === where.userId_dedupeKey.userId &&
          row.dedupeKey === where.userId_dedupeKey.dedupeKey
      ) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row: Row = {
        id: id("answer"),
        revokedAt: null,
        lastUsedAt: null,
        useCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }
      store.answers.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.answers.find((entry) => entry.id === where.id)
      if (!row) throw new Error("answer not found")
      Object.assign(row, data, { updatedAt: new Date() })
      return row
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = store.answers.filter((row) => matches(row, where))
      for (const row of rows) Object.assign(row, data)
      return { count: rows.length }
    },
  },
  reviewTask: {
    findMany: async ({ where }: { where: Row } = { where: {} }) =>
      store.tasks.filter((row) => matches(row, where)),
    findFirst: async ({ where }: { where: Row }) =>
      store.tasks.find((row) => matches(row, where)) ?? null,
    count: async ({ where }: { where: Row }) =>
      store.tasks.filter((row) => matches(row, where)).length,
    create: async ({ data }: { data: Row }) => {
      const row: Row = {
        id: id("task"),
        status: "OPEN",
        answer: null,
        resolvedAt: null,
        createdAt: new Date(),
        ...data,
      }
      store.tasks.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.tasks.find((entry) => entry.id === where.id)
      if (!row) throw new Error("task not found")
      Object.assign(row, data)
      return row
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = store.tasks.filter((row) => {
        if (where.atsPreparationId && row.atsPreparationId !== where.atsPreparationId) return false
        if (where.status && row.status !== where.status) return false
        if (where.kind && row.kind !== where.kind) return false
        if (where.question && row.question !== where.question) return false
        if (where.category && row.category !== where.category) return false
        if (where.id && typeof where.id === "object" && "in" in (where.id as Row)) {
          if (!(where.id as { in: unknown[] }).in.includes(row.id)) return false
        }
        return true
      })
      for (const row of rows) Object.assign(row, data)
      return { count: rows.length }
    },
  },
  jobApplication: {
    findFirst: async ({ where }: { where: Row }) =>
      store.applications.find((row) => matches(row, where)) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.applications.find((entry) => entry.id === where.id)
      if (!row) throw new Error("application not found")
      Object.assign(row, data)
      return row
    },
  },
  resume: {
    findFirst: async ({ where }: { where: Row }) =>
      store.resumes.find((row) => matches(row, where)) ?? null,
  },
  careerProfile: {
    findUnique: async ({ where }: { where: { userId: string } }) =>
      where.userId === "user-1"
        ? {
            contactFullName: "Marisol Reyes",
            contactEmail: "marisol@example.com",
            contactPhone: null,
            contactLocation: null,
            linkedinUrl: null,
            githubUrl: null,
            websiteUrl: null,
          }
        : null,
  },
  playerProfile: { findUnique: async () => null },
  workflowRun: { findFirst: async () => null },
  workflowEvent: { create: async () => ({}) },
  submissionAttempt: {
    findFirst: async ({ where }: { where: Row }) =>
      store.submissionAttempts.find((row) => matches(row, where)) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row: Row = {
        id: id("attempt"),
        status: "STAGED",
        source: "EXTENSION",
        confirmedAt: null,
        confirmationNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }
      store.submissionAttempts.push(row)
      return row
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = store.submissionAttempts.find((entry) => matches(entry, where))
      if (!row) throw new Error("Submission attempt not found")
      Object.assign(row, data, { updatedAt: new Date() })
      return row
    },
  },
  applicationStatusEvent: {
    create: async ({ data }: { data: Row }) => {
      store.statusEvents.push(data)
      return data
    },
  },
  $transaction: async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
}
