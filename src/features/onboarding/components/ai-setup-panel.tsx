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
import type {
  AiConnectionTestFailure,
  AiConnectionTestResult,
} from "../lib/ai-connection-test"
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
  failure?: AiConnectionTestFailure | null
  result?: AiConnectionTestResult | null
  onRetry?: () => void
}

/**
 * Step 2 of onboarding. Four plain-language choices, then only the fields that
 * choice actually needs.
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
  result,
  onRetry,
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
  const availableModels = diagnostic.models ?? []
  const effectiveResult = result ?? failure

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold sm:text-xl">How should AI work?</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">
          Pick what you already have. Works fully offline, and you can change this anytime in Settings.
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
                "flex min-h-[72px] flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors",
                selected
                  ? "border-brand-500/60 bg-brand-500/10"
                  : "border-border bg-muted/20 hover:border-border/80 hover:bg-muted/40"
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Icon className="h-4 w-4 text-brand-400" />
                {option.label}
              </span>
              <span className="text-xs text-muted-foreground line-clamp-1">{option.description}</span>
              <span className="text-[11px] text-muted-foreground/80">{option.tagline}</span>
            </button>
          )
        })}
      </div>

      {selectedGroup.providers.length > 1 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Select local engine:</p>
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

      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold">{guide.label}</p>
            <p className="text-xs text-muted-foreground">{guide.requirement}</p>
          </div>
          {diagnosticBadge(diagnostic)}
        </div>

        <p className="text-xs text-muted-foreground sm:text-sm">{diagnostic.message}</p>
        {diagnostic.detail ? (
          <p className="text-xs text-muted-foreground">{diagnostic.detail}</p>
        ) : null}

        {/* Installed local models selector - directly accessible without scrolling */}
        {availableModels.length > 0 ? (
          <div className="space-y-1.5 rounded-md border border-brand-500/30 bg-brand-500/5 p-2.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="onboarding-model" className="text-xs font-semibold text-foreground">
                {provider === "opencode-cli" ? "Free model" : "Installed local model"}
              </Label>
              <Badge variant="success" size="sm">
                {availableModels.length} available
              </Badge>
            </div>
            <Select
              id="onboarding-model"
              value={model || diagnostic.configuredModel || availableModels[0]}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={pending}
            >
              {availableModels.map((id) => (
                <option key={id} value={id}>
                  {provider === "opencode-cli" ? modelLabel(id) : id}
                </option>
              ))}
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {provider === "opencode-cli"
                ? "Only models that opencode reports as free are listed."
                : `RoleSpec will use this local model from ${guide.label}.`}
            </p>
          </div>
        ) : (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Advanced: choose a model</summary>
            <div className="mt-2 space-y-1.5">
              <Label htmlFor="onboarding-model">Model</Label>
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
            </div>
          </details>
        )}

        {/* Only show installation steps and commands when setup is actually required */}
        {diagnostic.status !== "ready" && guide.steps.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground sm:text-sm">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}

        {diagnostic.status !== "ready" && guide.command ? (
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

      {/* Render connection outcome once with model selector buttons */}
      {effectiveResult ? (
        <ConnectionResult
          result={effectiveResult}
          onRetry={onRetry}
          retrying={pending}
          onSelectModel={onModelChange}
        />
      ) : null}

      <div className="space-y-2">
        <Button
          type="button"
          onClick={onSaveAndTest}
          loading={pending}
          disabled={pending || requiresKeyInput}
          className="w-full sm:w-auto"
        >
          {pending ? "Testing connection..." : "Save and test connection"}
        </Button>
        <p className="text-xs text-muted-foreground">
          One click saves and tests — verified with your chosen model.
        </p>
      </div>

      {confirmSkip ? (
        <div className="space-y-3 rounded-lg border border-amber-600/30 bg-amber-600/5 p-3">
          <p className="text-sm font-medium">Continue without AI?</p>
          <p className="text-xs text-muted-foreground sm:text-sm">
            PDF/DOCX text import, resume editing, application tracking and job
            discovery setup still work. You can connect a provider later in Settings → AI.
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
