import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { workflowActions, nextManualStep, safeSourceUrl } from "../client/presentation"
import { useWorkflow } from "../hooks/use-workflow"
import { WorkflowModeSwitch } from "../components/workflow-mode-switch"
import { PreparationPanel } from "../components/preparation-panel"
import { WorkflowDetail } from "../components/workflow-detail"
import type { WorkflowRunDTO, WorkflowEventDTO } from "../types"

function run(overrides: Partial<WorkflowRunDTO> = {}): WorkflowRunDTO {
  return {
    id: "run-1", kind: "APPLICATION", mode: "AGENT_ASSISTED", state: "ASSISTED", jobApplicationId: "application-1",
    input: { resumeId: "resume-1" }, lastError: null, startedAt: "2026-11-12T00:00:00.000Z", finishedAt: null,
    createdAt: "2026-11-12T00:00:00.000Z", updatedAt: "2026-11-12T00:01:00.000Z", openReviewTaskIds: [],
    steps: [
      { id: "step-profile", name: "PROFILE", order: 0, status: "PENDING", required: true, dependsOn: [], attempts: 0, maxAttempts: 3, output: null, lastError: null, startedAt: null, finishedAt: null },
      { id: "step-rank", name: "RANK", order: 1, status: "PENDING", required: true, dependsOn: ["PROFILE"], attempts: 0, maxAttempts: 3, output: null, lastError: null, startedAt: null, finishedAt: null },
    ],
    ...overrides,
  }
}

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(readonly url: string) { super(); FakeEventSource.instances.push(this) }
  close() { this.closed = true }
  progress(workflow: WorkflowRunDTO) { this.dispatchEvent(new MessageEvent("progress", { data: JSON.stringify(workflow) })) }
}

const request = vi.fn()
const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }))

beforeEach(() => {
  FakeEventSource.instances = []
  request.mockReset()
  vi.stubGlobal("EventSource", FakeEventSource)
  vi.stubGlobal("fetch", request)
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true })
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  localStorage.clear()
})

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe("workflow controls", () => {
  it.each([
    ["MANUAL", "AGENT_ASSISTED", ["START", "CANCEL"]],
    ["ASSISTED", "AGENT_ASSISTED", ["PAUSE", "CANCEL"]],
    ["AWAITING_REVIEW", "AGENT_ASSISTED", ["PAUSE", "CANCEL"]],
    ["PAUSED", "AGENT_ASSISTED", ["RESUME", "CANCEL"]],
    ["FAILED", "AGENT_ASSISTED", ["RETRY", "CANCEL"]],
    ["COMPLETED", "AGENT_ASSISTED", []],
    ["CANCELLED", "AGENT_ASSISTED", []],
  ] as const)("shows legal actions for %s", (state, mode, expected) => {
    expect(workflowActions(run({ state, mode }))).toEqual(expected)
  })

  it("keeps a started manual checklist manual and completes dependencies in order", () => {
    const manual = run({ mode: "MANUAL", state: "MANUAL" })
    expect(workflowActions(manual)).toEqual(["CANCEL"])
    expect(nextManualStep(manual)?.name).toBe("PROFILE")
    manual.steps[0].status = "COMPLETED"
    expect(nextManualStep(manual)?.name).toBe("RANK")
    expect(nextManualStep(run())).toBeUndefined()
  })

  it("rejects executable citation protocols", () => {
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull()
    expect(safeSourceUrl("data:text/html,test")).toBeNull()
    expect(safeSourceUrl("https://example.test/source")).toBe("https://example.test/source")
  })
})

describe("persisted workflow transport", () => {
  it("uses progress DTOs, ignores ping for event reads, dedupes history and stops on terminal state", async () => {
    const event = { id: "event-1", type: "RUN_STARTED", stepName: null, message: "Assisted workflow started.", metadata: null, createdAt: "2026-11-12T00:00:00.000Z" } satisfies WorkflowEventDTO
    request.mockImplementation((path: string) => path.includes("/events") ? json({ events: [event, event] }) : json({ workflow: run() }))
    const { result, unmount } = renderHook(() => useWorkflow("run-1"))
    await waitFor(() => expect(result.current.events).toHaveLength(1))
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe("/api/workflows/run-1/stream")
    const beforePing = request.mock.calls.length
    act(() => FakeEventSource.instances[0].dispatchEvent(new MessageEvent("ping", { data: "{}" })))
    expect(request.mock.calls).toHaveLength(beforePing)
    act(() => FakeEventSource.instances[0].progress(run({ state: "COMPLETED", updatedAt: "2026-11-12T00:02:00.000Z" })))
    expect(result.current.run?.state).toBe("COMPLETED")
    expect(result.current.connection).toBe("idle")
    expect(FakeEventSource.instances[0].closed).toBe(true)
    unmount()
  })

  it("keeps saved state after a dropped stream, reloads on reconnect and closes when offline", async () => {
    request.mockImplementation((path: string) => path.includes("/events") ? json({ events: [] }) : json({ workflow: run() }))
    const { result } = renderHook(() => useWorkflow("run-1"))
    await waitFor(() => expect(result.current.run?.state).toBe("ASSISTED"))
    act(() => FakeEventSource.instances[0].onerror?.())
    expect(result.current.connection).toBe("interrupted")
    expect(result.current.run?.state).toBe("ASSISTED")
    request.mockImplementation((path: string) => path.includes("/events") ? json({ events: [] }) : json({ workflow: run({ state: "PAUSED" }) }))
    act(() => result.current.reconnect())
    expect(result.current.run?.state).toBe("ASSISTED")
    await waitFor(() => expect(result.current.run?.state).toBe("PAUSED"))
    expect(FakeEventSource.instances).toHaveLength(1)
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false })
    act(() => window.dispatchEvent(new Event("offline")))
    expect(result.current.connection).toBe("offline")
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })

  it("does not open streams for manual checklists", async () => {
    request.mockImplementation((path: string) => path.includes("/events") ? json({ events: [] }) : json({ workflow: run({ mode: "MANUAL", state: "MANUAL" }) }))
    const { result } = renderHook(() => useWorkflow("run-1"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.connection).toBe("idle")
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it("does not reopen a stream when a pending read finishes after going offline", async () => {
    let finish!: (response: Response) => void
    request.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve }))
    const { result } = renderHook(() => useWorkflow("run-1"))
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false })
    act(() => window.dispatchEvent(new Event("offline")))
    await act(async () => { finish(new Response(JSON.stringify({ workflow: run() }), { status: 200 })); await Promise.resolve() })
    expect(result.current.connection).toBe("offline")
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it("stops automatic reconnect after five failures and preserves the last persisted state", async () => {
    request.mockImplementation((path: string) => path.includes("/events") ? json({ events: [] }) : json({ workflow: run() }))
    const { result } = renderHook(() => useWorkflow("run-1"))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    vi.useFakeTimers()
    const delays = [1000, 2000, 5000, 10000, 30000]
    for (const delay of delays) {
      act(() => FakeEventSource.instances.at(-1)!.onerror?.())
      await act(async () => { await vi.advanceTimersByTimeAsync(delay) })
    }
    expect(FakeEventSource.instances).toHaveLength(6)
    act(() => FakeEventSource.instances.at(-1)!.onerror?.())
    await act(async () => { await vi.advanceTimersByTimeAsync(120000) })
    expect(FakeEventSource.instances).toHaveLength(6)
    expect(result.current.run?.state).toBe("ASSISTED")
    expect(result.current.connection).toBe("interrupted")
  })
})

describe("preparation intent and mode", () => {
  it("defaults to agent-assisted, shares the new-run preference without changing the color mode", () => {
    localStorage.setItem("rolespec-mode", "light")
    render(<><WorkflowModeSwitch /><WorkflowModeSwitch /></>)
    expect(screen.getAllByRole("button", { name: "Agent-assisted" }).every((element) => element.getAttribute("aria-pressed") === "true")).toBe(true)
    fireEvent.click(screen.getAllByRole("button", { name: "Manual" })[0])
    expect(screen.getAllByRole("button", { name: "Manual" }).every((element) => element.getAttribute("aria-pressed") === "true")).toBe(true)
    expect(localStorage.getItem("rolespec-workflow-mode")).toBe("MANUAL")
    expect(localStorage.getItem("rolespec-mode")).toBe("light")
  })

  it("retries an unknown create outcome with the same key and never starts a manual checklist", async () => {
    localStorage.setItem("rolespec-workflow-mode", "MANUAL")
    request.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/workflows" && init?.method === "POST") return Promise.reject(new TypeError("Network interrupted"))
      return json({ items: [] })
    })
    render(<PreparationPanel jobApplicationId="application-1" resumeId="resume-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "Create manual checklist" }))
    await screen.findByRole("alert")
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry creation" }).hasAttribute("disabled")).toBe(false))
    fireEvent.click(screen.getByRole("button", { name: "Agent-assisted" }))
    fireEvent.click(screen.getByRole("button", { name: "Retry creation" }))
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2))
    const writes = request.mock.calls.filter(([, init]) => init?.method === "POST")
    expect(JSON.parse(writes[0][1].body)).toEqual(JSON.parse(writes[1][1].body))
    expect(JSON.parse(writes[0][1].body)).toMatchObject({ mode: "MANUAL", jobApplicationId: "application-1", input: { resumeId: "resume-1" } })
    expect(request.mock.calls.some(([path]) => path.includes("/advance"))).toBe(false)
  })

  it("creates and starts the agent in one click, then monitors real backend state", async () => {
    localStorage.setItem("rolespec-workflow-mode", "AGENT_ASSISTED")
    let created = false
    let persisted = run({ state: "MANUAL", startedAt: null })
    request.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/workflows" && init?.method === "POST") { created = true; return json({ workflow: persisted }, 201) }
      if (path.includes("/advance")) { persisted = run(); return json({ workflow: persisted }, 202) }
      if (path.includes("/events")) return json({ events: [] })
      if (path.includes("limit=50")) return json({ items: created ? [persisted] : [] })
      return json({ workflow: persisted })
    })
    render(<PreparationPanel jobApplicationId="application-1" resumeId="resume-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "Run agent preparation" }))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const advance = request.mock.calls.find(([path]) => path.includes("/advance"))
    expect(JSON.parse(advance![1].body)).toEqual({ action: "START" })
    expect(screen.queryByText("Connected to persisted workflow updates.")).toBeNull()
    act(() => FakeEventSource.instances[0].onopen?.())
    expect(screen.getByText("Connected to persisted workflow updates.")).toBeTruthy()
  })

  it("requires explicit confirmation before recording a manual step and never invokes AI", async () => {
    let persisted = run({ mode: "MANUAL", state: "MANUAL" })
    request.mockImplementation((path: string) => {
      if (path.includes("/advance")) {
        persisted = { ...persisted, steps: persisted.steps.map((step) => step.name === "PROFILE" ? { ...step, status: "COMPLETED" } : step) }
        return json({ workflow: persisted })
      }
      if (path.includes("/events")) return json({ events: [] })
      return json({ workflow: persisted })
    })
    render(<WorkflowDetail runId="run-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "Mark step done" }))
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Record step done" }))
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1))
    const write = request.mock.calls.find(([, init]) => init?.method === "POST")
    expect(write![0]).toBe("/api/workflows/run-1/advance")
    expect(JSON.parse(write![1].body)).toEqual({ action: "COMPLETE_STEP", stepName: "PROFILE" })
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it("starts a manual checklist without opening an assisted stream or invoking an AI endpoint", async () => {
    let persisted = run({ mode: "MANUAL", state: "MANUAL", startedAt: null })
    request.mockImplementation((path: string) => {
      if (path.includes("/advance")) { persisted = { ...persisted, startedAt: "2026-11-12T00:03:00.000Z" }; return json({ workflow: persisted }) }
      if (path.includes("/events")) return json({ events: [] })
      return json({ workflow: persisted })
    })
    render(<WorkflowDetail runId="run-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "Start checklist" }))
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1))
    const writes = request.mock.calls.filter(([, init]) => init?.method === "POST")
    expect(writes[0][0]).toBe("/api/workflows/run-1/advance")
    expect(JSON.parse(writes[0][1].body)).toEqual({ action: "START" })
    expect(request.mock.calls.every(([path]) => path.startsWith("/api/workflows/"))).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it("names the selected source and explains live source resolution rather than freezing the resume", async () => {
    localStorage.setItem("rolespec-workflow-mode", "AGENT_ASSISTED")
    request.mockImplementation(() => json({ items: [] }))
    render(<PreparationPanel jobApplicationId="application-1" resumeId="resume-1" resumeTitle="Engineering master" />)
    const source = await screen.findByRole("link", { name: "Engineering master" })
    expect(source.getAttribute("href")).toBe("/resumes/resume-1")
    expect(screen.getByText(/Choose your source in the resume panel below before starting/)).toBeTruthy()
    expect(screen.queryByText(/Later selection changes do not edit this attempt/)).toBeNull()
  })

  it("explains master fallback and human decision when no selected source exists", async () => {
    localStorage.setItem("rolespec-workflow-mode", "AGENT_ASSISTED")
    request.mockImplementation(() => json({ items: [] }))
    render(<PreparationPanel jobApplicationId="application-1" />)
    expect(await screen.findByText(/No resume is currently selected. An available master can be used; if no source is available, the agent pauses and asks you to choose one/)).toBeTruthy()
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0)
  })

  it("hands off a completed agent package with the employer link and a confirmation path", async () => {
    const completed = run({
      state: "COMPLETED",
      steps: [
        {
          id: "step-staging",
          name: "SUBMISSION_STAGING",
          order: 0,
          status: "COMPLETED",
          required: true,
          dependsOn: [],
          attempts: 1,
          maxAttempts: 1,
          output: {
            submissionAttemptId: "attempt-1",
            submitted: false,
            job: { url: "https://jobs.example.test/apply", title: "Engineer", companyName: "Acme" },
          },
          lastError: null,
          startedAt: null,
          finishedAt: null,
        },
      ],
    })
    request.mockImplementation((path: string) => path.includes("/events") ? json({ events: [] }) : json({ workflow: completed }))
    render(<WorkflowDetail runId="run-1" />)
    expect(await screen.findByText("Application package ready — submit it yourself")).toBeTruthy()
    const employer = screen.getByRole("link", { name: /Open employer application/ })
    expect(employer.getAttribute("href")).toBe("https://jobs.example.test/apply")
    const confirm = screen.getByRole("link", { name: "Confirm what happened" })
    expect(confirm.getAttribute("href")).toBe("/jobs/application-1#track")
  })
})
