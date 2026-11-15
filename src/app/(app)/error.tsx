"use client"

import Link from "next/link"
import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"

import { Button, buttonVariants } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"

/**
 * Segment-level error boundary for the authenticated app.
 *
 * Without this, any thrown error in an app route fell through to
 * `src/app/global-error.tsx`, which replaces the entire document, navigation
 * included. That turns a failed panel into what looks like a dead application. This keeps the shell mounted and lets `reset()` re-render just the
 * failed segment, which is usually enough for a transient database or AI timeout.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Server errors reach the client with their message replaced by a digest, so
    // this is the only place the pair can be correlated with the server log.
    Sentry.captureException(error)
    console.error("[app] route error:", error.digest ?? error.message)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-center" role="alert">
        <h1 className="text-xl font-semibold">Something went wrong on this page</h1>
        <p className="text-sm text-muted-foreground">
          The rest of the app is still working. Try again — if it keeps failing, the details
          have been reported and support can look it up.
        </p>

        {error.digest && (
          <p className="text-xs text-muted-foreground">
            Reference: <code className="rounded bg-muted px-1.5 py-0.5">{error.digest}</code>
          </p>
        )}

        <div className="flex justify-center gap-3 pt-2">
          <Button onClick={reset}>Try again</Button>
          {/* A link rather than a router push: this renders because something in
              the tree threw, so the least assumption to make about the client
              router is none. */}
          <Link href="/dashboard" className={cn(buttonVariants({ variant: "secondary" }))}>
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
