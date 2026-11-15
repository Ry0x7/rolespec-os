"use client"

import { SegmentedControl } from "@/shared/ui/segmented-control"
import { useWorkflowMode } from "../hooks/use-workflow-mode"

export function WorkflowModeSwitch({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useWorkflowMode()
  return <div className="min-w-0" title="Preference for new preparations. Existing runs keep their mode.">
    <SegmentedControl value={mode} onChange={setMode} label="Mode for new preparations" size={compact ? "sm" : "default"} options={[
      { value: "MANUAL", label: "Manual" },
      { value: "AGENT_ASSISTED", label: "Agent-assisted" },
    ]} />
    {!compact && <p className="mt-2 text-xs text-muted-foreground">For new preparations only. Existing runs keep their mode.</p>}
  </div>
}
