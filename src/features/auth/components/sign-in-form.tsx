"use client"

import Link from "next/link"
import { useActionState } from "react"
import { signInAction } from "../actions"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"

/**
 * `callbackUrl` is already narrowed to a same-origin path by the page. It is
 * echoed into a hidden field and re-validated server-side in `signInAction`,
 * because the field is trivially editable in the browser.
 */
export function SignInForm({ callbackUrl }: { callbackUrl?: string }) {
  const [error, action, isPending] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      try {
        // A successful sign-in throws a redirect, so anything returned here is an
        // error the action wants shown verbatim (e.g. the rate-limit message).
        const result = await signInAction(formData)
        return result?.error ?? null
      } catch {
        return "Invalid email or password"
      }
    },
    null
  )

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
            required
          />
        </div>

        {error && (
          <p className="text-sm text-error">{error}</p>
        )}

        <Button className="w-full" type="submit" disabled={isPending}>
          {isPending ? "Signing in..." : "Sign In"}
        </Button>
      </form>
    </div>
  )
}
