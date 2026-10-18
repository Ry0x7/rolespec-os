"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { FileText, ListChecks, Sparkles, Target } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { cn } from "@/shared/lib/utils"
import { completeOnboarding } from "../actions/onboarding.actions"
import type { ExperienceLevel, GoalPeriod } from "@/generated/prisma/enums"

const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: "JUNIOR", label: "Junior (0-2 years)" },
  { value: "MID", label: "Mid-level (2-5 years)" },
  { value: "SENIOR", label: "Senior (5-10 years)" },
  { value: "LEAD", label: "Lead / Principal (10+ years)" },
  { value: "EXECUTIVE", label: "Executive" },
]

const TOTAL_STEPS = 2

interface OnboardingWizardProps {
  name: string
  currentRole: string
  targetRole: string
  experienceLevel: ExperienceLevel | ""
  applicationGoalTarget: number
  applicationGoalPeriod: GoalPeriod
}

export function OnboardingWizard({
  name,
  currentRole: initialCurrentRole,
  targetRole: initialTargetRole,
  experienceLevel: initialExperienceLevel,
  applicationGoalTarget: initialGoalTarget,
  applicationGoalPeriod: initialGoalPeriod,
}: OnboardingWizardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState(1)

  const [currentRole, setCurrentRole] = useState(initialCurrentRole)
  const [targetRole, setTargetRole] = useState(initialTargetRole)
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | "">(
    initialExperienceLevel
  )
  const [goalTarget, setGoalTarget] = useState(String(initialGoalTarget))
  const [goalPeriod, setGoalPeriod] = useState<GoalPeriod>(initialGoalPeriod)

  function handleProfileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const result = await completeOnboarding({
        currentRole,
        targetRole,
        experienceLevel: experienceLevel === "" ? undefined : experienceLevel,
        applicationGoalTarget: Number(goalTarget) || undefined,
        applicationGoalPeriod: goalPeriod,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Profile saved")
      router.push("/dashboard")
    })
  }

  function handleSkip() {
    startTransition(async () => {
      const result = await completeOnboarding({})
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.push("/dashboard")
    })
  }

  return (
    <div className="glass rounded-lg p-6 ring-1 ring-border">
      <div className="mb-6 flex items-center gap-2" aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              n <= step ? "bg-brand-600" : "bg-muted"
            )}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
              <Sparkles className="h-5 w-5 text-brand-400" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">Welcome, {name}</h1>
              <p className="text-sm text-muted-foreground">
                RoleSpec keeps your whole job hunt in one place.
              </p>
            </div>
          </div>

          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
              <span>Build ATS-ready resumes and export them in a few clicks.</span>
            </li>
            <li className="flex items-start gap-3">
              <Target className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
              <span>Score every resume against the job description before you apply.</span>
            </li>
            <li className="flex items-start gap-3">
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
              <span>Track applications, interviews, and follow-ups on one board.</span>
            </li>
          </ul>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <Button
              type="button"
              onClick={() => setStep(2)}
              disabled={isPending}
              className="w-full sm:w-auto"
            >
              Continue
            </Button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={isPending}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={handleProfileSubmit} className="space-y-5">
          <div>
            <h1 className="text-xl font-bold">Set up your profile</h1>
            <p className="text-sm text-muted-foreground">
              This helps tailor your resumes and job matches.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currentRole">Current role</Label>
            <Input
              id="currentRole"
              name="currentRole"
              placeholder="e.g. Registered Nurse"
              value={currentRole}
              disabled={isPending}
              onChange={(e) => setCurrentRole(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetRole">Target role</Label>
            <Input
              id="targetRole"
              name="targetRole"
              placeholder="e.g. Nurse Manager"
              value={targetRole}
              disabled={isPending}
              onChange={(e) => setTargetRole(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="experienceLevel">Experience level</Label>
            <Select
              id="experienceLevel"
              name="experienceLevel"
              value={experienceLevel}
              disabled={isPending}
              onChange={(e) => setExperienceLevel(e.target.value as ExperienceLevel | "")}
            >
              <option value="">Select a level</option>
              {EXPERIENCE_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="applicationGoalTarget">Application goal</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="applicationGoalTarget"
                name="applicationGoalTarget"
                type="number"
                min={1}
                max={200}
                value={goalTarget}
                disabled={isPending}
                onChange={(e) => setGoalTarget(e.target.value)}
                className="w-full sm:w-24"
              />
              <Select
                aria-label="Goal period"
                name="applicationGoalPeriod"
                value={goalPeriod}
                disabled={isPending}
                onChange={(e) => setGoalPeriod(e.target.value as GoalPeriod)}
                className="flex-1"
              >
                <option value="DAILY">applications per day</option>
                <option value="WEEKLY">applications per week</option>
              </Select>
            </div>
          </div>

          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            One more thing: AI features (resume enhancement, job matching, email
            drafting) run on your own API key. RoleSpec is free during the beta —
            add an OpenAI, Anthropic, DeepSeek, or Google key on the{" "}
            <Link
              href="/settings/ai"
              className="font-medium text-brand-400 underline-offset-4 hover:underline"
            >
              AI settings page
            </Link>{" "}
            whenever you are ready.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep(1)}
                disabled={isPending}
                className="w-full sm:w-auto"
              >
                Back
              </Button>
              <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
                {isPending ? "Saving..." : "Save and continue"}
              </Button>
            </div>
            <button
              type="button"
              onClick={handleSkip}
              disabled={isPending}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Skip for now
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
