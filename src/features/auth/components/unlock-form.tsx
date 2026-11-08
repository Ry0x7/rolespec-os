"use client"

import { useActionState } from "react"
import { KeyRound } from "lucide-react"

import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"

import { unlockWorkspace } from "../unlock.actions"

export function UnlockForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(unlockWorkspace, null)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <Label htmlFor="owner-access-key">Owner access key</Label>
        <Input
          id="owner-access-key"
          name="key"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          minLength={16}
          disabled={pending}
          aria-describedby="owner-access-key-hint"
        />
        <p id="owner-access-key-hint" className="text-xs text-muted-foreground">
          The key configured as <code className="font-mono">ROLSPEC_ACCESS_KEY</code> on the
          machine hosting this workspace.
        </p>
      </div>

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        {pending ? "Unlocking…" : "Unlock workspace"}
      </Button>
    </form>
  )
}
