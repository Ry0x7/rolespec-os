"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fragment, memo, useMemo } from "react"
import { ChevronRight, Home } from "lucide-react"
import { getBreadcrumbs } from "@/config/navigation"

/**
 * Breadcrumb trail derived from the nav config. Dynamic segments like
 * /resumes/[id] collapse to their section label so the trail never shows a
 * raw id. Hidden on the top-level dashboard where it would repeat the title.
 */
export const Breadcrumbs = memo(function Breadcrumbs() {
  const pathname = usePathname()
  // getBreadcrumbs allocates a fresh array per call — memoize on pathname so
  // the header does not re-render the trail on unrelated state changes.
  const crumbs = useMemo(() => getBreadcrumbs(pathname), [pathname])
  const visible = useMemo(
    () => crumbs.filter((crumb) => crumb.href !== "/dashboard"),
    [crumbs]
  )

  if (crumbs.length <= 1) return null

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
      <Link
        href="/dashboard"
        aria-label="Dashboard"
        className="rounded p-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Home className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      {visible.map((crumb, index, list) => {
          const isLast = index === list.length - 1
          return (
            <Fragment key={crumb.href}>
              <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
              {isLast || !crumb.href ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {crumb.label}
                </Link>
              )}
            </Fragment>
          )
        })}
    </nav>
  )
})
