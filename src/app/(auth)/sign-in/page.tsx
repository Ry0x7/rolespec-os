import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import { safeCallbackUrl } from "@/features/auth/callback-url"
import { SignInForm } from "@/features/auth/components/sign-in-form"

/**
 * Verifies the session server-side rather than trusting cookie presence in the
 * proxy: a stale or forged session cookie must render this form, not bounce the
 * visitor between here and /dashboard forever.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  // `callbackUrl` is set by `src/proxy.ts` when it bounces a deep link. It is
  // untrusted input, so it only ever leaves here through `safeCallbackUrl`.
  const { callbackUrl } = await searchParams
  const destination = safeCallbackUrl(callbackUrl)

  const session = await auth()
  if (session?.user?.id) redirect(destination)

  return (
    <div className="glass rounded-lg p-6 sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 h-8 w-8 rounded-md bg-gradient-to-br from-brand-700 to-blue-500" />
        <h1 className="text-xl font-bold">Sign in to RoleSpec</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Back into your job seeking OS
        </p>
      </div>

      <SignInForm callbackUrl={destination} />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="text-brand-400 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}
