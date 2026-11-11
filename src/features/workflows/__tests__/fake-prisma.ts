/**
 * A small in-memory Prisma double for the workflow engine. Only the queries the
 * engine actually uses are implemented, and they honour the same conditional
 * `updateMany` semantics that make the Postgres version safe. This is a test
 * harness, not a production database abstraction.
 */

type Row = Record<string, unknown>
type Where = Record<string, unknown>

function valueMatches(value: unknown, condition: unknown): boolean {
  if (condition === undefined) return true
  if (condition === null) return value === null || value === undefined
  if (condition instanceof Date) {
    return value instanceof Date && value.getTime() === condition.getTime()
  }
  if (Array.isArray(condition)) {
    return Array.isArray(value) && condition.every((entry) => value.includes(entry))
  }
  if (typeof condition === "object") {
    const spec = condition as Record<string, unknown>
    if ("in" in spec) return (spec.in as unknown[]).includes(value)
    if ("notIn" in spec) return !(spec.notIn as unknown[]).includes(value)
    if ("lt" in spec) {
      return value instanceof Date && (spec.lt as Date).getTime() > value.getTime()
    }
    if ("lte" in spec) {
      return value instanceof Date && (spec.lte as Date).getTime() >= value.getTime()
    }
    if ("gt" in spec) {
      return value instanceof Date && (spec.gt as Date).getTime() < value.getTime()
    }
    if ("gte" in spec) {
      return value instanceof Date && (spec.gte as Date).getTime() <= value.getTime()
    }
    if ("not" in spec) return !valueMatches(value, spec.not)
    if ("equals" in spec) return value === spec.equals
  }
  return value === condition
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue
    if (key === "OR") {
      if (!(condition as Where[]).some((entry) => matches(row, entry))) return false
      continue
    }
    if (key === "AND") {
      if (!(condition as Where[]).every((entry) => matches(row, entry))) return false
      continue
    }
    if (!valueMatches(row[key], condition)) return false
  }
  return true
}

function applyData(row: Row, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (value && typeof value === "object" && !Array.isArray(value) && "increment" in value) {
      row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment)
    } else if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "decrement" in value
    ) {
      row[key] = Number(row[key] ?? 0) - Number((value as { decrement: number }).decrement)
    } else {
      row[key] = value
    }
  }
}

/**
 * Prisma returns plain values: mutating a returned object never changes the
 * row. The double must do the same or the worker reads its own writes in ways
 * a real database would not (for example, an incremented attempt count).
 */
function clone(row: Row): Row {
  return { ...row }
}

export interface FakePrisma {
  prisma: Record<string, unknown>
  runs: Row[]
  steps: Row[]
  events: Row[]
  tasks: Row[]
  applications: Row[]
}

export function createFakePrisma(): FakePrisma {
  let sequence = 0
  const nextId = (prefix: string) => `${prefix}-${++sequence}`

  const runs: Row[] = []
  const steps: Row[] = []
  const events: Row[] = []
  const tasks: Row[] = []
  const applications: Row[] = []

  function runWithRelations(row: Row): Row {
    return {
      ...row,
      steps: steps.filter((step) => step.runId === row.id).map(clone),
      reviewTasks: tasks.filter((task) => task.runId === row.id).map(clone),
    }
  }

  const db: Record<string, unknown> = {
    $transaction: async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(db)
      return Promise.all(arg as Promise<unknown>[])
    },
    workflowRun: {
      create: async ({ data }: { data: Row }) => {
        const row: Row = {
          id: nextId("run"),
          state: "MANUAL",
          stateVersion: 0,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        runs.push(row)
        return clone(row)
      },
      createMany: async ({ data }: { data: Row[] }) => {
        for (const entry of data) steps.push({ id: nextId("step"), ...entry })
        return { count: data.length }
      },
      findMany: async ({
        where,
        take,
        orderBy,
      }: { where?: Where; take?: number; orderBy?: Record<string, unknown> } = {}) => {
        let result = runs.filter((run) => matches(run, where))
        if (orderBy && typeof orderBy === "object" && "createdAt" in orderBy) {
          result = [...result].sort(
            (a, b) =>
              (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()
          )
        }
        return typeof take === "number" ? result.slice(0, take).map(clone) : result.map(clone)
      },
      findFirst: async ({
        where,
        include,
        select,
      }: {
        where?: Where
        include?: unknown
        select?: Record<string, unknown>
      } = {}) => {
        const found = runs.find((run) => matches(run, where))
        if (!found) return null
        return include || select?.steps ? runWithRelations(found) : clone(found)
      },
      findUnique: async ({
        where,
        select,
      }: {
        where: Where
        select?: Record<string, unknown>
      }) => {
        const found = runs.find((run) => matches(run, where))
        if (!found) return null
        return select?.steps ? runWithRelations(found) : clone(found)
      },
      findUniqueOrThrow: async ({
        where,
        select,
      }: {
        where: Where
        select?: Record<string, unknown>
      }) => {
        const found = runs.find((run) => matches(run, where))
        if (!found) throw new Error("Record not found")
        return select?.steps ? runWithRelations(found) : clone(found)
      },
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const found = runs.find((run) => matches(run, where))
        if (!found) throw new Error("Record not found")
        applyData(found, data)
        found.updatedAt = new Date()
        return clone(found)
      },
      updateMany: async ({ where, data }: { where?: Where; data: Row }) => {
        const found = runs.filter((run) => matches(run, where))
        for (const run of found) {
          applyData(run, data)
          run.updatedAt = new Date()
        }
        return { count: found.length }
      },
    },
    workflowStep: {
      createMany: async ({ data }: { data: Row[] }) => {
        for (const entry of data) {
          // Prisma applies schema defaults; the double has to apply them too.
          steps.push({
            id: nextId("step"),
            status: "PENDING",
            attempts: 0,
            output: null,
            input: null,
            lastError: null,
            startedAt: null,
            finishedAt: null,
            nextAttemptAt: null,
            timeoutMs: 60_000,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...entry,
          })
        }
        return { count: data.length }
      },
      findMany: async ({ where }: { where?: Where } = {}) =>
        steps.filter((step) => matches(step, where)).map(clone),
      findFirst: async ({ where }: { where?: Where } = {}) => {
        const found = steps.find((step) => matches(step, where))
        return found ? clone(found) : null
      },
      findUnique: async ({ where }: { where: Where }) => {
        const found = steps.find((step) => matches(step, where))
        return found ? clone(found) : null
      },
      count: async ({ where }: { where?: Where } = {}) =>
        steps.filter((step) => matches(step, where)).length,
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const found = steps.find((step) => matches(step, where))
        if (!found) throw new Error("Record not found")
        applyData(found, data)
        found.updatedAt = new Date()
        return clone(found)
      },
      updateMany: async ({ where, data }: { where?: Where; data: Row }) => {
        const found = steps.filter((step) => matches(step, where))
        for (const step of found) {
          applyData(step, data)
          step.updatedAt = new Date()
        }
        return { count: found.length }
      },
    },
    workflowEvent: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: nextId("event"), createdAt: new Date(), ...data }
        events.push(row)
        return clone(row)
      },
      findMany: async ({ where }: { where?: Where } = {}) =>
        events.filter((event) => matches(event, where)).map(clone),
    },
    reviewTask: {
      create: async ({ data }: { data: Row }) => {
        const row = {
          id: nextId("task"),
          status: "OPEN",
          resolvedAt: null,
          answer: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        tasks.push(row)
        return clone(row)
      },
      findFirst: async ({ where }: { where?: Where } = {}) => {
        const found = tasks.find((task) => matches(task, where))
        return found ? clone(found) : null
      },
      count: async ({ where }: { where?: Where } = {}) =>
        tasks.filter((task) => matches(task, where)).length,
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const found = tasks.find((task) => matches(task, where))
        if (!found) throw new Error("Record not found")
        applyData(found, data)
        found.updatedAt = new Date()
        return clone(found)
      },
      updateMany: async ({ where, data }: { where?: Where; data: Row }) => {
        const found = tasks.filter((task) => matches(task, where))
        for (const task of found) applyData(task, data)
        return { count: found.length }
      },
    },
    jobApplication: {
      findFirst: async ({ where }: { where?: Where } = {}) =>
        applications.find((application) => matches(application, where)) ?? null,
    },
  }

  return { prisma: db, runs, steps, events, tasks, applications }
}
