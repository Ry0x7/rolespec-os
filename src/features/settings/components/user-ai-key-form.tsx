"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { Badge } from "@/shared/ui/badge"
import {
  AI_PROVIDER_META,
  USER_AI_PROVIDERS,
  type UserAiProvider,
} from "@/shared/lib/ai-providers/constants"
import { updateUserAiSettings } from "../actions/user-ai-settings.actions"

/** Presence + last 4 of the stored key. The key value never reaches the client. */
export interface UserAiKeyFormValues {
  provider: UserAiProvider | null
  model: string | null
  configured: boolean
  envConfigured?: boolean
  last4?: string
}

/** One free OpenCode model returned by the server-side CLI probe. */
export interface UserAiModelOption {
  value: string
  label: string
}

const KEY_PLACEHOLDER: Partial<Record<UserAiProvider, string>> = {
  openai: "sk-...",
  anthropic: "sk-ant-...",
  deepseek: "sk-...",
  google: "AIza...",
}

export function UserAiKeyForm({
  status,
  openCodeModels = [],
}: {
  status: UserAiKeyFormValues
  /** Only free models the installed OpenCode CLI reports, probed on the server. */
  openCodeModels?: UserAiModelOption[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [provider, setProvider] = useState<UserAiProvider>(
    status.provider ?? USER_AI_PROVIDERS[0]
  )
  const [model, setModel] = useState(status.model ?? "")

  const meta = AI_PROVIDER_META[provider]
  const isLocalProvider = meta.localOnly
  const requiresApiKey = meta.credentialEnvVar !== null && !isLocalProvider

  // Never advertise a provider this computer cannot run. A saved value stays
  // visible so the user can see what is configured and switch away from it.
  const providers = USER_AI_PROVIDERS.filter(
    (key) =>
      key !== "opencode-cli" ||
      openCodeModels.length > 0 ||
      status.provider === "opencode-cli"
  )
  const openCodeModelOptions = openCodeModels
  // A saved model can be retired by a CLI update. Never render a value the
  // selector does not contain; fall back to the first model that is available.
  const selectedOpenCodeModel =
    openCodeModelOptions.find((option) => option.value === model)?.value ??
    openCodeModelOptions[0]?.value ??
    ""

  function handleProviderChange(next: UserAiProvider) {
    setProvider(next)
    // A model id belongs to one provider; carrying it across would submit a
    // name the new provider has never heard of.
    setModel("")
  }

  /** Drop the plaintext key from the DOM once it has been saved. */
  function resetKeyFields(form: HTMLFormElement) {
    const input = form.elements.namedItem("apiKey")
    if (input instanceof HTMLInputElement) input.value = ""
    const clear = form.elements.namedItem("clearApiKey")
    if (clear instanceof HTMLInputElement) clear.checked = false
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget
    const formData = new FormData(form)
    e.preventDefault()
    startTransition(async () => {
      const result = await updateUserAiSettings(formData)
      if (result.error) {
        toast.error(result.error)
        return
      }
      resetKeyFields(form)
      toast.success("AI provider configuration saved")
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="user-ai-provider">Provider</Label>
        <Select
          id="user-ai-provider"
          name="provider"
          value={provider}
          disabled={isPending}
          onChange={(e) => handleProviderChange(e.target.value as UserAiProvider)}
        >
          {providers.map((key) => (
            <option key={key} value={key}>
              {AI_PROVIDER_META[key].label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="user-ai-model">Model</Label>
        {provider === "opencode-cli" && openCodeModelOptions.length > 0 ? (
          <>
            <Select
              id="user-ai-model"
              name="model"
              value={selectedOpenCodeModel}
              onChange={(e) => setModel(e.target.value)}
              disabled={isPending}
            >
              {openCodeModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              These are the zero-cost models the installed OpenCode CLI currently
              reports. Unavailable models are not listed.
            </p>
          </>
        ) : (
          <>
            <Input
              id="user-ai-model"
              name="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={meta.defaultModel}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use {meta.label}&apos;s default model (
              <span className="font-mono">{meta.defaultModel}</span>).
            </p>
          </>
        )}
      </div>

      {provider === "opencode-cli" && openCodeModelOptions.length === 0 && (
        <div className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">No free OpenCode models found</p>
          <p>
            The OpenCode CLI is not installed, or it does not report any free models.
            Install OpenCode and run <code className="font-mono">opencode models</code>,
            then reload this page.
          </p>
        </div>
      )}

      {provider === "opencode-cli" && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">OpenCode (free models)</p>
          <p>
            Runs the OpenCode CLI on this computer as a text generator. Free models
            need no API key. RoleSpec disables shell, write and web tools and runs
            the subprocess in an empty scratch folder.
          </p>
        </div>
      )}

      {provider === "claude-code" && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Claude Code (Subscription / CLI)</p>
          <p>
            Spawns the Claude CLI locally on the host machine. Run <code className="font-mono">claude setup-token</code> on your server or provide <code className="font-mono">CLAUDE_CODE_OAUTH_TOKEN</code> in your environment.
          </p>
        </div>
      )}

      {provider === "codex-cli" && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">ChatGPT via Codex CLI</p>
          <p>
            Uses your ChatGPT Plus or Pro subscription at no extra per-token cost. Run <code className="font-mono">npm i -g @openai/codex && codex login</code> on the host machine.
          </p>
        </div>
      )}

      {provider === "ollama" && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Local Ollama</p>
          <p>
            Connects to your local Ollama server (default <code className="font-mono">http://localhost:11434</code>). Ensure Ollama is running and your model is downloaded (<code className="font-mono">ollama pull {meta.defaultModel}</code>).
          </p>
        </div>
      )}

      {provider === "lmstudio" && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Local LM Studio</p>
          <p>
            Connects to your LM Studio local server (default <code className="font-mono">http://localhost:1234/v1</code>). Ensure the local inference server is started in LM Studio.
          </p>
        </div>
      )}

      {requiresApiKey && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="apiKey">API key</Label>
            <Badge
              variant={status.configured ? "success" : "neutral"}
              size="sm"
            >
              {status.configured ? `key set …${status.last4}` : "no key saved"}
            </Badge>
          </div>
          <Input
            id="apiKey"
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={
              status.configured
                ? "Enter a new key to replace"
                : KEY_PLACEHOLDER[provider] ?? "Paste API key..."
            }
            disabled={isPending}
          />
          <p className="text-xs text-muted-foreground">
            Stored encrypted (AES-256-GCM) locally. Changing provider clears the saved key. Leave empty to keep existing key.
          </p>
          {status.configured ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                name="clearApiKey"
                disabled={isPending}
                className="size-4 rounded border-border accent-brand-500"
              />
              Remove the saved key
            </label>
          ) : null}
        </div>
      )}

      <Button type="submit" loading={isPending}>
        {isPending ? "Saving..." : "Save AI provider"}
      </Button>
    </form>
  )
}
