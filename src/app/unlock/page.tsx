import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft, KeyRound, ServerOff, ShieldCheck } from "lucide-react"

import { UnlockForm } from "@/features/auth/components/unlock-form"
import { siteConfig } from "@/config/site"
import {
  getAccessKey,
  getAccessMode,
  requestAccessState,
  safeReturnPath,
} from "@/features/auth/config"
import { buttonVariants } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"

export const metadata: Metadata = {
  title: "Unlock workspace",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const [state, params] = await Promise.all([requestAccessState(), searchParams])
  const next = safeReturnPath(params.next)

  if (state === "owner") redirect(next)

  const blocked = state === "blocked"
  const localOnly = getAccessMode() === "local"
  const keyConfigured = Boolean(getAccessKey())

  return (
    <main className="force-dark dark relative flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.14),transparent_55%)]" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-700 to-blue-500">
            <ShieldCheck className="h-5 w-5 text-white" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">RoleSpec OS</p>
            <p className="text-xs text-muted-foreground">by {siteConfig.publisher}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {blocked ? (
            <div className="space-y-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <ServerOff className="h-5 w-5 text-destructive" aria-hidden="true" />
              </span>
              <div className="space-y-2">
                <h1 className="text-xl font-bold">Remote access is closed</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {localOnly
                    ? "This workspace is configured for local access only. The request did not arrive on a loopback or private-network address."
                    : "This public deployment has no owner access key configured, so the workspace stays locked."}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">Hosting it yourself?</p>
                {localOnly ? (
                  <p className="mt-1">
                    Set <code className="font-mono">ROLSPEC_ACCESS_MODE=unlock</code> and a
                    key of at least 16 characters in{" "}
                    <code className="font-mono">ROLSPEC_ACCESS_KEY</code>, restart the
                    server, then reload this page.
                  </p>
                ) : (
                  <p className="mt-1">
                    Set <code className="font-mono">ROLSPEC_ACCESS_KEY</code> to a secret of
                    at least 16 characters and restart the server. Serve the site over
                    HTTPS so the unlock cookie is accepted.
                  </p>
                )}
              </div>

              <Link
                href="/"
                className={cn(buttonVariants({ variant: "secondary" }), "w-full")}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to the overview
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-700/10">
                <KeyRound className="h-5 w-5 text-brand-400" aria-hidden="true" />
              </span>
              <div className="space-y-2">
                <h1 className="text-xl font-bold">Unlock this workspace</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  This instance is reachable over a public address, so it asks for the
                  owner access key before showing any personal data.
                </p>
              </div>

              {keyConfigured ? (
                <UnlockForm next={next} />
              ) : (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  No access key is configured on the server.
                </p>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Private deployments open straight into the workspace. Public deployments stay
          locked until the owner supplies the key.
        </p>
      </div>
    </main>
  )
}
