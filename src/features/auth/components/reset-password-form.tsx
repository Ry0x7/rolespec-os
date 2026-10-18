"use client"

import Link from "next/link"
import { useActionState } from "react"

import { Button, buttonVariants } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { cn } from "@/shared/lib/utils"

import { resetPasswordAction } from "../password-reset.actions"

type State =
  | { status: "done" }
  | { status: "error"; message: string; expired?: boolean }
  | null

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, isPending] = useActionState(
    async (_prev: State, formData: FormData): Promise<State> => {
      const result = await resetPasswordAction(formData)
      if (result.ok) return { status: "done" }
      return { status: "error", message: result.message, expired: result.expired }
    },
    null
  )

  if (state?.status === "done") {
    return (
      <div className="space-y-4" role="status">
        <p className="text-sm text-muted-foreground">
          Your password has been changed, and every other device has been signed out.
        </p>
        <Link href="/sign-in" className={cn(buttonVariants(), "w-full")}>
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-describedby="password-requirements"
        />
        <p id="password-requirements" className="text-xs text-muted-foreground">
          At least 8 characters, with an uppercase letter and a number.
        </p>
      </div>

      {state?.status === "error" && (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">{state.message}</p>
          {state.expired && (
            <Link href="/forgot-password" className="text-sm text-brand-400 hover:underline">
              Request a new link
            </Link>
          )}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  )
}
