"use client"

import { FileCheck, Files, Search, ScanSearch, UserRound } from "lucide-react"
import { STEP_LABELS, readable } from "../client/presentation"
import type { WorkflowRunDTO } from "../types"

const STATIONS = [
  { label: "Profile", names: ["PROFILE"], icon: UserRound },
  { label: "Search", names: ["DISCOVER", "RANK"], icon: Search },
  { label: "Research", names: ["RESEARCH"], icon: ScanSearch },
  { label: "Documents", names: ["TAILOR", "VALIDATE"], icon: Files },
  { label: "Review & handoff", names: ["PREPARE_ATS", "HUMAN_REVIEW", "SUBMISSION_STAGING", "TRACKING", "FOLLOW_UP"], icon: FileCheck },
]

/** Original DOM geometry: stations are views of the pipeline, never separate agents. */
export function WorkflowRoom({ run, selectedStep, onSelect }: { run: WorkflowRunDTO; selectedStep: string; onSelect: (name: string) => void }) {
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Evidence studio · five workstations for this preparation. Select a recorded step to inspect it below.</p>
    <div className="grid gap-3 rounded-xl bg-muted p-4 sm:grid-cols-2 xl:grid-cols-3 [perspective:1000px] motion-reduce:[perspective:none] forced-colors:[perspective:none]">
      {STATIONS.map(({ label, names, icon: Icon }) => {
        const steps = run.steps.filter((step) => names.includes(step.name))
        const current = steps.find((step) => step.status === "RUNNING" || step.status === "WAITING_FOR_USER") || steps.find((step) => step.status === "PENDING") || steps.at(-1)
        const selected = names.includes(selectedStep)
        return <button key={label} type="button" disabled={!current} aria-pressed={selected}
          onClick={() => current && onSelect(current.name)}
          aria-label={`${label}: ${steps.map((step) => `${STEP_LABELS[step.name] || step.name}, ${readable(step.status)}`).join("; ")}`}
          className={`min-h-32 rounded-lg border bg-card p-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:lg:[transform:rotateX(6deg)] ${selected ? "border-brand-400" : "border-border hover:border-foreground/40"}`}>
          <Icon className="mb-3 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <span className="block text-sm font-semibold">{label}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{steps.filter((step) => step.status === "COMPLETED").length} of {steps.length} steps completed</span>
          {current && <span className="mt-2 block text-xs">{STEP_LABELS[current.name] || current.name} · {readable(current.status)}</span>}
        </button>
      })}
    </div>
  </div>
}
