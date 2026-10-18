import Link from "next/link"
import type { Metadata } from "next"

import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form"

export const metadata: Metadata = {
  title: "Reset your password",
  // Nothing here should be indexed or followed.
  robots: { index: false, follow: false },
}

export default function ForgotPasswordPage() {
  return (
    <div className="glass rounded-lg p-6 sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 h-8 w-8 rounded-md bg-gradient-to-br from-brand-700 to-blue-500" />
        <h1 className="text-xl font-bold">Reset your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll email you a link to choose a new one.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/sign-in" className="text-brand-400 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
