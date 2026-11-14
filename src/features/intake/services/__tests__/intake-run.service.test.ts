// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const adapters = new Map<string, unknown>()
  const client: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {
    intakeRun: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    intakeSourceRun: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    intakePatch: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  }
  return {
    adapters,
    intakeRun: client.intakeRun,
    intakeSourceRun: client.intakeSourceRun,
    intakePatch: client.intakePatch,
    transaction: vi.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client)
    ),
  }
})

vi.mock("../../adapters/registry", () => ({
  getIntakeAdapter: (source: string) => mocks.adapters.get(source),
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    intakeRun: mocks.intakeRun,
    intakeSourceRun: mocks.intakeSourceRun,
    intakePatch: mocks.intakePatch,
    $transaction: mocks.transaction,
  },
}))

import {
  cancelIntakeRun,
  createIntakeRun,
  executeIntakeRun,
  getIntakeRun,
  IntakeRunError,
  retryIntakeRun,
} from "../intake-run.service"

const PROVENANCE = {
  adapter: "test",
  sourceUrl: null,
  fileName: null,
  externalId: null,
  locator: null,
  fetchedAt: "2026-11-11T12:00:00.000Z",
  detail: null,
}

function draft(title = "Backend Engineer") {
  return {
    kind: "EVIDENCE" as const,
    data: {
      evidenceKind: "EXPERIENCE" as const,
      title,
      organization: "Acme",
      details: null,
      outcome: null,
      startDate: null,
      endDate: null,
    },
    confidence: 80,
    provenance: PROVENANCE,
  }
}

function successAdapter(source: string, patches = [draft()]) {
  return {
    source,
    label: source,
    run: async ({ reportProgress }: { reportProgress: (n: number) => Promise<void> }) => {
      await reportProgress(50)
      return { patches }
    },
  }
}

function failureAdapter(source: string, message = "source unavailable") {
  return {
    source,
    label: source,
    run: async () => {
      throw new Error(message)
    },
  }
}

function runRow(
  sources: Array<{ id: string; source: string; status: string; input?: unknown }>
) {
  return {
    id: "run-1",
    userId: "user-1",
    status: "PENDING",
    requestedSources: sources.map((source) => source.source),
    error: null,
    warnings: [],
    startedAt: null,
    finishedAt: null,
    createdAt: new Date("2026-11-11T12:00:00.000Z"),
    sources: sources.map((source) => ({
      id: source.id,
      source: source.source,
      status: source.status,
      progress: 0,
      message: null,
      error: null,
      input: source.input ?? {},
      metadata: null,
      startedAt: null,
      finishedAt: null,
    })),
    patches: [],
  }
}

function dtoRun(
  status: string,
  sources: Array<{ id: string; source: string; status: string }>
) {
  return {
    id: "run-1",
    status,
    requestedSources: sources.map((source) => source.source),
    error: null,
    warnings: [],
    startedAt: new Date("2026-11-11T12:00:00.000Z"),
    finishedAt: status === "RUNNING" || status === "PENDING" ? null : new Date(),
    createdAt: new Date("2026-11-11T12:00:00.000Z"),
    sources: sources.map((source) => ({
      id: source.id,
      source: source.source,
      status: source.status,
      progress: 100,
      message: null,
      error: null,
      startedAt: new Date(),
      finishedAt: new Date(),
    })),
    patches: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.adapters.clear()
  mocks.intakeRun.updateMany.mockResolvedValue({ count: 1 })
  mocks.intakeRun.update.mockResolvedValue({})
  mocks.intakeRun.create.mockResolvedValue({ id: "run-1" })
  mocks.intakeSourceRun.update.mockResolvedValue({})
  mocks.intakeSourceRun.updateMany.mockResolvedValue({ count: 1 })
  mocks.intakeSourceRun.findMany.mockResolvedValue([])
  mocks.intakePatch.createMany.mockResolvedValue({ count: 0 })
  mocks.intakePatch.findMany.mockResolvedValue([])
  mocks.intakePatch.updateMany.mockResolvedValue({ count: 0 })
  mocks.intakePatch.deleteMany.mockResolvedValue({ count: 0 })
  mocks.intakeRun.findUnique.mockImplementation(({ include }: { include?: unknown }) =>
    include ? Promise.resolve(runRow([])) : Promise.resolve({ status: "RUNNING" })
  )
})

describe("createIntakeRun", () => {
  it("returns an existing run for a replayed idempotency key", async () => {
    mocks.intakeRun.findFirst.mockResolvedValue({ id: "run-existing" })

    const id = await createIntakeRun(
      "user-1",
      [
        {
          source: "GITHUB",
          input: { url: "https://github.com/ada", consent: true },
        },
      ],
      "intake-replay-1"
    )

    expect(id).toBe("run-existing")
    expect(mocks.intakeRun.create).not.toHaveBeenCalled()
  })

  it("stores one source row per request and keeps consent in the stored input", async () => {
    await createIntakeRun("user-1", [
      { source: "GITHUB", input: { url: "https://github.com/ada", consent: true } },
      { source: "WEB", input: { url: "https://ada.dev", consent: true } },
    ])

    const data = mocks.intakeRun.create.mock.calls[0][0].data
    expect(data.requestedSources).toEqual(["GITHUB", "WEB"])
    expect(data.sources.create).toHaveLength(2)
    expect(data.sources.create[0].input).toEqual({
      url: "https://github.com/ada",
      consent: true,
    })
  })
})

describe("executeIntakeRun", () => {
  it("keeps a successful source and reports PARTIAL when another fails", async () => {
    const sources = [
      { id: "src-1", source: "RESUME", status: "PENDING" },
      { id: "src-2", source: "GITHUB", status: "PENDING" },
    ]
    mocks.intakeRun.findUnique.mockImplementation(({ include }: { include?: unknown }) =>
      include
        ? Promise.resolve(runRow(sources))
        : Promise.resolve({ status: "RUNNING" })
    )
    mocks.intakeSourceRun.findMany.mockResolvedValue([
      { source: "RESUME", status: "SUCCEEDED", error: null, metadata: null },
      { source: "GITHUB", status: "FAILED", error: "GitHub is unavailable", metadata: null },
    ])
    mocks.adapters.set("RESUME", successAdapter("RESUME"))
    mocks.adapters.set("GITHUB", failureAdapter("GITHUB", "GitHub is unavailable"))

    await executeIntakeRun("run-1")

    expect(mocks.intakePatch.createMany).toHaveBeenCalledTimes(1)
    expect(mocks.intakeRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PARTIAL",
          error: null,
          warnings: expect.arrayContaining(["GITHUB: GitHub is unavailable"]),
        }),
      })
    )
  })

  it("reports FAILED when every source fails", async () => {
    const sources = [
      { id: "src-1", source: "RESUME", status: "PENDING" },
      { id: "src-2", source: "GITHUB", status: "PENDING" },
    ]
    mocks.intakeRun.findUnique.mockImplementation(({ include }: { include?: unknown }) =>
      include
        ? Promise.resolve(runRow(sources))
        : Promise.resolve({ status: "RUNNING" })
    )
    mocks.intakeSourceRun.findMany.mockResolvedValue([
      { source: "RESUME", status: "FAILED", error: "bad document", metadata: null },
      { source: "GITHUB", status: "FAILED", error: "rate limited", metadata: null },
    ])
    mocks.adapters.set("RESUME", failureAdapter("RESUME", "bad document"))
    mocks.adapters.set("GITHUB", failureAdapter("GITHUB", "rate limited"))

    await executeIntakeRun("run-1")

    const update = mocks.intakeRun.update.mock.calls[0][0]
    expect(update.data.status).toBe("FAILED")
    expect(update.data.error).toMatch(/RESUME: bad document/)
    expect(update.data.error).toMatch(/GITHUB: rate limited/)
  })

  it("marks exact duplicates from different sources rejected but keeps the best one", async () => {
    const sources = [
      { id: "src-1", source: "RESUME", status: "PENDING" },
      { id: "src-2", source: "LINKEDIN", status: "PENDING" },
    ]
    mocks.intakeRun.findUnique.mockImplementation(({ include }: { include?: unknown }) =>
      include
        ? Promise.resolve(runRow(sources))
        : Promise.resolve({ status: "RUNNING" })
    )
    mocks.intakeSourceRun.findMany.mockResolvedValue([
      { source: "LINKEDIN", status: "SUCCEEDED", error: null, metadata: null },
      { source: "RESUME", status: "SUCCEEDED", error: null, metadata: null },
    ])
    mocks.intakePatch.findMany.mockResolvedValue([
      {
        id: "patch-low",
        kind: "EVIDENCE",
        payload: {
          evidenceKind: "EXPERIENCE",
          title: "Backend Engineer",
          organization: "Acme",
          details: null,
          outcome: null,
          startDate: null,
          endDate: null,
        },
        fingerprint: "evidence:EXPERIENCE:backend engineer:acme",
        confidence: 70,
        source: "LINKEDIN",
        createdAt: new Date("2026-11-11T12:00:02.000Z"),
      },
      {
        id: "patch-high",
        kind: "EVIDENCE",
        payload: {
          evidenceKind: "EXPERIENCE",
          title: "Backend Engineer",
          organization: "Acme",
          details: null,
          outcome: null,
          startDate: null,
          endDate: null,
        },
        fingerprint: "evidence:EXPERIENCE:backend engineer:acme",
        confidence: 85,
        source: "RESUME",
        createdAt: new Date("2026-11-11T12:00:01.000Z"),
      },
    ])
    mocks.adapters.set("RESUME", successAdapter("RESUME"))
    mocks.adapters.set("LINKEDIN", successAdapter("LINKEDIN"))

    await executeIntakeRun("run-1")

    expect(mocks.intakePatch.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["patch-low"] } },
      data: expect.objectContaining({ status: "REJECTED" }),
    })
    expect(mocks.intakeRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
    )
  })

  it("does not execute a run that another worker already claimed", async () => {
    mocks.intakeRun.updateMany.mockResolvedValue({ count: 0 })

    await executeIntakeRun("run-1")

    expect(mocks.intakeRun.findUnique).not.toHaveBeenCalled()
    expect(mocks.intakeRun.update).not.toHaveBeenCalled()
  })
})

describe("cancellation", () => {
  it("cancels the run and every pending source in one transaction", async () => {
    mocks.intakeRun.findFirst.mockImplementation(({ select }: { select?: unknown }) =>
      select
        ? Promise.resolve({ id: "run-1", status: "RUNNING" })
        : Promise.resolve(
            dtoRun("CANCELLED", [
              { id: "src-1", source: "RESUME", status: "CANCELLED" },
              { id: "src-2", source: "GITHUB", status: "PENDING" },
            ])
          )
    )

    const result = await cancelIntakeRun("user-1", "run-1")

    expect(result.status).toBe("CANCELLED")
    expect(mocks.intakeRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    })
    expect(mocks.intakeSourceRun.updateMany).toHaveBeenCalledWith({
      where: { runId: "run-1", status: { in: ["PENDING", "RUNNING"] } },
      data: expect.objectContaining({ status: "CANCELLED" }),
    })
  })

  it("refuses to cancel a run that has already finished", async () => {
    mocks.intakeRun.findFirst.mockResolvedValue({ id: "run-1", status: "COMPLETED" })

    await expect(cancelIntakeRun("user-1", "run-1")).rejects.toMatchObject({
      status: 409,
    })
  })
})

describe("retry", () => {
  it("reruns only failed or cancelled sources", async () => {
    mocks.intakeRun.findFirst
      .mockResolvedValueOnce({
        id: "run-1",
        userId: "user-1",
        status: "PARTIAL",
        sources: [
          { id: "src-failed", status: "FAILED" },
          { id: "src-ok", status: "SUCCEEDED" },
        ],
      })
      .mockResolvedValueOnce(
        dtoRun("PENDING", [
          { id: "src-failed", source: "GITHUB", status: "PENDING" },
          { id: "src-ok", source: "RESUME", status: "SUCCEEDED" },
        ])
      )

    const result = await retryIntakeRun("user-1", "run-1")

    expect(result.status).toBe("PENDING")
    expect(mocks.intakeSourceRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["src-failed"] } },
        data: expect.objectContaining({ status: "PENDING", progress: 0 }),
      })
    )
    expect(mocks.intakeRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) })
    )
  })

  it("refuses a retry when nothing failed", async () => {
    mocks.intakeRun.findFirst.mockResolvedValue({
      id: "run-1",
      status: "COMPLETED",
      sources: [{ id: "src-1", status: "SUCCEEDED" }],
    })

    await expect(retryIntakeRun("user-1", "run-1")).rejects.toMatchObject({
      status: 409,
    })
  })
})

describe("ownership", () => {
  it("returns 404 rather than another owner's run", async () => {
    mocks.intakeRun.findFirst.mockResolvedValue(null)

    await expect(getIntakeRun("user-1", "run-2")).rejects.toBeInstanceOf(IntakeRunError)
    await expect(getIntakeRun("user-1", "run-2")).rejects.toMatchObject({ status: 404 })
  })
})
