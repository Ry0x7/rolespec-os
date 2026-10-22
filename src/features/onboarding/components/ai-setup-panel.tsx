"use client"

import { useState } from "react"
import {
  ExternalLink,
  Gift,
  KeyRound,
  Laptop,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { cn } from "@/shared/lib/utils"
import type { AiProvider } from "@/shared/lib/ai-providers/constants"
import {
  AI_SETUP_GROUPS,
  aiSetupGroupById,
  aiSetupGuideFor,
  type AiSetupGroupId,
} from "../constants/ai-setup"
import type { ProviderDiagnostic } from "../lib/provider-diagnostics"
import type { AiConnectionTestFailure } from "../lib/ai-connection-test"
import { ConnectionResult } from "./connection-result"

const GROUP_ICONS = {
  free: Gift,
  chatgpt: MessageSquare,
  claude: Sparkles,
  local: Laptop,
  api: KeyRound,
} as const

/** `opencode/glm-5.3-flash-free` → `GLM 5.3 Flash Free`. */
function modelLabel(id: string): string {
  const slug = id.split("/")[1] ?? id
  return slug
    .split("-")
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ")
}

function diagnosticBadge(diagnostic: ProviderDiagnostic) {
  switch (diagnostic.status) {
    case "ready":
      return <Badge variant="success" size="sm">Ready</Badge>
    case "needs-setup":
      return <Badge variant="warning" size="sm">Needs setup</Badge>
    case "unavailable":
      return <Badge variant="error" size="sm">Not found</Badge>
    default:
      return <Badge variant="neutral" size="sm">Check manually</Badge>
  }
}

interface AiSetupPanelProps {
  savedProvider: AiProvider | null
  hasSavedKey: boolean
  last4?: string
  diagnostics: Record<AiProvider, ProviderDiagnostic>
  group: AiSetupGroupId
  provider: AiProvider
  model: string
  apiKey: string
  onGroupChange: (group: AiSetupGroupId) => void
  onProviderChange: (provider: AiProvider) => void
  onModelChange: (value: string) => void
  onApiKeyChange: (value: string) => void
  onSaveAndTest: () => void
  onSkip: () => void
  pending: boolean
  saveError: string | null
  failure: AiConnectionTestFailure | null
}

/**
 * Step 3 of onboarding. Four plain-language choices, then only the fields that
 * choice actually needs. Environment variables and provider ids stay out of the
 * primary flow (models are behind "Advanced").
 */
export function AiSetupPanel({
  savedProvider,
  hasSavedKey,
  last4,
  diagnostics,
  group,
  provider,
  model,
  apiKey,
  onGroupChange,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onSaveAndTest,
  onSkip,
  pending,
  saveError,
  failure,
}: AiSetupPanelProps) {
  const [confirmSkip, setConfirmSkip] = useState(false)

  const selectedGroup = aiSetupGroupById(group)
  const guide = aiSetupGuideFor(provider)
  const diagnostic = diagnostics[provider]
  const isApiKey = guide?.credentialKind === "api-key"
  const keyAlreadySaved = isApiKey && savedProvider === provider && hasSavedKey
  const requiresKeyInput = isApiKey && !keyAlreadySaved && apiKey.trim().length === 0

  if (!selectedGroup || !guide) return null

  // A free option that this computer cannot run is noise in first-run setup:
  // the point of the model list is that every visible choice is actionable.
  // A saved OpenCode choice stays visible so its owner can see what broke.
  const openCodeDiagnostic = diagnostics["opencode-cli"]
  const openCodeUnusable =
    openCodeDiagnostic?.status === "unavailable" ||
    (openCodeDiagnostic?.status === "needs-setup" &&
      openCodeDiagnostic.reason === "no-models")
  const visibleGroups = AI_SETUP_GROUPS.filter(
    (option) => option.id !== "free" || !openCodeUnusable || group === "free"
  )
  const openCodeModels = diagnostic.models ?? []
  const selectedOpenCodeModel = openCodeModels.includes(model)
    ? model
    : openCodeModels[0] ?? ""

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">How should AI work?</h1>
        <p className="text-sm text-muted-foreground">
          Pick what you already have. RoleSpec uses AI for resume tailoring, ATS
          analysis, job matching and outreach, but you can change this later in
          Settings.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="AI options">
        {visibleGroups.map((option) => {
          const Icon = GROUP_ICONS[option.id]
          const selected = option.id === group
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                onGroupChange(option.id)
                setConfirmSkip(false)
              }}
              disabled={pending}
              className={cn(
                "flex min-h-[92px] flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-brand-500/60 bg-brand-500/10"
                  : "border-border bg-muted/20 hover:border-border/80 hover:bg-muted/40"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4 text-brand-400" />
                {option.label}
              </span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
              <span className="text-[11px] text-muted-foreground/80">{option.tagline}</span>
            </button>
          )
        })}
      </div>

      {selectedGroup.providers.length > 1 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Which one?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {selectedGroup.providers.map((option) => (
              <button
                key={option.provider}
                type="button"
                aria-pressed={option.provider === provider}
                onClick={() => {
                  onProviderChange(option.provider)
                  setConfirmSkip(false)
                }}
                disabled={pending}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  option.provider === provider
                    ? "border-brand-500/60 bg-brand-500/10"
                    : "border-border hover:bg-muted/40"
                )}
              >
                <span>
                  <span className="block font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {option.tagline}
                  </span>
                </span>
                {diagnosticBadge(diagnostics[option.provider])}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold">{guide.label}</p>
            <p className="text-xs text-muted-foreground">{guide.requirement}</p>
          </div>
          {diagnosticBadge(diagnostic)}
        </div>

        <p className="text-sm text-muted-foreground">{diagnostic.message}</p>
        {diagnostic.detail ? (
          <p className="text-xs text-muted-foreground">{diagnostic.detail}</p>
        ) : null}

        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        {guide.command ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2">
            <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <code className="min-w-0 break-all font-mono text-xs">{guide.command}</code>
          </div>
        ) : null}

        {guide.docsUrl ? (
          <a
            href={guide.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 underline-offset-4 hover:underline"
          >
            Open {guide.label} setup guide
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}

        {isApiKey ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="onboarding-api-key">{guide.label} API key</Label>
              {keyAlreadySaved ? (
                <Badge variant="success" size="sm">
                  saved …{last4}
                </Badge>
              ) : null}
            </div>
            <Input
              id="onboarding-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => onApiKeyChange(event.target.value)}
              disabled={pending}
              placeholder={
                keyAlreadySaved
                  ? "Enter a new key to replace the saved one"
                  : guide.keyPlaceholder ?? "Paste your API key"
              }
            />
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The key is encrypted with AES-256-GCM before it is stored on this
              computer. It is only sent to {guide.label}.
            </p>
          </div>
        ) : null}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Advanced: choose a model</summary>
          <div className="mt-2 space-y-1.5">
            <Label htmlFor="onboarding-model">
              {provider === "opencode-cli" ? "Free model" : "Model"}
            </Label>
            {provider === "opencode-cli" && openCodeModels.length > 0 ? (
              <>
                <Select
                  id="onboarding-model"
                  value={selectedOpenCodeModel}
                  onChange={(event) => onModelChange(event.target.value)}
                  disabled={pending}
                >
                  {openCodeModels.map((id) => (
                    <option key={id} value={id}>
                      {modelLabel(id)}
                    </option>
                  ))}
                </Select>
                <p>
                  Only models that <code className="font-mono">opencode models</code> reports
                  as free are listed. Available choices change with the installed CLI.
                </p>
              </>
            ) : (
              <>
                <Input
                  id="onboarding-model"
                  value={model}
                  onChange={(event) => onModelChange(event.target.value)}
                  disabled={pending}
                  placeholder={diagnostic.configuredModel}
                />
                <p>
                  Leave empty to use {guide.label}&apos;s default ({diagnostic.configuredModel}).
                </p>
              </>
            )}
          </div>
        </details>

        {guide.note ? (
          <p className="rounded-md border border-border bg-background/40 p-2 text-[11px] text-muted-foreground">
            {guide.note}
          </p>
        ) : null}
      </div>

      {saveError ? (
        <p className="text-sm text-error" role="alert">
          {saveError}
        </p>
      ) : null}

      {failure ? <ConnectionResult result={failure} /> : null}

      <div className="space-y-3">
        <Button
          type="button"
          onClick={onSaveAndTest}
          loading={pending}
          disabled={pending || requiresKeyInput}
          className="w-full sm:w-auto"
        >
          {pending ? "Testing the connection..." : "Save and test connection"}
        </Button>
        <p className="text-xs text-muted-foreground">
          This sends one very small request to the provider and uses one AI
          request from your daily limit.
        </p>
      </div>

      {confirmSkip ? (
        <div className="space-y-3 rounded-lg border border-amber-600/30 bg-amber-600/5 p-3">
          <p className="text-sm font-medium">Continue without AI?</p>
          <p className="text-sm text-muted-foreground">
            Resume editing, application tracking and job discovery setup still
            work, but AI features stay unavailable: PDF/DOCX resume import, resume
            tailoring, ATS analysis, job matching, cover letters and outreach. You
            can connect a provider later in Settings → AI.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onSkip} disabled={pending}>
              Continue without AI
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmSkip(false)}
              disabled={pending}
            >
              Go back
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmSkip(true)}
          disabled={pending}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
        >
          I&apos;ll set up AI later
        </button>
      )}
    </div>
  )
}
