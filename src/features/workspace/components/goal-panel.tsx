"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Target } from "lucide-react"
import { toast } from "sonner"
import { updateApplicationGoal } from "../actions/goal.actions"
import type { WorkspaceGoal } from "./workspace-board"

type GoalPanelProps = {
  goal: WorkspaceGoal
  appliedToday: number
  appliedThisWeek: number
}

const nativeInputClass =
  "h-9 w-full rounded-md border border-border bg-muted px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"

const PERIODS: { value: "DAILY" | "WEEKLY"; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
]

export function GoalPanel({ goal, appliedToday, appliedThisWeek }: GoalPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [target, setTarget] = useState(goal.target)
  const [period, setPeriod] = useState<"DAILY" | "WEEKLY">(goal.period)

  const current = period === "DAILY" ? appliedToday : appliedThisWeek
  const progress = Math.min((current / target) * 100, 100)
  const goalMet = current >= target
  const periodLabel = period === "DAILY" ? "today" : "this week"

  function save(nextTarget: number, nextPeriod: "DAILY" | "WEEKLY") {
    const prevTarget = target
    const prevPeriod = period
    setTarget(nextTarget)
    setPeriod(nextPeriod)

    startTransition(async () => {
      const result = await updateApplicationGoal(nextTarget, nextPeriod)
      if (result.error) {
        setTarget(prevTarget)
        setPeriod(prevPeriod)
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleTargetChange(value: number) {
    if (!Number.isFinite(value)) return
    const clamped = Math.min(Math.max(Math.round(value), 1), 100)
    if (clamped === target) return
    save(clamped, period)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            <Target
              className={`h-5 w-5 ${
                goalMet
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-brand-400"
              }`}
            />
          </div>
          <div>
            <p className="text-sm font-medium">Application goal</p>
            <p className="text-xs text-muted-foreground">
              {goalMet
                ? `Goal reached ${periodLabel} — nice work.`
                : `${target - current} to go ${periodLabel}`}
            </p>
          </div>
        </div>
        <p className="font-mono text-2xl font-bold">
          {current}{" "}
          <span className="text-base text-muted-foreground">/ {target}</span>
        </p>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-600 ${
            goalMet
              ? "bg-gradient-to-r from-emerald-700 to-emerald-500 dark:from-emerald-600 dark:to-emerald-400"
              : "bg-gradient-to-r from-brand-700 to-blue-500"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {current} / {target} applications {periodLabel}
      </p>

      <div className="flex flex-wrap items-end gap-4 pt-1">
        <div className="space-y-2">
          <label htmlFor="goal-target" className="text-xs font-medium text-muted-foreground">
            Target
          </label>
          <input
            id="goal-target"
            type="number"
            min={1}
            max={100}
            value={target}
            disabled={isPending}
            onChange={(e) => setTarget(Number(e.target.value))}
            onBlur={(e) => handleTargetChange(Number(e.target.value))}
            className={`${nativeInputClass} w-24`}
          />
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-muted-foreground">Period</span>
          <div className="inline-flex rounded-md border border-border bg-muted p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (p.value !== period) save(target, p.value)
                }}
                className={`rounded px-3 py-1 text-sm transition-colors ${
                  period === p.value
                    ? "bg-brand-600 text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
