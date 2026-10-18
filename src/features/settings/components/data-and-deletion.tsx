"use client"

import { useActionState, useState } from "react"

import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"

import { deleteMyAccountAction } from "../actions/account.actions"
import { DELETE_CONFIRMATION_PHRASE } from "../constants/data"

/**
 * The "Your data" section: the export and erasure controls the privacy policy
 * promises. Deletion is gated behind an explicit reveal so it cannot be reached by
 * a stray click in a settings page, and the destructive step is never the default.
 */
export function DataAndDeletion({ hasPassword }: { hasPassword: boolean }) {
  const [confirming, setConfirming] = useState(false)

  const [error, action, isPending] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      // A successful delete redirects, so anything returned is a failure.
      const result = await deleteMyAccountAction(formData)
      return result.message
    },
    null
  )

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Export your data</h3>
        <p className="text-sm text-muted-foreground">
          Downloads everything RoleSpec holds about you as a JSON file — résumés, applications,
          cover letters, notes and ratings.
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
        <h3 className="text-sm font-medium text-destructive">Delete your account</h3>
        <p className="text-sm text-muted-foreground">
          Permanent and immediate. Everything above is deleted along with your account. This
          cannot be undone.
        </p>

        {!confirming ? (
          <Button
            variant="secondary"
            className="mt-2 text-destructive"
            onClick={() => setConfirming(true)}
          >
            Delete my account…
          </Button>
        ) : (
          <form action={action} className="mt-4 space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            {hasPassword && (
              <div className="space-y-2">
                <Label htmlFor="delete-password">Your password</Label>
                <Input
                  id="delete-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="delete-confirmation">
                Type {DELETE_CONFIRMATION_PHRASE} to confirm
              </Label>
              <Input
                id="delete-confirmation"
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
                {isPending ? "Deleting…" : "Delete permanently"}
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
