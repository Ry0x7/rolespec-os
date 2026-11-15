import type { JsonObject, JsonValue, WorkflowRunDTO, WorkflowStepDTO } from "../types"

export const STEP_LABELS: Record<string, string> = {
  PROFILE: "Check candidate profile",
  DISCOVER: "Prepare search links",
  RANK: "Rank opportunity",
  RESEARCH: "Research role and company",
  TAILOR: "Draft tailored resume",
  VALIDATE: "Check resume evidence",
  PREPARE_ATS: "Prepare application facts",
  HUMAN_REVIEW: "Review preparation",
  SUBMISSION_STAGING: "Stage application",
  TRACKING: "Check tracker",
  FOLLOW_UP: "Check follow-up timing",
}

export function objectValue(value: JsonValue | null | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

export function readable(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
}

export function isLiveRun(run: WorkflowRunDTO) {
  return run.mode === "AGENT_ASSISTED" && (run.state === "ASSISTED" || run.state === "AWAITING_REVIEW")
}

export function workflowActions(run: WorkflowRunDTO): string[] {
  if (run.state === "COMPLETED" || run.state === "CANCELLED") return []
  if (run.state === "MANUAL") return [...(run.mode === "AGENT_ASSISTED" || !run.startedAt ? ["START"] : []), "CANCEL"]
  if (run.state === "ASSISTED" || run.state === "AWAITING_REVIEW") return ["PAUSE", "CANCEL"]
  if (run.state === "PAUSED" && run.mode === "AGENT_ASSISTED") return ["RESUME", "CANCEL"]
  if (run.state === "FAILED" && run.mode === "AGENT_ASSISTED") return ["RETRY", "CANCEL"]
  return ["CANCEL"]
}

export function nextManualStep(run: WorkflowRunDTO): WorkflowStepDTO | undefined {
  if (run.mode !== "MANUAL" || run.state !== "MANUAL") return undefined
  return [...run.steps].sort((a, b) => a.order - b.order).find((step) =>
    step.status !== "COMPLETED" && step.status !== "SKIPPED" &&
    step.dependsOn.every((name) => run.steps.some((dependency) => dependency.name === name && (dependency.status === "COMPLETED" || dependency.status === "SKIPPED")))
  )
}

export function runTitle(run: WorkflowRunDTO): string {
  const ranked = objectValue(run.steps.find((step) => step.name === "RANK")?.output)
  if (typeof ranked.title === "string" && typeof ranked.companyName === "string") return `${ranked.title} · ${ranked.companyName}`
  return run.input?.targetRole || "Application preparation"
}

export function manualTool(stepName: string, applicationId: string | null): { label: string; href: string } {
  if (stepName === "PROFILE") return { label: "Open career profile", href: "/career-profile" }
  if (stepName === "DISCOVER") return { label: "Discover opportunities", href: "/jobs/discover" }
  if (stepName === "TAILOR" || stepName === "VALIDATE") return { label: "Open resumes", href: "/resumes" }
  if (stepName === "FOLLOW_UP") return { label: "Open planner", href: "/planner" }
  return { label: "Open manual job tools", href: applicationId ? `/jobs/${encodeURIComponent(applicationId)}` : "/jobs" }
}

export function safeSourceUrl(value: JsonValue | undefined): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch { return null }
}
