"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { KeyRound } from "lucide-react"

import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { saveFirecrawlConnection } from "../actions/integration-settings.actions"

export interface FirecrawlFormStatus {
  configured: boolean
  source: "settings" | "env" | null
  last4?: string
  baseUrl: string | null
  canSave: boolean
}

/**
 * Saves the optional Firecrawl connection from Settings. The desktop build has
 * no `.env` workflow, so this is the primary way to turn web research on: paste
 * the key here and it is encrypted into the local database. Environment values
 * still work as a fallback for server installs.
 */
export function FirecrawlSettingsForm({ status }: { status: FirecrawlFormStatus }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [removing, setRemoving] = useState(false)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    startTransition(async () => {
      const result = await saveFirecrawlConnection(formData)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      const keyInput = form.elements.namedItem("apiKey")
      if (keyInput instanceof HTMLInputElement) keyInput.value = ""
      const clearInput = form.elements.namedItem("clearApiKey")
      if (clearInput instanceof HTMLInputElement) clearInput.checked = false
      setRemoving(false)
      toast.success("Web research connection saved")
      router.refresh()
    })
  }

  const envManaged = status.source === "env"

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={status.configured ? "success" : "neutral"} size="sm">
          {status.configured ? "Connected" : "Not connected"}
        </Badge>
        {status.source === "settings" && status.last4 ? (
          <span className="text-xs text-muted-foreground">
            Saved key ending in <span className="font-mono">…{status.last4}</span>
          </span>
        ) : null}
        {envManaged ? (
          <span className="text-xs text-muted-foreground">
            Currently coming from this computer&apos;s environment file. A key
            saved here takes priority.
          </span>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="firecrawl-key">Firecrawl API key</Label>
        <Input
          id="firecrawl-key"
          name="apiKey"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            status.configured
              ? "Enter a new key to replace the saved one"
              : "fc-..."
          }
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          Stored encrypted on this computer (AES-256-GCM) and never shown again,
          never sent to your browser after saving, and never written to your
          project files. Leave empty to keep the current key.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="firecrawl-base-url">Address (only for a self-hosted copy)</Label>
        <Input
          id="firecrawl-base-url"
          name="baseUrl"
          type="url"
          inputMode="url"
          placeholder="https://api.firecrawl.dev"
          defaultValue={status.baseUrl ?? ""}
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to use Firecrawl&apos;s public service.
        </p>
      </div>

      {!status.canSave ? (
        <p className="rounded-md border border-amber-600/30 bg-amber-600/5 p-3 text-xs text-muted-foreground">
          This installation cannot encrypt a saved key yet. Restart RoleSpec
          once so it can create its local key, then try again.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={isPending}>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {isPending ? "Saving…" : "Save connection"}
        </Button>
        {status.source === "settings" ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name="clearApiKey"
              checked={removing}
              onChange={(event) => setRemoving(event.target.checked)}
              disabled={isPending}
              className="size-4 rounded border-border accent-brand-500"
            />
            Remove the saved key
          </label>
        ) : null}
      </div>
    </form>
  )
}
