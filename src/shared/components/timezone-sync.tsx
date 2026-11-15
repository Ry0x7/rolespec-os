"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { TZ_OFFSET_COOKIE } from "@/shared/lib/dates"

/**
 * Publishes the browser's UTC offset to the server as a cookie, so server
 * components can frame "today" on the user's calendar instead of on UTC (see
 * `getUserDayStart`). Renders nothing.
 *
 * A server render cannot know the visitor's timezone, so the first page of a
 * fresh session is framed in UTC; the refresh below re-renders it correctly as
 * soon as the cookie exists. Writing the cookie only when the value actually
 * changes is what keeps that refresh from looping.
 */
export function TimezoneSync() {
  const router = useRouter()

  useEffect(() => {
    const offset = String(new Date().getTimezoneOffset())
    const current = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${TZ_OFFSET_COOKIE}=`))
      ?.slice(TZ_OFFSET_COOKIE.length + 1)

    if (current === offset) return

    document.cookie = `${TZ_OFFSET_COOKIE}=${offset}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }, [router])

  return null
}
