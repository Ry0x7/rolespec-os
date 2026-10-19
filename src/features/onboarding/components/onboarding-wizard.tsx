"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  ListChecks,
  Lock,
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
import { completeOnboarding } from "../actions/onboarding.actions"
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

const TOTAL_STEPS = 7

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

  // Profile (step 5)
  const [currentRole, setCurrentRole] = useState(initialCurrentRole)
  const [targetRole, setTargetRole] = useState(initialTargetRole)
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | "">(
    initialExperienceLevel
  )
  const [goalTarget, setGoalTarget] = useState(String(initialGoalTarget))
  const [goalPeriod, setGoalPeriod] = useState<GoalPeriod>(initialGoalPeriod)

  // AI (steps 3-4)
  const initialGroup: AiSetupGroupId =
    (savedProvider && aiSetupGroupForProvider(savedProvider)) || "chatgpt"
  const [group, setGroup] = useState<AiSetupGroupId>(initialGroup)
  const [provider, setProvider] = useState<AiProvider>(savedProvider ?? "codex-cli")
  const [model, setModel] = useState(savedModel ?? "")
  const [apiKey, setApiKey] = useState("")
  const [aiResult, setAiResult] = useState<AiConnectionTestResult | null>(null)
  const [skippedAi, setSkippedAi] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function goTo(next: number) {
    setStep(next)
    // The setup panel is the only long step; start it at the top.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function handleGroupChange(nextGroup: AiSetupGroupId) {
    setGroup(nextGroup)
    const nextProviders = aiSetupGroupById(nextGroup)?.providers ?? []
    if (!nextProviders.some((option) => option.provider === provider)) {
      const first = nextProviders[0]
      if (first) setProvider(first.provider)
    }
    setApiKey("")
    setAiResult(null)
    setSaveError(null)
    setSkippedAi(false)
  }

  function handleProviderChange(nextProvider: AiProvider) {
    setProvider(nextProvider)
    setApiKey("")
    setAiResult(null)
    setSaveError(null)
    setSkippedAi(false)
  }

  function handleSaveAndTest() {
    startTransition(async () => {
      setSaveError(null)
      const result = await configureAndTestAiProvider({
        provider,
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      // Drop the plaintext key from component state as soon as it has been
      // handed to the server action.
      setApiKey("")
      setSaveError(result.saveError ?? null)
      setSkippedAi(false)
      setAiResult(result.test)
      goTo(4)
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
    goTo(4)
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
      router.push("/dashboard")
    })
  }

  const selectedGroupLabel = aiSetupGroupById(group)?.label ?? "AI"
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
                Let&apos;s get RoleSpec ready. This takes about five minutes.
              </p>
            </div>
          </div>

          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
              <span>Keep your resumes in one place and export them in a few clicks.</span>
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
            You can change every choice later in Settings.
          </p>

          <Button type="button" onClick={() => goTo(2)} className="w-full sm:w-auto">
            Get started
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-bold">What RoleSpec does</h1>
            <p className="text-sm text-muted-foreground">
              One workspace for the whole job hunt: get ready, apply, then follow up.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["Resumes", "Build, tailor and export ATS-friendly resumes."],
              ["ATS analysis", "See the score and the changes that would improve it."],
              ["Job tracking", "Move each opportunity through your own pipeline."],
              ["Outreach", "Draft cover letters and follow-up emails from your own evidence."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border border-amber-600/30 bg-amber-600/5 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              AI is required for the AI-powered features
            </p>
            <p className="text-sm text-muted-foreground">
              RoleSpec is not an AI-free app. Resume import from PDF/DOCX, tailoring,
              ATS analysis, job matching, cover letters and outreach all use AI. You
              will choose a provider in the next step. Resume editing and application
              tracking work without one.
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="h-4 w-4 text-brand-400" />
              Your data stays yours
            </p>
            <p className="text-sm text-muted-foreground">
              Resumes, applications and notes are stored in your own RoleSpec
              database. When you use an AI feature, only the text needed for that
              request is sent to the provider you choose. Saved API keys are
              encrypted before they are stored. RoleSpec has no analytics or
              telemetry.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => goTo(1)}>
              Back
            </Button>
            <Button type="button" onClick={() => goTo(3)}>
              Choose AI
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
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
          <Button
            type="button"
            variant="ghost"
            onClick={() => goTo(2)}
            disabled={isPending}
          >
            Back
          </Button>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-bold">Test the connection</h1>
            <p className="text-sm text-muted-foreground">
              Every real AI feature goes through this same path, so a passing test
              means tailoring, scoring and matching can run.
            </p>
          </div>

          {skippedAi ? (
            <div className="space-y-3 rounded-lg border border-amber-600/30 bg-amber-600/5 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                AI features are off for now
              </p>
              <p className="text-sm text-muted-foreground">
                You can still edit resumes and track applications. These stay
                unavailable until you connect a provider:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Resume import from PDF or DOCX</li>
                <li>Resume tailoring, enhancement and ATS analysis</li>
                <li>Job matching, cover letters and outreach drafts</li>
                <li>LinkedIn, portfolio and job-risk analysis</li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => goTo(3)}>
                  Set up AI now
                </Button>
                <Button type="button" variant="secondary" onClick={() => goTo(5)}>
                  Continue without AI
                </Button>
              </div>
            </div>
          ) : aiResult ? (
            <>
              <ConnectionResult
                result={aiResult}
                onRetry={handleTestAgain}
                retrying={isPending}
              />
              <div className="flex flex-wrap gap-2">
                {aiConnected ? (
                  <Button type="button" onClick={() => goTo(5)}>
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="button" onClick={() => goTo(3)}>
                    Back to AI setup
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => goTo(3)}
                  disabled={isPending}
                >
                  Change option
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-sm font-medium">No test has run yet.</p>
              <p className="text-sm text-muted-foreground">
                Save and test the selected option to check that{" "}
                {selectedGroupLabel} can answer.
              </p>
              <Button type="button" onClick={handleTestAgain} loading={isPending}>
                {isPending ? "Testing the connection..." : "Test connection"}
              </Button>
            </div>
          )}

          <Button type="button" variant="ghost" onClick={() => goTo(3)} disabled={isPending}>
            Back
          </Button>
        </div>
      )}

      {step === 5 && (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            goTo(6)
          }}
        >
          <div>
            <h1 className="text-xl font-bold">Tell us about your search</h1>
            <p className="text-sm text-muted-foreground">
              Optional, but it helps tailor your resumes and job matches. You can
              change it later.
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
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="experienceLevel">Experience level</Label>
            <Select
              id="experienceLevel"
              name="experienceLevel"
              value={experienceLevel}
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

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => goTo(4)}>
              Back
            </Button>
            <Button type="submit">
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </form>
      )}

      {step === 6 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-bold">Add your resume</h1>
            <p className="text-sm text-muted-foreground">
              Start with the resume you already have, or create one from scratch. The
              Resume Studio opens in a new tab so this setup stays where it is.
            </p>
          </div>

          {resumeCount > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-600/5 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
              <span>
                {resumeCount} resume{resumeCount === 1 ? "" : "s"} found in your workspace.
              </span>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              No resumes yet. That is fine — you can add one after setup.
            </div>
          )}

          {!aiConnected && !skippedAi ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Importing a PDF or DOCX uses AI to read the file. If AI is not
              connected, create a resume manually instead.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <a
              href="/resumes"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
            >
              Open Resume Studio
              <ArrowRight className="h-4 w-4" />
            </a>
            <Button type="button" variant="ghost" onClick={() => router.refresh()}>
              Check again
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Upload Resume and Create Resume are both on that page. Come back here
            when you are done, or continue and add it later.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => goTo(5)}>
              Back
            </Button>
            <Button type="button" onClick={() => goTo(7)}>
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 7 && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">You&apos;re ready</h1>
              <p className="text-sm text-muted-foreground">
                Here is what RoleSpec will use. Everything can be changed later.
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

          <Button type="button" onClick={handleFinish} loading={isPending}>
            {isPending ? "Opening RoleSpec..." : "Open RoleSpec"}
            <ArrowRight className="h-4 w-4" />
          </Button>

          <p className="text-xs text-muted-foreground">
            AI settings live under Settings → AI. Your resume and applications are
            already saved in your own workspace.
          </p>

          <Button
            type="button"
            variant="ghost"
            onClick={() => goTo(6)}
            disabled={isPending}
          >
            Back
          </Button>
        </div>
      )}

    </div>
  )
}
