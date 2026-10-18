"use client"

import Link from "next/link"
import { useActionState } from "react"

import { Button, buttonVariants } from "@/shared/ui/button"

import { connectExtensionAction } from "../actions/extension-connect.actions"

/**
 * Consent step for the browser extension's sign-in flow.
 *
 * On success the action throws a redirect to the extension's `chromiumapp.org`
 * URL, so nothing is returned and this component never re-renders; anything that
 * does come back is an error worth showing verbatim (rate limit, tampered
 * parameters, a failed write).
 *
 * `state` and `redirectUri` ride along as hidden fields and are re-validated in
 * the action — the page's validation is for the user, not for security.
 */
export function ExtensionConnectForm({
  state,
  redirectUri,
}: {
  state: string
  redirectUri: string
}) {
  const [error, action, isPending] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      const result = await connectExtensionAction(formData)
      return result?.error ?? null
    },
    null
  )

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="redirectUri" value={redirectUri} />

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary" })}>
          Cancel
        </Link>
        <Button type="submit" loading={isPending}>
          {isPending ? "Connecting…" : "Connect"}
        </Button>
      </div>
    </form>
  )
}
