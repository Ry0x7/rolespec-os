"use client"

import { useActionState, useState } from "react"

import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"

import { resetWorkspaceAction } from "../actions/workspace-reset.actions"
import { DELETE_CONFIRMATION_PHRASE } from "../constants/data"

/**
 * The "Your data" section: export and erasure for the single-owner workspace.
 * Deletion is gated behind an explicit reveal so it cannot be reached by a
 * stray click, and the destructive step is never the default.
 */
export function DataAndDeletion() {
  const [confirming, setConfirming] = useState(false)

  const [error, action, isPending] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      // A successful wipe redirects, so anything returned is a failure.
      const result = await resetWorkspaceAction(formData)
      return result.message
    },
    null
  )

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Export your data</h3>
        <p className="text-sm text-muted-foreground">
          Downloads everything RoleSpec holds as a JSON file — résumés,
          applications, cover letters, notes, career profile and AI usage.
        </p>
        {/* A plain link, not fetch: the browser handles the download and takes the
            filename from the response, and nothing has to buffer the file in JS. */}
        <a
          href="/api/account/export"
          download
          className="inline-flex text-sm text-brand-400 hover:underline"
        >
          Download my data
        </a>
      </div>

      <div className="space-y-2 border-t border-border pt-6">
        <h3 className="text-sm font-medium text-destructive">Erase workspace data</h3>
        <p className="text-sm text-muted-foreground">
          Permanent and immediate. Every résumé, job, application, note and saved
          AI key is deleted. The app then starts fresh with an empty owner
          workspace. This cannot be undone.
        </p>

        {!confirming ? (
          <Button
            variant="secondary"
            className="mt-2 text-destructive"
            onClick={() => setConfirming(true)}
          >
            Erase everything…
          </Button>
        ) : (
          <form action={action} className="mt-4 space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="space-y-2">
              <Label htmlFor="reset-confirmation">
                Type {DELETE_CONFIRMATION_PHRASE} to confirm
              </Label>
              <Input
                id="reset-confirmation"
                name="confirmation"
                autoComplete="off"
                placeholder={DELETE_CONFIRMATION_PHRASE}
                required
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <Button type="submit" variant="destructive" disabled={isPending}>
                {isPending ? "Erasing…" : "Erase permanently"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
