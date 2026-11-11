// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveApiUserId: vi.fn(),
  isSameOriginRequest: vi.fn(),
  consumeRateLimit: vi.fn(),
  createWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  getWorkflowEvents: vi.fn(),
  startWorkflow: vi.fn(),
  resumeWorkflow: vi.fn(),
  retryWorkflow: vi.fn(),
  pauseWorkflow: vi.fn(),
  cancelWorkflow: vi.fn(),
  completeManualStep: vi.fn(),
  listReviewTasks: vi.fn(),
  createStandaloneReviewTask: vi.fn(),
  resolveReviewTask: vi.fn(),
  dismissReviewTask: vi.fn(),
  getReviewTaskRef: vi.fn(),
  getReviewTask: vi.fn(),
  scheduleWorkflowTick: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/features/auth/api-auth", () => ({
  resolveApiUserId: mocks.resolveApiUserId,
  isSameOriginRequest: mocks.isSameOriginRequest,
}))

vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: {
    WORKFLOW_CREATE: "workflow:create",
    WORKFLOW_ADVANCE: "workflow:advance",
    WEB_REVIEW_TASKS: "review:web",
  },
  consumeRateLimit: mocks.consumeRateLimit,
}))

vi.mock("@/features/workflows/services/workflow.service", () => ({
  WorkflowError: class WorkflowError extends Error {
    constructor(
      message: string,
      readonly code: string
    ) {
      super(message)
      this.name = "WorkflowError"
    }
  },
  createWorkflow: mocks.createWorkflow,
  listWorkflows: mocks.listWorkflows,
  getWorkflow: mocks.getWorkflow,
  getWorkflowEvents: mocks.getWorkflowEvents,
  startWorkflow: mocks.startWorkflow,
  resumeWorkflow: mocks.resumeWorkflow,
  retryWorkflow: mocks.retryWorkflow,
  pauseWorkflow: mocks.pauseWorkflow,
  cancelWorkflow: mocks.cancelWorkflow,
  completeManualStep: mocks.completeManualStep,
  listReviewTasks: mocks.listReviewTasks,
  createStandaloneReviewTask: mocks.createStandaloneReviewTask,
  resolveReviewTask: mocks.resolveReviewTask,
  dismissReviewTask: mocks.dismissReviewTask,
  getReviewTaskRef: mocks.getReviewTaskRef,
  getReviewTask: mocks.getReviewTask,
}))

vi.mock("@/features/workflows/services/schedule", () => ({
  scheduleWorkflowTick: mocks.scheduleWorkflowTick,
}))

vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ error: mocks.logError }),
}))

import { GET as getRun } from "../[id]/route"
import { POST as advance } from "../[id]/advance/route"
import { GET as getEvents } from "../[id]/events/route"
import { GET as listRuns, POST as createRun } from "../route"
import { PATCH as patchReviewTask } from "../../review-tasks/[id]/route"
import { GET as listTasks, POST as createTask } from "../../review-tasks/route"

const RUN = {
  id: "run-1",
  jobApplicationId: "app-1",
  kind: "APPLICATION",
  mode: "AGENT_ASSISTED",
  state: "ASSISTED",
  input: null,
  lastError: null,
  startedAt: "2026-11-11T00:00:00.000Z",
  finishedAt: null,
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  steps: [],
  openReviewTaskIds: [],
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveApiUserId.mockResolvedValue("user-1")
  mocks.isSameOriginRequest.mockReturnValue(true)
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.createWorkflow.mockResolvedValue(RUN)
  mocks.listWorkflows.mockResolvedValue([RUN])
  mocks.getWorkflow.mockResolvedValue(RUN)
  mocks.getWorkflowEvents.mockResolvedValue([])
  mocks.startWorkflow.mockResolvedValue(RUN)
  mocks.resumeWorkflow.mockResolvedValue(RUN)
  mocks.retryWorkflow.mockResolvedValue(RUN)
  mocks.pauseWorkflow.mockResolvedValue({ ...RUN, state: "PAUSED" })
  mocks.cancelWorkflow.mockResolvedValue({ ...RUN, state: "CANCELLED" })
  mocks.completeManualStep.mockResolvedValue({ ...RUN, mode: "MANUAL" })
  mocks.listReviewTasks.mockResolvedValue([])
  mocks.createStandaloneReviewTask.mockResolvedValue({ id: "task-1", status: "OPEN" })
  mocks.getReviewTaskRef.mockResolvedValue({
    id: "task-1",
    status: "OPEN",
    atsPreparationId: null,
  })
  mocks.getReviewTask.mockResolvedValue({ id: "task-1", status: "OPEN" })
  mocks.resolveReviewTask.mockResolvedValue({
    task: { id: "task-1", status: "RESOLVED" },
    run: RUN,
  })
  mocks.dismissReviewTask.mockResolvedValue({
    task: { id: "task-1", status: "DISMISSED" },
    run: { ...RUN, state: "PAUSED" },
  })
  mocks.scheduleWorkflowTick.mockResolvedValue(undefined)
})

describe("workflow routes", () => {
  it("rejects anonymous and cross-origin creation", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)
    const anonymous = await createRun(
      jsonRequest("http://localhost/api/workflows", "POST", { mode: "MANUAL" })
    )
    expect(anonymous.status).toBe(401)

    mocks.resolveApiUserId.mockResolvedValue("user-1")
    mocks.isSameOriginRequest.mockReturnValue(false)
    const crossOrigin = await createRun(
      jsonRequest("http://localhost/api/workflows", "POST", { mode: "MANUAL" })
    )
    expect(crossOrigin.status).toBe(403)
  })

  it("validates a create body and returns the persisted run", async () => {
    const invalid = await createRun(
      jsonRequest("http://localhost/api/workflows", "POST", { mode: "AUTOMATIC" })
    )
    expect(invalid.status).toBe(400)

    const unsupportedKind = await createRun(
      jsonRequest("http://localhost/api/workflows", "POST", {
        mode: "MANUAL",
        kind: "RESEARCH",
      })
    )
    expect(unsupportedKind.status).toBe(400)

    const res = await createRun(
      jsonRequest("http://localhost/api/workflows", "POST", {
        mode: "MANUAL",
        jobApplicationId: "app-1",
        idempotencyKey: "key-12345",
      })
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ workflow: RUN })
    expect(mocks.createWorkflow).toHaveBeenCalledWith("user-1", {
      jobApplicationId: "app-1",
      mode: "MANUAL",
      kind: "APPLICATION",
      idempotencyKey: "key-12345",
      runInput: undefined,
    })
  })

  it("lists runs and rejects an unknown state filter", async () => {
    const bad = await listRuns(
      new Request("http://localhost/api/workflows?state=RUNNING")
    )
    expect(bad.status).toBe(400)

    const res = await listRuns(
      new Request("http://localhost/api/workflows?state=ASSISTED&kind=APPLICATION&limit=5")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [RUN] })
    expect(mocks.listWorkflows).toHaveBeenCalledWith("user-1", {
      state: "ASSISTED",
      kind: "APPLICATION",
      limit: 5,
    })
  })

  it("returns 404 for a run the service does not expose to the owner", async () => {
    const { WorkflowError } = await import(
      "@/features/workflows/services/workflow.service"
    )
    mocks.getWorkflow.mockResolvedValue(null)
    mocks.getWorkflowEvents.mockRejectedValue(
      new WorkflowError("Workflow not found", "NOT_FOUND")
    )

    const res = await getRun(new Request("http://localhost/api/workflows/run-9"), {
      params: Promise.resolve({ id: "run-9" }),
    })
    expect(res.status).toBe(404)

    const events = await getEvents(
      new Request("http://localhost/api/workflows/run-9/events"),
      { params: Promise.resolve({ id: "run-9" }) }
    )
    expect(events.status).toBe(404)
  })

  it("schedules an assisted start but only updates a manual checkpoint", async () => {
    const started = await advance(
      jsonRequest("http://localhost/api/workflows/run-1/advance", "POST", {
        action: "START",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    )
    expect(started.status).toBe(202)
    expect(mocks.scheduleWorkflowTick).toHaveBeenCalledTimes(1)

    mocks.scheduleWorkflowTick.mockClear()
    const manual = await advance(
      jsonRequest("http://localhost/api/workflows/run-1/advance", "POST", {
        action: "COMPLETE_STEP",
        stepName: "PROFILE",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    )
    expect(manual.status).toBe(200)
    expect(mocks.completeManualStep).toHaveBeenCalledWith("user-1", "run-1", "PROFILE")
    expect(mocks.scheduleWorkflowTick).not.toHaveBeenCalled()

    const missingStep = await advance(
      jsonRequest("http://localhost/api/workflows/run-1/advance", "POST", {
        action: "COMPLETE_STEP",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    )
    expect(missingStep.status).toBe(400)
  })

  it("maps a refused transition to 409 and never calls the worker", async () => {
    const { WorkflowError } = await import(
      "@/features/workflows/services/workflow.service"
    )
    mocks.pauseWorkflow.mockRejectedValue(
      new WorkflowError("Cannot move a COMPLETED workflow to PAUSED.", "INVALID_TRANSITION")
    )

    const res = await advance(
      jsonRequest("http://localhost/api/workflows/run-1/advance", "POST", {
        action: "PAUSE",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: "INVALID_TRANSITION",
      state: "ASSISTED",
    })
    expect(mocks.scheduleWorkflowTick).not.toHaveBeenCalled()
  })

  it("keeps review tasks owner-scoped and resumable", async () => {
    const bad = await listTasks(
      new Request("http://localhost/api/review-tasks?status=DONE")
    )
    expect(bad.status).toBe(400)

    const created = await createTask(
      jsonRequest("http://localhost/api/review-tasks", "POST", {
        kind: "SENSITIVE_ANSWER",
        question: "Are you authorized to work in the US?",
        reason: "This needs your answer.",
        jobApplicationId: "app-1",
      })
    )
    expect(created.status).toBe(201)
    expect(mocks.createStandaloneReviewTask).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        jobApplicationId: "app-1",
        kind: "SENSITIVE_ANSWER",
      })
    )

    const resolved = await patchReviewTask(
      jsonRequest("http://localhost/api/review-tasks/task-1", "PATCH", {
        action: "RESOLVE",
        value: { approved: true },
      }),
      { params: Promise.resolve({ id: "task-1" }) }
    )
    expect(resolved.status).toBe(200)
    expect(mocks.resolveReviewTask).toHaveBeenCalledWith("user-1", "task-1", {
      approved: true,
    })
    expect(mocks.scheduleWorkflowTick).toHaveBeenCalledTimes(1)
  })
})
