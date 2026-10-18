import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import { SignUpForm } from "@/features/auth/components/sign-up-form"
import { isInviteCodeRequired } from "@/features/auth/invite-code"

/**
 * Verifies the session server-side rather than trusting cookie presence in the
 * proxy: a stale or forged session cookie must render this form, not bounce the
 * visitor between here and /dashboard forever.
 */
export default async function SignUpPage() {
  const session = await auth()
  if (session?.user?.id) redirect("/dashboard")

  return (
    <div className="glass rounded-lg p-6 sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 h-8 w-8 rounded-md bg-gradient-to-br from-brand-700 to-blue-500" />
        <h1 className="text-xl font-bold">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up your job seeking OS
        </p>
      </div>

      <Suspense fallback={null}>
        <SignUpForm inviteRequired={isInviteCodeRequired()} />
      </Suspense>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-brand-400 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
