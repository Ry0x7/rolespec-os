"use client"

import { useActionState, useState, useTransition } from "react"
import { AlertTriangle, Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { formatDate, formatDateTime } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"

import {
  createApiTokenAction,
  revokeAllApiTokensAction,
  revokeApiTokenAction,
  rotateApiTokenAction,
} from "../actions/api-token.actions"
import { API_TOKEN_EXPIRY_CHOICES, MAX_ACTIVE_API_TOKENS } from "../constants/data"

/** Mirrors `ApiTokenSummary` from the service, which is server-only. */
export interface ApiTokenListItem {
  id: string
  name: string
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
}

/** "Never expires" / "Expires 3 Sep 2026" / "Expired 1 Aug 2026". */
function expiryLabel(expiresAt: Date | null): string {
  if (!expiresAt) return "never expires"
  const expired = expiresAt.getTime() <= Date.now()
  return `${expired ? "expired" : "expires"} ${formatDate(expiresAt)}`
}

/**
 * The "API access" section: mint and revoke the bearer tokens the browser
 * extension authenticates with.
 *
 * A freshly created token is held in component state only. It is never fetched
 * back — the server stores a hash — so the reveal panel is the user's one chance
 * to copy it, and the copy says so plainly.
 */
export function ApiTokenSection({ tokens }: { tokens: ApiTokenListItem[] }) {
  const [freshToken, setFreshToken] = useState<{ token: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, startRevoke] = useTransition()
  const [rotating, startRotate] = useTransition()
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false)

  const [error, action, isPending] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      const result = await createApiTokenAction(formData)
      if ("error" in result) return result.error
      setFreshToken({ token: result.token, name: result.name })
      setCopied(false)
      return null
    },
    null
  )

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success("Token copied")
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy to clipboard")
    }
  }

  function revoke(tokenId: string, name: string) {
    startRevoke(async () => {
      const result = await revokeApiTokenAction(tokenId)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success(`Revoked "${name}"`)
    })
  }

  function rotate(tokenId: string, name: string) {
    startRotate(async () => {
      const result = await rotateApiTokenAction(tokenId)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setFreshToken({ token: result.token, name: result.name })
      setCopied(false)
      toast.success(`Rotated "${name}"`)
    })
  }

  function revokeAll() {
    setConfirmRevokeAll(false)
    startRevoke(async () => {
      const result = await revokeAllApiTokensAction()
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setFreshToken(null)
      toast.success(
        result.count === 1 ? "Revoked 1 token" : `Revoked ${result.count} tokens`
      )
    })
  }

  const atCap = tokens.length >= MAX_ACTIVE_API_TOKENS
  const busy = revoking || rotating

  return (
    <div className="space-y-8">
      <p className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        <span>
          A token is a credential. Anyone holding it can use the API as you, just like your
          password. Keep it secret, and rotate or revoke it the moment it might have been
          exposed.
        </span>
      </p>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Your tokens</h3>
          {tokens.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={() => setConfirmRevokeAll(true)}
            >
              Revoke all tokens
            </Button>
          )}
        </div>
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tokens yet. Create one below to connect the browser extension.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {formatDate(token.createdAt)} ·{" "}
                    {token.lastUsedAt
                      ? `last used ${formatDateTime(token.lastUsedAt)}`
                      : "never used"}{" "}
                    · {expiryLabel(token.expiresAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => rotate(token.id, token.name)}
                  >
                    Rotate
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => revoke(token.id, token.name)}
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {freshToken && (
        <div className="space-y-2 rounded-lg border border-brand-500/40 bg-brand-500/5 p-4">
          <h3 className="text-sm font-medium">Token for &ldquo;{freshToken.name}&rdquo;</h3>
          <p className="text-sm text-muted-foreground">
            Copy it now — you won&apos;t see this again. We only store a hash, so it cannot be
            shown a second time. Revoke and create a new one if you lose it.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{freshToken.token}</code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copy(freshToken.token)}
              aria-label="Copy token"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setFreshToken(null)}>
            I&apos;ve saved it
          </Button>
        </div>
      )}

      <form action={action} className="space-y-4 border-t border-border pt-6">
        <div className="space-y-2">
          <Label htmlFor="api-token-name">Token name</Label>
          <Input
            id="api-token-name"
            name="name"
            autoComplete="off"
            maxLength={60}
            placeholder="Chrome extension"
            required
          />
          <p className="text-xs text-muted-foreground">
            A label so you can tell your tokens apart. Up to {MAX_ACTIVE_API_TOKENS} active tokens.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-token-expiry">Expires</Label>
          <Select id="api-token-expiry" name="expiry" defaultValue="never" className="sm:max-w-48">
            {Object.entries(API_TOKEN_EXPIRY_CHOICES).map(([value, choice]) => (
              <option key={value} value={value}>
                {choice.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            An expiring token stops working on its own. Pick one if you only need access for a
            while.
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={isPending || atCap}>
          {isPending ? "Creating…" : "Create token"}
        </Button>
        {atCap && (
          <p className="text-xs text-muted-foreground">
            Revoke a token to free up a slot.
          </p>
        )}
      </form>

      <ConfirmDialog
        open={confirmRevokeAll}
        title="Revoke all tokens?"
        description="Every token you hold stops working immediately, including the browser extension's. You can create new ones afterwards."
        confirmLabel="Revoke all"
        destructive
        onConfirm={revokeAll}
        onCancel={() => setConfirmRevokeAll(false)}
      />
    </div>
  )
}
