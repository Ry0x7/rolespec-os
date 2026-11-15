import { useMemo } from "react"
import { Flame, Target } from "lucide-react"
import { Card } from "@/shared/ui/card"
import { Progress } from "@/shared/ui/progress"

interface StreakCardProps {
  /** Consecutive days with at least one application or completed task. */
  streakDays: number
  appliedToday: number
  dailyGoal: number
  appliedThisWeek: number
  weeklyGoal: number
}

/**
 * Momentum at a glance: streak + daily/weekly progress. All numbers are
 * computed server-side; this card only renders them so streak math stays in
 * one testable service.
 */
export function StreakCard({
  streakDays,
  appliedToday,
  dailyGoal,
  appliedThisWeek,
  weeklyGoal,
}: StreakCardProps) {
  const dailyMet = dailyGoal > 0 && appliedToday >= dailyGoal
  const weeklyPct = useMemo(
    () =>
      weeklyGoal > 0 ? Math.min(100, Math.round((appliedThisWeek / weeklyGoal) * 100)) : 0,
    [appliedThisWeek, weeklyGoal]
  )

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className={
            streakDays > 0
              ? "flex h-10 w-10 items-center justify-center rounded-md bg-amber-500/10"
              : "flex h-10 w-10 items-center justify-center rounded-md bg-muted"
          }
        >
          <Flame
            className={streakDays > 0 ? "h-5 w-5 text-amber-400" : "h-5 w-5 text-muted-foreground"}
            aria-hidden="true"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {streakDays === 0
              ? "No streak yet"
              : `${streakDays}-day streak`}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {dailyMet
              ? "Daily goal reached — streak protected."
              : `Apply ${Math.max(0, dailyGoal - appliedToday)} more today to keep it alive.`}
          </p>
        </div>
        <p className="font-mono text-2xl font-bold tabular-nums">
          {appliedToday}
          <span className="text-base text-muted-foreground">/{dailyGoal}</span>
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            This week: {appliedThisWeek}/{weeklyGoal}
          </span>
          <span className="font-mono tabular-nums">{weeklyPct}%</span>
        </div>
        <Progress
          value={appliedThisWeek}
          max={Math.max(1, weeklyGoal)}
          label={`Weekly applications: ${appliedThisWeek} of ${weeklyGoal}`}
          color={appliedThisWeek >= weeklyGoal && weeklyGoal > 0 ? "success" : "brand"}
        />
      </div>
    </Card>
  )
}
