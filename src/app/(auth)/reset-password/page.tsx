import Link from "next/link"
import type { Metadata } from "next"

import { ResetPasswordForm } from "@/features/auth/components/reset-password-form"

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
}

/**
 * The token arrives as a query parameter and is passed straight to the form, which
 * posts it back to `resetPasswordAction`. It is deliberately **not** validated
 * here: checking it on GET would burn a single-use token on a link preview or an
 * email-scanner prefetch, locking the real user out of their own reset.
 *
 * `searchParams` is a promise in Next.js 16.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams
  const rawToken = Array.isArray(token) ? token[0] : token

  if (!rawToken) {
    return (
      <div className="glass rounded-lg p-6 sm:p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold">That link is incomplete</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been cut off by your email client. Request a fresh one.
          </p>
        </div>
        <Link href="/forgot-password" className="text-sm text-brand-400 hover:underline">
          Request a new reset link
        </Link>
      </div>
    )
  }

  return (
    <div className="glass rounded-lg p-6 sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 h-8 w-8 rounded-md bg-gradient-to-br from-brand-700 to-blue-500" />
        <h1 className="text-xl font-bold">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Setting it signs you out everywhere else.
        </p>
      </div>

      <ResetPasswordForm token={rawToken} />
    </div>
  )
}
