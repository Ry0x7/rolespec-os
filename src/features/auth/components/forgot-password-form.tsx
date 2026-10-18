"use client"

import { useActionState } from "react"

import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"

import { requestPasswordResetAction } from "../password-reset.actions"

export function ForgotPasswordForm() {
  const [state, action, isPending] = useActionState(
    async (_prev: { message: string } | null, formData: FormData) => {
      const result = await requestPasswordResetAction(formData)
      return { message: result.message }
    },
    null
  )

  // The action returns one message whether or not the address has an account, so
  // this renders a confirmation rather than a success/failure distinction.
  if (state) {
    return (
      <div className="space-y-4" role="status">
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <p className="text-sm text-muted-foreground">
          The link expires in 30 minutes and can only be used once.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  )
}
