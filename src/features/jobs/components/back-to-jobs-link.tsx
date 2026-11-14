"use client"

import { useSyncExternalStore, type ReactNode } from "react"
import Link from "next/link"
import {
  JOBS_LIST_HREF_STORAGE_KEY,
  resolveBackToJobsHref,
} from "../lib/jobs-list-href"

const JOBS_PATH = "/jobs"

function readStoredHref(): string | null {
  try {
    return window.sessionStorage.getItem(JOBS_LIST_HREF_STORAGE_KEY)
  } catch {
    return null
  }
}

// Nothing to subscribe to: the value is read once per render of the page.
function subscribe(): () => void {
  return () => {}
}

function getClientHref(): string {
  return resolveBackToJobsHref({
    storedHref: readStoredHref(),
    referrer: document.referrer,
    origin: window.location.origin,
  })
}

function getServerHref(): string {
  return JOBS_PATH
}

/**
 * The Job Detail back link. The server snapshot is `/jobs`; after hydration it
 * becomes the list URL the user came from, so the list keeps its search, filters
 * and sort across a visit to a job without a hydration mismatch.
 */
export function BackToJobsLink({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const href = useSyncExternalStore(subscribe, getClientHref, getServerHref)

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}
