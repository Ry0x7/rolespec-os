"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Briefcase, Plus, Target, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/shared/ui/card"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Select } from "@/shared/ui/select"
import { Label } from "@/shared/ui/label"
import { Progress } from "@/shared/ui/progress"
import { EmptyState } from "@/shared/components/empty-state"
import type { JobLinkOption } from "../types"

interface Goal {
  id: string
  label: string
  target: number
  current: number
  jobApplicationId: string | null
}

interface GoalsTrackerProps {
  jobOptions: JobLinkOption[]
  openTodos: number
  completedTodos: number
}

const STORAGE_KEY = "rolespec.planner.goals.v1"

function loadGoals(): Goal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Goal[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((g) => typeof g?.label === "string" && typeof g?.target === "number")
  } catch {
    return []
  }
}

const SUGGESTIONS: Omit<Goal, "id">[] = [
  { label: "Applications this week", target: 10, current: 0, jobApplicationId: null },
  { label: "Follow-ups sent", target: 5, current: 0, jobApplicationId: null },
  { label: "Networking outreaches", target: 5, current: 0, jobApplicationId: null },
]

/**
 * Weekly goals linked to jobs. Personal targets persist in localStorage (no
 * schema migration, works offline); progress is nudged with +/-1 and a goal
 * can hang off a tracked application so the planner ties back to the pipeline.
 */
export function GoalsTracker({ jobOptions, openTodos, completedTodos }: GoalsTrackerProps) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [label, setLabel] = useState("")
  const [target, setTarget] = useState("5")
  const [jobId, setJobId] = useState("")
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setGoals(loadGoals())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    // Debounced persist: rapid +/- taps write once, avoiding a synchronous
    // localStorage write (and re-render churn) per click. No waterfall — the
    // in-memory `goals` state updates instantly; only persistence is deferred.
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(goals))
      } catch {
        // Private-mode storage can throw; goals just won't persist.
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [goals, hydrated])

  const jobById = useMemo(() => new Map(jobOptions.map((j) => [j.id, j])), [jobOptions])
  const { totalTarget, totalCurrent } = useMemo(() => ({
    totalTarget: goals.reduce((sum, g) => sum + g.target, 0),
    totalCurrent: goals.reduce((sum, g) => sum + Math.min(g.current, g.target), 0),
  }), [goals])

  function addGoal(preset?: Omit<Goal, "id">) {
    const name = (preset?.label ?? label).trim()
    const parsedTarget = preset ? preset.target : Number.parseInt(target, 10)
    if (!name || !Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      toast.error("Give the goal a name and a target above 0.")
      return
    }
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `goal-${Date.now()}`
    setGoals((current) => [
      ...current,
      {
        id,
        label: name,
        target: parsedTarget,
        current: preset?.current ?? 0,
        jobApplicationId: preset ? preset.jobApplicationId : jobId || null,
      },
    ])
    if (!preset) {
      setLabel("")
      setTarget("5")
      setJobId("")
    }
    toast.success("Goal added")
  }

  function bump(id: string, delta: number) {
    setGoals((current) =>
      current.map((g) =>
        g.id === id ? { ...g, current: Math.max(0, Math.min(g.target + 2, g.current + delta)) } : g
      )
    )
  }

  function remove(id: string) {
    setGoals((current) => current.filter((g) => g.id !== id))
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Week progress</p>
            <p className="text-xs text-muted-foreground">
              {completedTodos} tasks done · {openTodos} open
            </p>
          </div>
          <p className="font-mono text-lg font-bold tabular-nums">
            {totalCurrent}
            <span className="text-sm text-muted-foreground">/{Math.max(totalTarget, 1)}</span>
          </p>
        </div>
        <Progress
          value={totalCurrent}
          max={Math.max(1, totalTarget)}
          label={`Goal progress: ${totalCurrent} of ${totalTarget}`}
          color={totalTarget > 0 && totalCurrent >= totalTarget ? "success" : "brand"}
        />
        {goals.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Button key={s.label} type="button" size="sm" variant="outline" onClick={() => addGoal(s)}>
                <Plus className="h-3.5 w-3.5" />
                {s.label} · {s.target}
              </Button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="goal-label">New goal</Label>
              <Input
                id="goal-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Referrals requested"
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-target">Target</Label>
              <Input
                id="goal-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                inputMode="numeric"
                type="number"
                min={1}
                max={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-job">Linked job (optional)</Label>
              <Select id="goal-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">— none —</option>
                {jobOptions.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.companyName} — {job.jobTitle}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={() => addGoal()}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description="Add a weekly target above, or start from a suggestion."
        />
      ) : (
        <ul className="space-y-2">
          {goals.map((goal) => {
            const linked = goal.jobApplicationId ? jobById.get(goal.jobApplicationId) : undefined
            const done = goal.current >= goal.target
            return (
              <li
                key={goal.id}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{goal.label}</p>
                    {linked ? (
                      <Link
                        href={`/jobs/${linked.id}`}
                        className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-brand-400 hover:underline"
                      >
                        <Briefcase className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {linked.companyName} — {linked.jobTitle}
                        </span>
                      </Link>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted-foreground">No linked job</p>
                    )}
                    <div className="mt-2">
                      <Progress
                        value={goal.current}
                        max={Math.max(1, goal.target)}
                        label={`${goal.label}: ${goal.current} of ${goal.target}`}
                        color={done ? "success" : "brand"}
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Decrease progress on ${goal.label}`}
                      onClick={() => bump(goal.id, -1)}
                    >
                      −
                    </Button>
                    <span className="w-14 text-center font-mono text-sm tabular-nums">
                      {goal.current}/{goal.target}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Increase progress on ${goal.label}`}
                      onClick={() => bump(goal.id, 1)}
                    >
                      +
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      aria-label={`Remove ${goal.label}`}
                      onClick={() => remove(goal.id)}
                    >
                      {done ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
