"use client"

import { useActionState } from "react"
import { registerAction } from "../actions"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"

/**
 * `inviteRequired` is derived server-side from `SIGNUP_INVITE_CODE`. Only the
 * boolean crosses to the client — the code itself never leaves the server.
 */
export function SignUpForm({ inviteRequired = false }: { inviteRequired?: boolean }) {
  const [state, action, isPending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      try {
        const result = await registerAction(formData)
        if (result?.error) return { error: result.error }
        return null
      } catch {
        return { error: "Something went wrong" }
      }
    },
    null
  )

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="Your name"
          required
        />
      </div>

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
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Min 8 chars, 1 uppercase, 1 number"
          required
          minLength={8}
        />
      </div>

      {inviteRequired && (
        <div className="space-y-2">
          <Label htmlFor="inviteCode">Invite code</Label>
          <Input
            id="inviteCode"
            name="inviteCode"
            type="text"
            placeholder="Your closed-beta invite code"
            required
            autoComplete="off"
          />
        </div>
      )}

      {state?.error && (
        <p className="text-sm text-error">{state.error}</p>
      )}

      <Button className="w-full" type="submit" disabled={isPending}>
        {isPending ? "Creating account..." : "Create Account"}
      </Button>
    </form>
  )
}
