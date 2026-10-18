import Link from "next/link"
import type { Metadata } from "next"

import { requireUser } from "@/features/auth/guards"
import { ExtensionConnectForm } from "@/features/settings/components/extension-connect-form"
import { parseExtensionConnectParams } from "@/features/settings/schemas/extension-connect.schema"
import { siteConfig } from "@/config/site"
import { buttonVariants } from "@/shared/ui/button"

/**
 * `/extension/connect` — the consent screen of the RoleSpec Job Clipper's
 * "sign in to connect" flow.
 *
 * The extension opens this URL through `chrome.identity.launchWebAuthFlow` with a
 * `state` nonce and its own `chromiumapp.org` `redirect_uri`. Approving mints a
 * personal API token and redirects back with it in the fragment, which saves the
 * user generating a token in /settings and pasting it by hand.
 *
 * Not in `publicRoutes` in `src/proxy.ts`, so an anonymous visit is bounced to
 * /sign-in with `?callbackUrl=` pointing back here — the whole query string
 * survives the round trip. `requireUser()` is the real guard.
 *
 * Invalid parameters render an explanation and no redirect: a bad `redirect_uri`
 * is exactly the case where sending the token anywhere would be the bug.
 */

export const metadata: Metadata = {
  title: "Connect the browser extension",
  robots: { index: false, follow: false },
}

export default async function ExtensionConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; redirect_uri?: string }>
}) {
  const session = await requireUser()
  const { state, redirect_uri: redirectUri } = await searchParams

  const parsed = parseExtensionConnectParams(state, redirectUri)

  if (!parsed.ok) {
    return (
      <div className="glass space-y-4 rounded-lg p-6 sm:p-8">
        <h1 className="text-xl font-bold">Can&apos;t connect this extension</h1>
        <p className="text-sm text-muted-foreground">{parsed.error}</p>
        <p className="text-sm text-muted-foreground">
          Open the extension and choose &ldquo;Sign in to connect&rdquo; again. You can also create
          a token by hand in{" "}
          <Link href="/settings" className="text-brand-400 hover:underline">
            Settings
          </Link>
          .
        </p>
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary" })}>
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="glass space-y-5 rounded-lg p-6 sm:p-8">
      <div className="space-y-2">
        <div className="h-8 w-8 rounded-md bg-gradient-to-br from-brand-700 to-blue-500" />
        <h1 className="text-xl font-bold">Connect RoleSpec Job Clipper?</h1>
        <p className="text-sm text-muted-foreground">
          The extension will be able to save jobs to your {siteConfig.name} board on your behalf.
        </p>
      </div>

      <dl className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">Signed in as</dt>
          <dd className="min-w-0 truncate font-medium">{session.user.email}</dd>
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">
        The token this creates is a credential: anyone holding it can use the API as you, like
        your password. Only approve this on a device you trust.
      </p>

      <p className="text-xs text-muted-foreground">
        Connecting replaces any previous &ldquo;Chrome extension&rdquo; token. You can revoke access
        at any time from{" "}
        <Link href="/settings" className="text-brand-400 hover:underline">
          Settings
        </Link>
        .
      </p>

      <ExtensionConnectForm state={parsed.state} redirectUri={parsed.redirectUri} />
    </div>
  )
}
