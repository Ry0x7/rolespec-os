"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Plus, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Progress } from "@/shared/ui/progress"
import { Select } from "@/shared/ui/select"
import { SuggestInput } from "@/shared/ui/suggest-input"
import { Textarea } from "@/shared/ui/textarea"
import { spring, variants } from "@/shared/lib/animations"
import { cn } from "@/shared/lib/utils"
import { createCapabilities, deleteCapability } from "../../actions/career-capability.actions"
import { createEvidence, deleteEvidence } from "../../actions/career-evidence.actions"
import {
  createTargetRole,
  deleteTargetRole,
  updateCareerPreferences,
} from "../../actions/career-profile.actions"
import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_KIND_ORDER,
  EXPERIENCE_LEVEL_LABELS,
  isLegacyWorkAuthorization,
  SALARY_PERIOD_LABELS,
  WORK_AUTHORIZATION_OPTIONS,
  WORK_MODE_LABELS,
  summarizeCapabilitiesAdded,
} from "../../constants/labels"
import { LocationMultiSelect } from "../location-multi-select"
import {
  CAPABILITY_NAME_SUGGESTIONS,
  TARGET_ROLE_SUGGESTIONS,
  mergeSuggestions,
} from "../../constants/suggestions"
import type { CareerPreferencesValues } from "../../types"

const WORK_MODE_VALUES = ["REMOTE", "HYBRID", "ONSITE"] as const
const EXPERIENCE_LEVEL_VALUES = ["JUNIOR", "MID", "SENIOR", "LEAD", "EXECUTIVE"] as const
const SALARY_PERIOD_VALUES = ["HOURLY", "MONTHLY", "YEARLY"] as const
const SALARY_CURRENCY_VALUES = ["USD", "PHP"] as const

/** Blurbs under each experience option — plain language, not job titles. */
const EXPERIENCE_LEVEL_HINTS: Record<(typeof EXPERIENCE_LEVEL_VALUES)[number], string> = {
  JUNIOR: "Starting out, roughly 0-2 years in the field.",
  MID: "Comfortable working independently, roughly 2-5 years.",
  SENIOR: "You own scope and mentor others, roughly 5-10 years.",
  LEAD: "You set direction for a team or a domain.",
  EXECUTIVE: "You are accountable for an org or a business line.",
}

/**
 * The wizard is a linear sequence, so the step order lives in one array and
 * everything else (progress, counter, back/next) is derived from the index.
 */
const STEPS = [
  "welcome",
  "experience",
  "roles",
  "work",
  "authorization",
  "salary",
  "goals",
  "evidence",
  "skills",
  "done",
] as const

type StepId = (typeof STEPS)[number]

/** Steps whose answers are stored by `updateCareerPreferences`. */
const PREFERENCE_STEPS = new Set<StepId>([
  "experience",
  "work",
  "authorization",
  "salary",
  "goals",
])

/** Mirrors what the fields submit, exactly like the classic preferences form. */
interface PreferencesDraft {
  experienceLevel: string
  locations: string
  openToRelocation: boolean
  workModes: string[]
  workAuthorization: string
  requiresSponsorship: string
  salaryMin: string
  salaryMax: string
  salaryPeriod: string
  salaryCurrency: string
  careerGoals: string
}

function toDraft(values: CareerPreferencesValues): PreferencesDraft {
  return {
    experienceLevel: values.experienceLevel ?? "",
    locations: values.locations.join("\n"),
    openToRelocation: values.openToRelocation,
    workModes: values.workModes,
    workAuthorization: values.workAuthorization ?? "",
    requiresSponsorship:
      values.requiresSponsorship === null ? "" : values.requiresSponsorship ? "yes" : "no",
    salaryMin: values.salaryMin === null ? "" : String(values.salaryMin),
    salaryMax: values.salaryMax === null ? "" : String(values.salaryMax),
    salaryPeriod: values.salaryPeriod ?? "",
    salaryCurrency: values.salaryCurrency,
    careerGoals: values.careerGoals ?? "",
  }
}

/**
 * `updateCareerPreferences` replaces every preference column on each call, so a
 * per-step save must submit the whole merged draft — otherwise finishing step 2
 * would wipe the answers given on steps 4-7.
 */
function toFormData(draft: PreferencesDraft): FormData {
  const formData = new FormData()
  formData.set("experienceLevel", draft.experienceLevel)
  formData.set("locations", draft.locations)
  // The schema reads "on"/"true" as yes; anything absent means no.
  if (draft.openToRelocation) formData.set("openToRelocation", "true")
  for (const mode of draft.workModes) formData.append("workModes", mode)
  formData.set("workAuthorization", draft.workAuthorization)
  formData.set("requiresSponsorship", draft.requiresSponsorship)
  formData.set("salaryMin", draft.salaryMin)
  formData.set("salaryMax", draft.salaryMax)
  formData.set("salaryPeriod", draft.salaryPeriod)
  formData.set("salaryCurrency", draft.salaryCurrency)
  formData.set("careerGoals", draft.careerGoals)
  return formData
}

interface WizardTargetRole {
  id: string
  title: string
}

interface WizardEvidence {
  id: string
  kind: keyof typeof EVIDENCE_KIND_LABELS
  title: string
  organization: string | null
}

interface WizardCapability {
  id: string
  name: string
}

interface CareerSetupWizardProps {
  preferences: CareerPreferencesValues
  targetRoles: WizardTargetRole[]
  evidence: WizardEvidence[]
  capabilities: WizardCapability[]
  /** True when the URL already carries `?setup=1`. */
  pinned: boolean
  /**
   * Where "exit" lands. A profile that still looks empty would be sent straight
   * back into the wizard by `needsSetup`, so the page hands over an explicit
   * `?setup=0` in that case; once there is something to show it is the bare
   * path.
   */
  exitHref: string
}

export function CareerSetupWizard({
  preferences,
  targetRoles,
  evidence,
  capabilities,
  pinned,
  exitHref,
}: CareerSetupWizardProps) {
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const [isPending, startTransition] = useTransition()
  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState<PreferencesDraft>(() => toDraft(preferences))
  const [pendingId, setPendingId] = useState<string | null>(null)
  const roleFormRef = useRef<HTMLFormElement>(null)
  const evidenceFormRef = useRef<HTMLFormElement>(null)
  const skillFormRef = useRef<HTMLFormElement>(null)

  const step = STEPS[index]
  const total = STEPS.length

  /*
    Saving a preference clears `needsSetup` on the server, and the revalidation
    that follows would swap the wizard out for the card view mid-flow. Pinning
    `?setup=1` up front makes the wizard the answer regardless of what the
    profile now looks like. `replace` keeps it out of the back stack.
  */
  useEffect(() => {
    if (!pinned) router.replace("/career-profile?setup=1")
  }, [pinned, router])

  function updateDraft<K extends keyof PreferencesDraft>(key: K, value: PreferencesDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function toggleWorkMode(mode: string, checked: boolean) {
    setDraft((current) => ({
      ...current,
      workModes: checked
        ? [...current.workModes, mode]
        : current.workModes.filter((m) => m !== mode),
    }))
  }

  function goTo(next: number) {
    setIndex(Math.min(Math.max(next, 0), total - 1))
  }

  /** Continue: preference steps persist the full merged draft before advancing. */
  function handleContinue() {
    if (!PREFERENCE_STEPS.has(step)) {
      goTo(index + 1)
      return
    }
    startTransition(async () => {
      const result = await updateCareerPreferences(toFormData(draft))
      if (result?.error) {
        toast.error(result.error)
        return
      }
      goTo(index + 1)
    })
  }

  /** Skip never writes — it just moves on. */
  function handleSkip() {
    goTo(index + 1)
  }

  function handleExit() {
    router.replace(exitHref)
    router.refresh()
  }

  /** The natural next step after a profile exists: turn it into a master resume. */
  function handleBuildResume() {
    router.replace("/resumes")
    router.refresh()
  }

  async function handleAddRole(formData: FormData) {
    const result = await createTargetRole(formData)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    roleFormRef.current?.reset()
    router.refresh()
  }

  async function handleAddEvidence(formData: FormData) {
    const result = await createEvidence(formData)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    evidenceFormRef.current?.reset()
    router.refresh()
  }

  async function handleAddSkill(formData: FormData) {
    const result = await createCapabilities(formData)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    skillFormRef.current?.reset()
    toast.success(summarizeCapabilitiesAdded(result.created, result.skipped))
    router.refresh()
  }

  async function handleRemove(id: string, fn: () => Promise<{ error?: string }>) {
    setPendingId(id)
    const result = await fn()
    setPendingId(null)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    router.refresh()
  }

  const roleSuggestions = mergeSuggestions([], TARGET_ROLE_SUGGESTIONS).filter(
    (title) => !targetRoles.some((role) => role.title.toLowerCase() === title.toLowerCase())
  )
  const skillSuggestions = mergeSuggestions([], CAPABILITY_NAME_SUGGESTIONS).filter(
    (name) => !capabilities.some((c) => c.name.toLowerCase() === name.toLowerCase())
  )

  const stepVariant = reduceMotion ? variants.fadeIn : variants.slideUp
  const stepTransition = reduceMotion ? { duration: 0 } : spring.gentle

  return (
    <div className="mx-auto w-full max-w-2xl">
      {step !== "welcome" && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Step {index + 1} of {total}
            </span>
            <button
              type="button"
              onClick={handleExit}
              disabled={isPending}
              className="underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Exit setup
            </button>
          </div>
          <Progress value={index} max={total - 1} label="Setup progress" />
        </div>
      )}

      <div className="glass rounded-lg p-6 ring-1 ring-border">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={stepVariant.initial}
            animate={stepVariant.animate}
            exit={stepVariant.exit}
            transition={stepTransition}
            className="space-y-6"
          >
            {step === "welcome" && (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Sparkles className="h-5 w-5 text-brand-400" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="font-display text-xl font-bold">
                      Let&apos;s set up your career profile
                    </h1>
                    <p className="text-sm text-muted-foreground">Takes about 3 minutes.</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  A few short questions about where you want to go and what you have
                  actually done. Every answer is optional, nothing is shared, and you can
                  change any of it later on the profile page.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <Button
                    type="button"
                    onClick={() => goTo(1)}
                    disabled={isPending}
                    className="w-full sm:w-auto"
                  >
                    Start
                  </Button>
                  <button
                    type="button"
                    onClick={handleExit}
                    disabled={isPending}
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    Skip — I&apos;ll fill it in myself
                  </button>
                </div>
              </div>
            )}

            {step === "experience" && (
              <StepBody
                title="Where are you in your career?"
                description="This shapes how your resumes are pitched. Pick the closest fit."
              >
                <div className="grid gap-2">
                  {EXPERIENCE_LEVEL_VALUES.map((level) => {
                    const selected = draft.experienceLevel === level
                    return (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={selected}
                        disabled={isPending}
                        onClick={() =>
                          updateDraft("experienceLevel", selected ? "" : level)
                        }
                        className={cn(
                          "rounded-md border p-4 text-left transition-colors disabled:opacity-50",
                          selected
                            ? "border-brand-500 bg-brand-500/10"
                            : "border-border bg-muted/40 hover:bg-muted"
                        )}
                      >
                        <span className="block text-sm font-medium text-foreground">
                          {EXPERIENCE_LEVEL_LABELS[level]}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {EXPERIENCE_LEVEL_HINTS[level]}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </StepBody>
            )}

            {step === "roles" && (
              <StepBody
                title="What roles are you aiming for?"
                description="Add as many as you are genuinely targeting. They are saved as you add them."
              >
                <form ref={roleFormRef} action={handleAddRole} className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="setup-role-title" className="sr-only">
                      Target role
                    </Label>
                    <SuggestInput
                      id="setup-role-title"
                      name="title"
                      required
                      maxLength={200}
                      placeholder="e.g. Product Designer"
                      suggestions={roleSuggestions}
                    />
                  </div>
                  <Button type="submit" variant="secondary">
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </form>

                {targetRoles.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {targetRoles.map((role) => (
                      <Badge key={role.id} variant="brand" className="gap-1.5 py-1">
                        {role.title}
                        <button
                          type="button"
                          aria-label={`Remove ${role.title}`}
                          disabled={pendingId === role.id}
                          onClick={() =>
                            handleRemove(role.id, () => deleteTargetRole(role.id))
                          }
                          className="text-brand-300/70 hover:text-brand-200 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No roles added yet.</p>
                )}
              </StepBody>
            )}

            {step === "work" && (
              <StepBody
                title="How do you want to work?"
                description="Used to filter and score the jobs you save."
              >
                <div className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Work modes</span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {WORK_MODE_VALUES.map((mode) => {
                      const selected = draft.workModes.includes(mode)
                      return (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={selected}
                          disabled={isPending}
                          onClick={() => toggleWorkMode(mode, !selected)}
                          className={cn(
                            "rounded-md border px-4 py-3 text-sm transition-colors disabled:opacity-50",
                            selected
                              ? "border-brand-500 bg-brand-500/10 text-foreground"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {WORK_MODE_LABELS[mode]}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setup-locations">Preferred locations</Label>
                  <LocationMultiSelect
                    id="setup-locations"
                    value={draft.locations.split("\n").filter((line) => line.length > 0)}
                    disabled={isPending}
                    onChange={(next) => updateDraft("locations", next.join("\n"))}
                  />
                  <p className="text-xs text-muted-foreground">Pick as many as apply.</p>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.openToRelocation}
                    disabled={isPending}
                    onChange={(e) => updateDraft("openToRelocation", e.target.checked)}
                    className="h-4 w-4 rounded border-border bg-muted accent-brand-600"
                  />
                  I am open to relocating
                </label>
              </StepBody>
            )}

            {step === "authorization" && (
              <StepBody
                title="Where are you allowed to work?"
                description="Pick the closest match. This is never shared without your say-so."
              >
                <div className="space-y-2">
                  <Label htmlFor="setup-work-auth">Work authorization</Label>
                  <Select
                    id="setup-work-auth"
                    value={draft.workAuthorization}
                    disabled={isPending}
                    onChange={(e) => updateDraft("workAuthorization", e.target.value)}
                  >
                    {WORK_AUTHORIZATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    {/* An older free-text answer stays selectable instead of vanishing. */}
                    {isLegacyWorkAuthorization(preferences.workAuthorization) && (
                      <option value={preferences.workAuthorization}>
                        {preferences.workAuthorization}
                      </option>
                    )}
                  </Select>
                </div>

                <div className="space-y-2">
                  <span className="text-sm font-medium text-foreground">
                    Would you need visa sponsorship?
                  </span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "", label: "Prefer not to answer" },
                    ].map((option) => {
                      const selected = draft.requiresSponsorship === option.value
                      return (
                        <button
                          key={option.label}
                          type="button"
                          aria-pressed={selected}
                          disabled={isPending}
                          onClick={() => updateDraft("requiresSponsorship", option.value)}
                          className={cn(
                            "rounded-md border px-4 py-3 text-sm transition-colors disabled:opacity-50",
                            selected
                              ? "border-brand-500 bg-brand-500/10 text-foreground"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </StepBody>
            )}

            {step === "salary" && (
              <StepBody
                title="What are you hoping to earn?"
                description="Entirely optional. Leave it blank if you would rather not say."
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="setup-salary-min">Minimum</Label>
                    <Input
                      id="setup-salary-min"
                      type="number"
                      min={1}
                      value={draft.salaryMin}
                      disabled={isPending}
                      onChange={(e) => updateDraft("salaryMin", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="setup-salary-max">Maximum</Label>
                    <Input
                      id="setup-salary-max"
                      type="number"
                      min={1}
                      value={draft.salaryMax}
                      disabled={isPending}
                      onChange={(e) => updateDraft("salaryMax", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="setup-salary-period">Period</Label>
                    <Select
                      id="setup-salary-period"
                      value={draft.salaryPeriod}
                      disabled={isPending}
                      onChange={(e) => updateDraft("salaryPeriod", e.target.value)}
                    >
                      <option value="">— not set —</option>
                      {SALARY_PERIOD_VALUES.map((period) => (
                        <option key={period} value={period}>
                          {SALARY_PERIOD_LABELS[period]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="setup-salary-currency">Currency</Label>
                    <Select
                      id="setup-salary-currency"
                      value={draft.salaryCurrency}
                      disabled={isPending}
                      onChange={(e) => updateDraft("salaryCurrency", e.target.value)}
                    >
                      {SALARY_CURRENCY_VALUES.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </StepBody>
            )}

            {step === "goals" && (
              <StepBody
                title="Where do you want to be in a year or two?"
                description="A sentence or two is plenty. This is your direction, not a promise."
              >
                <div className="space-y-2">
                  <Label htmlFor="setup-goals" className="sr-only">
                    Career goals
                  </Label>
                  <Textarea
                    id="setup-goals"
                    rows={5}
                    maxLength={5000}
                    placeholder="e.g. Move from individual contributor into leading a small product team, staying hands-on."
                    value={draft.careerGoals}
                    disabled={isPending}
                    onChange={(e) => updateDraft("careerGoals", e.target.value)}
                  />
                </div>
              </StepBody>
            )}

            {step === "evidence" && (
              <StepBody
                title="What have you actually done?"
                description="Add a role, project, or qualification or two. You can add the rest later."
              >
                <p className="text-xs text-muted-foreground">
                  Evidence is a durable fact about something you have really done — a
                  job, a project, a degree or a certification — and it is what
                  everything else in RoleSpec is checked against.
                </p>

                <form ref={evidenceFormRef} action={handleAddEvidence} className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="setup-evidence-kind">Type</Label>
                      <Select
                        id="setup-evidence-kind"
                        name="kind"
                        defaultValue="EXPERIENCE"
                      >
                        {EVIDENCE_KIND_ORDER.map((kind) => (
                          <option key={kind} value={kind}>
                            {EVIDENCE_KIND_LABELS[kind]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="setup-evidence-title">Title</Label>
                      <Input
                        id="setup-evidence-title"
                        name="title"
                        required
                        maxLength={200}
                        placeholder="e.g. Frontend Engineer"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="setup-evidence-organization">Organization</Label>
                      <Input
                        id="setup-evidence-organization"
                        name="organization"
                        maxLength={200}
                        placeholder="e.g. Acme Inc."
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="setup-evidence-start">Start date</Label>
                      <Input id="setup-evidence-start" name="startDate" type="date" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="setup-evidence-end">End date</Label>
                      <Input id="setup-evidence-end" name="endDate" type="date" />
                      <p className="text-xs text-muted-foreground">Leave empty if ongoing.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="setup-evidence-details">Details</Label>
                    <Textarea
                      id="setup-evidence-details"
                      name="details"
                      rows={3}
                      maxLength={5000}
                      placeholder="What did you actually do? Tools, scope, responsibilities."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="setup-evidence-outcome">Measurable outcome</Label>
                    <Textarea
                      id="setup-evidence-outcome"
                      name="outcome"
                      rows={2}
                      maxLength={2000}
                      placeholder="Anything you can measure — e.g. cut checkout drop-off by 18%."
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" variant="secondary">
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </div>
                </form>

                {evidence.length > 0 ? (
                  <ul className="space-y-2">
                    {evidence.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{item.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {EVIDENCE_KIND_LABELS[item.kind]}
                            {item.organization ? ` · ${item.organization}` : ""}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${item.title}`}
                          disabled={pendingId === item.id}
                          onClick={() =>
                            handleRemove(item.id, () => deleteEvidence(item.id))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">Nothing added yet.</p>
                )}
              </StepBody>
            )}

            {step === "skills" && (
              <StepBody
                title="What are you good at?"
                description="Add the skills you would be happy to be tested on."
              >
                <form ref={skillFormRef} action={handleAddSkill} className="space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Label htmlFor="setup-skill-name" className="sr-only">
                        Skills
                      </Label>
                      <SuggestInput
                        id="setup-skill-name"
                        name="names"
                        multiple
                        required
                        maxLength={2000}
                        placeholder="e.g. Stakeholder Management, Roadmapping"
                        suggestions={skillSuggestions}
                      />
                    </div>
                    <Button type="submit" variant="secondary">
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Separate multiple skills with commas
                  </p>
                </form>

                {capabilities.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {capabilities.map((capability) => (
                      <Badge key={capability.id} variant="brand" className="gap-1.5 py-1">
                        {capability.name}
                        <button
                          type="button"
                          aria-label={`Remove ${capability.name}`}
                          disabled={pendingId === capability.id}
                          onClick={() =>
                            handleRemove(capability.id, () => deleteCapability(capability.id))
                          }
                          className="text-brand-300/70 hover:text-brand-200 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No skills added yet.</p>
                )}
              </StepBody>
            )}

            {step === "done" && (
              <StepBody
                title="That's your profile started"
                description="Everything below is editable any time from the profile page."
              >
                <ul className="space-y-2 text-sm">
                  <SummaryRow
                    label="Experience level"
                    value={
                      draft.experienceLevel
                        ? EXPERIENCE_LEVEL_LABELS[
                            draft.experienceLevel as (typeof EXPERIENCE_LEVEL_VALUES)[number]
                          ]
                        : null
                    }
                  />
                  <SummaryRow
                    label="Target roles"
                    value={targetRoles.length ? String(targetRoles.length) : null}
                  />
                  <SummaryRow
                    label="Work modes"
                    value={
                      draft.workModes.length
                        ? draft.workModes
                            .map(
                              (mode) =>
                                WORK_MODE_LABELS[mode as (typeof WORK_MODE_VALUES)[number]]
                            )
                            .join(", ")
                        : null
                    }
                  />
                  <SummaryRow
                    label="Career goals"
                    value={draft.careerGoals.trim() ? "Written" : null}
                  />
                  <SummaryRow
                    label="Experience highlights"
                    value={evidence.length ? String(evidence.length) : null}
                  />
                  <SummaryRow
                    label="Skills"
                    value={capabilities.length ? String(capabilities.length) : null}
                  />
                </ul>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    onClick={handleBuildResume}
                    className="w-full sm:w-auto"
                  >
                    Build your master resume
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExit}
                    className="w-full sm:w-auto"
                  >
                    Go to my profile
                  </Button>
                </div>
              </StepBody>
            )}
          </motion.div>
        </AnimatePresence>

        {step !== "welcome" && step !== "done" && (
          <div className="mt-8 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => goTo(index - 1)}
                disabled={isPending}
                className="w-full sm:w-auto"
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={handleContinue}
                disabled={isPending}
                className="w-full sm:w-auto"
              >
                {isPending ? "Saving..." : "Continue"}
              </Button>
            </div>
            <button
              type="button"
              onClick={handleSkip}
              disabled={isPending}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Skip this step
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function StepBody({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-xl font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={value ? "text-foreground" : "text-muted-foreground"}>
        {value ?? "Not set"}
      </span>
    </li>
  )
}
