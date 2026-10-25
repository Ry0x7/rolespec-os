"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  ListChecks,
  Sparkles,
  Target,
} from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { cn } from "@/shared/lib/utils"
import type { AiProvider } from "@/shared/lib/ai-providers/constants"
import { completeOnboarding, saveOnboardingDraft } from "../actions/onboarding.actions"
import {
  configureAndTestAiProvider,
  testSavedAiProvider,
} from "../actions/ai-setup.actions"
import {
  aiSetupGroupById,
  aiSetupGroupForProvider,
  type AiSetupGroupId,
} from "../constants/ai-setup"
import type { AiConnectionTestResult } from "../lib/ai-connection-test"
import type { ProviderDiagnostic } from "../lib/provider-diagnostics"
import { AiSetupPanel } from "./ai-setup-panel"
import { ConnectionResult } from "./connection-result"
import type { ExperienceLevel, GoalPeriod } from "@/generated/prisma/enums"

const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: "JUNIOR", label: "Junior (0-2 years)" },
  { value: "MID", label: "Mid-level (2-5 years)" },
  { value: "SENIOR", label: "Senior (5-10 years)" },
  { value: "LEAD", label: "Lead / Principal (10+ years)" },
  { value: "EXECUTIVE", label: "Executive" },
]

/** Condensed 4-step flow: welcome, AI (setup + inline test), profile, ready. */
const TOTAL_STEPS = 4

const DRAFT_KEY = "rolespec-onboarding-draft-v1"

/** Smart defaults: seniors default to a lighter, higher-signal weekly goal. */
function smartGoalFor(level: ExperienceLevel | ""): { target: string; period: GoalPeriod } {
  switch (level) {
    case "LEAD":
    case "EXECUTIVE":
      return { target: "5", period: "WEEKLY" }
    case "SENIOR":
      return { target: "8", period: "WEEKLY" }
    case "JUNIOR":
      return { target: "10", period: "WEEKLY" }
    default:
      return { target: "10", period: "WEEKLY" }
  }
}

interface OnboardingWizardProps {
  name: string
  currentRole: string
  targetRole: string
  experienceLevel: ExperienceLevel | ""
  applicationGoalTarget: number
  applicationGoalPeriod: GoalPeriod
  savedProvider: AiProvider | null
  savedModel: string | null
  hasSavedKey: boolean
  last4?: string
  diagnostics: Record<AiProvider, ProviderDiagnostic>
  resumeCount: number
}

export function OnboardingWizard({
  name,
  currentRole: initialCurrentRole,
  targetRole: initialTargetRole,
  experienceLevel: initialExperienceLevel,
  applicationGoalTarget: initialGoalTarget,
  applicationGoalPeriod: initialGoalPeriod,
  savedProvider,
  savedModel,
  hasSavedKey,
  last4,
  diagnostics,
  resumeCount,
}: OnboardingWizardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState(1)

  // Restore a locally saved draft once (server props win when non-empty).
  const [hydrated, setHydrated] = useState(false)
  const [currentRole, setCurrentRole] = useState(initialCurrentRole)
  const [targetRole, setTargetRole] = useState(initialTargetRole)
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | "">(
    initialExperienceLevel
  )
  const smart = smartGoalFor(initialExperienceLevel)
  const [goalTarget, setGoalTarget] = useState(
    initialGoalTarget ? String(initialGoalTarget) : smart.target
  )
  const [goalPeriod, setGoalPeriod] = useState<GoalPeriod>(initialGoalPeriod ?? smart.period)

  useEffect(() => {
    if (hydrated) return
    setHydrated(true)
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as Partial<{
        currentRole: string
        targetRole: string
        experienceLevel: ExperienceLevel | ""
        goalTarget: string
        goalPeriod: GoalPeriod
        step: number
      }>
      if (!initialCurrentRole && draft.currentRole) setCurrentRole(draft.currentRole)
      if (!initialTargetRole && draft.targetRole) setTargetRole(draft.targetRole)
      if (!initialExperienceLevel && draft.experienceLevel)
        setExperienceLevel(draft.experienceLevel)
      if (draft.goalTarget) setGoalTarget(draft.goalTarget)
      if (draft.goalPeriod) setGoalPeriod(draft.goalPeriod)
      if (draft.step && draft.step >= 1 && draft.step <= TOTAL_STEPS) setStep(draft.step)
    } catch {
      // Corrupt draft: ignore and continue with server values.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist progress locally on every change so "finish later" resumes instantly.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ currentRole, targetRole, experienceLevel, goalTarget, goalPeriod, step })
      )
    } catch {
      // Storage full or blocked: onboarding still works without it.
    }
  }, [hydrated, currentRole, targetRole, experienceLevel, goalTarget, goalPeriod, step])

  // AI state (step 2: setup + inline test live together)
  const initialGroup: AiSetupGroupId =
    (savedProvider && aiSetupGroupForProvider(savedProvider)) || "chatgpt"
  const [group, setGroup] = useState<AiSetupGroupId>(initialGroup)
  const [provider, setProvider] = useState<AiProvider>(savedProvider ?? "codex-cli")
  const [model, setModel] = useState(() => {
    if (savedProvider !== "opencode-cli") return savedModel ?? ""
    const available = diagnostics["opencode-cli"]?.models ?? []
    return savedModel && available.includes(savedModel)
      ? savedModel
      : available[0] ?? ""
  })
  const [apiKey, setApiKey] = useState("")
  const [aiResult, setAiResult] = useState<AiConnectionTestResult | null>(null)
  const [skippedAi, setSkippedAi] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function goTo(next: number) {
    setStep(next)
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function defaultModelFor(nextProvider: AiProvider): string {
    if (nextProvider === "opencode-cli") {
      return diagnostics["opencode-cli"]?.models?.[0] ?? ""
    }
    return ""
  }

  function handleGroupChange(nextGroup: AiSetupGroupId) {
    setGroup(nextGroup)
    const nextProviders = aiSetupGroupById(nextGroup)?.providers ?? []
    if (!nextProviders.some((option) => option.provider === provider)) {
      const first = nextProviders[0]
      if (first) {
        setProvider(first.provider)
        setModel(defaultModelFor(first.provider))
      }
    }
    setApiKey("")
    setAiResult(null)
    setSaveError(null)
    setSkippedAi(false)
  }

  function handleProviderChange(nextProvider: AiProvider) {
    setProvider(nextProvider)
    setModel(defaultModelFor(nextProvider))
    setApiKey("")
    setAiResult(null)
    setSaveError(null)
    setSkippedAi(false)
  }

  function handleLevelChange(next: ExperienceLevel | "") {
    setExperienceLevel(next)
    // Smart default: only fill the goal when the user hasn't customised it.
    const smartNext = smartGoalFor(next)
    setGoalTarget((prev) => (prev.trim() === "" ? smartNext.target : prev))
    setGoalPeriod((prev) => prev ?? smartNext.period)
  }

  function handleSaveAndTest() {
    startTransition(async () => {
      setSaveError(null)
      const result = await configureAndTestAiProvider({
        provider,
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setApiKey("")
      setSaveError(result.saveError ?? null)
      setSkippedAi(false)
      // Inline: stay on step 2 and render the result under the panel.
      setAiResult(result.test)
    })
  }

  function handleTestAgain() {
    startTransition(async () => {
      const result = await testSavedAiProvider()
      setSkippedAi(false)
      setAiResult(result)
    })
  }

  function handleSkipAi() {
    setSkippedAi(true)
    setAiResult(null)
  }

  function handleSaveDraft() {
    startTransition(async () => {
      const result = await saveOnboardingDraft({
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
      toast.success("Progress saved — come back anytime to finish setup")
      router.push("/dashboard")
    })
  }

  function handleSkipToEnd() {
    // One-click path: complete with smart defaults, AI optional.
    startTransition(async () => {
      const result = await completeOnboarding({
        currentRole: currentRole || undefined,
        targetRole: targetRole || undefined,
        experienceLevel: experienceLevel === "" ? undefined : experienceLevel,
        applicationGoalTarget: Number(goalTarget) || 5,
        applicationGoalPeriod: goalPeriod,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      try {
        window.localStorage.removeItem(DRAFT_KEY)
      } catch {
        // Ignore storage errors on finish.
      }
      router.push("/dashboard")
    })
  }

  function handleFinish() {
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
      try {
        window.localStorage.removeItem(DRAFT_KEY)
      } catch {
        // Ignore storage errors on finish.
      }
      router.push("/dashboard")
    })
  }

  const aiConnected = aiResult?.ok === true

  return (
    <div className="glass rounded-lg p-6 ring-1 ring-border">
      <div className="mb-6 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>First-time setup</span>
          <span aria-live="polite">
            Step {step} of {TOTAL_STEPS}
          </span>
        </div>
        <div
          className="flex items-center gap-1.5"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-valuenow={step}
          aria-label={`Setup step ${step} of ${TOTAL_STEPS}`}
        >
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
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
              <Sparkles className="h-5 w-5 text-brand-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold">Welcome, {name}</h1>
              <p className="text-sm text-muted-foreground">
                About two minutes. Resumes, ATS scoring and tracking in one place.
              </p>
            </div>
          </div>

          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
              <span>Keep resumes in one place and export them in a few clicks.</span>
            </li>
            <li className="flex items-start gap-3">
              <Target className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
              <span>Score a resume against a real job description before you apply.</span>
            </li>
            <li className="flex items-start gap-3">
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
              <span>Track applications, interviews and follow-ups on one board.</span>
            </li>
          </ul>

          <p className="text-xs text-muted-foreground">
            AI is optional — editing and tracking work without it. Every choice can
            change later in Settings.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => goTo(2)} className="w-full sm:w-auto">
              Get started
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" onClick={handleSkipToEnd} disabled={isPending}>
              Skip for now
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <AiSetupPanel
            savedProvider={savedProvider}
            hasSavedKey={hasSavedKey}
            {...(last4 ? { last4 } : {})}
            diagnostics={diagnostics}
            group={group}
            provider={provider}
            model={model}
            apiKey={apiKey}
            onGroupChange={handleGroupChange}
            onProviderChange={handleProviderChange}
            onModelChange={setModel}
            onApiKeyChange={setApiKey}
            onSaveAndTest={handleSaveAndTest}
            onSkip={handleSkipAi}
            pending={isPending}
            saveError={saveError}
            failure={aiResult && !aiResult.ok ? aiResult : null}
          />

          {/* Inline test result: no separate test step needed. */}
          {skippedAi ? (
            <p className="rounded-md border border-amber-600/30 bg-amber-600/5 p-3 text-xs text-muted-foreground">
              AI stays off for now — editing and tracking still work. Tailoring, ATS
              analysis, matching and outreach need a provider later in Settings → AI.
            </p>
          ) : aiResult ? (
            <ConnectionResult
              result={aiResult}
              onRetry={handleTestAgain}
              retrying={isPending}
            />
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => goTo(1)} disabled={isPending}>
              Back
            </Button>
            <Button type="button" onClick={() => goTo(3)} disabled={isPending}>
              Continue{aiConnected ? " with AI" : ""}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" onClick={handleSaveDraft} disabled={isPending}>
              Save & finish later
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            goTo(4)
          }}
        >
          <div>
            <h1 className="text-xl font-bold">Tell us about your search</h1>
            <p className="text-sm text-muted-foreground">
              Optional — pre-filled with a sensible goal. Change anything, or skip.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currentRole">Current role</Label>
            <Input
              id="currentRole"
              name="currentRole"
              placeholder="e.g. Registered Nurse"
              value={currentRole}
              onChange={(e) => setCurrentRole(e.target.value)}
              autoComplete="organization-title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetRole">Target role</Label>
            <Input
              id="targetRole"
              name="targetRole"
              placeholder="e.g. Nurse Manager"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="experienceLevel">Experience level</Label>
            <Select
              id="experienceLevel"
              name="experienceLevel"
              value={experienceLevel}
              onChange={(e) => handleLevelChange(e.target.value as ExperienceLevel | "")}
            >
              <option value="">Select a level (optional)</option>
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
                onChange={(e) => setGoalTarget(e.target.value)}
                className="w-full sm:w-24"
              />
              <Select
                aria-label="Goal period"
                name="applicationGoalPeriod"
                value={goalPeriod}
                onChange={(e) => setGoalPeriod(e.target.value as GoalPeriod)}
                className="flex-1"
              >
                <option value="DAILY">applications per day</option>
                <option value="WEEKLY">applications per week</option>
              </Select>
            </div>
          </div>

          {resumeCount > 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-600/5 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
              <span>
                {resumeCount} resume{resumeCount === 1 ? "" : "s"} already in your workspace.
              </span>
            </p>
          ) : (
            <p className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              No resume yet — add one from the Resume Studio after setup, or continue
              now and do it later.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => goTo(2)}>
              Back
            </Button>
            <Button type="submit">
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" onClick={handleSaveDraft} disabled={isPending}>
              Save & finish later
            </Button>
          </div>
        </form>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">You&apos;re ready</h1>
              <p className="text-sm text-muted-foreground">
                Everything can be changed later in Settings.
              </p>
            </div>
          </div>

          <dl className="divide-y divide-border rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              <dt className="text-sm font-medium">AI</dt>
              <dd className="text-sm text-muted-foreground">
                {skippedAi ? (
                  <Badge variant="warning" size="sm">
                    Not connected — AI features unavailable
                  </Badge>
                ) : aiResult?.ok ? (
                  <span className="flex items-center gap-2">
                    <Badge variant="success" size="sm">
                      Connected
                    </Badge>
                    {aiResult.providerLabel} · {aiResult.model}
                  </span>
                ) : (
                  <Badge variant="warning" size="sm">
                    Saved, not tested
                  </Badge>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              <dt className="text-sm font-medium">Profile</dt>
              <dd className="text-sm text-muted-foreground">
                {currentRole.trim() || targetRole.trim()
                  ? [currentRole.trim(), targetRole.trim()].filter(Boolean).join(" → ")
                  : "Skipped"}
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              <dt className="text-sm font-medium">Resume</dt>
              <dd className="text-sm text-muted-foreground">
                {resumeCount > 0
                  ? `${resumeCount} in your workspace`
                  : "Add one when you are ready"}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleFinish} loading={isPending}>
              {isPending ? "Opening RoleSpec..." : "Open RoleSpec"}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => goTo(3)}
              disabled={isPending}
            >
              Back
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            AI settings live under Settings → AI. Resumes are in the Resume Studio.
          </p>
        </div>
      )}
    </div>
  )
}
