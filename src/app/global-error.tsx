"use client"

import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"

/**
 * Last-resort boundary: it replaces the root layout, so it must render its own
 * <html>/<body> and cannot rely on any app chrome or styling.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <h2>Something went wrong</h2>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </body>
    </html>
  )
}
