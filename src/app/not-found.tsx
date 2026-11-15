import type { Metadata } from "next"
import Link from "next/link"
import { buttonVariants } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"

export const metadata: Metadata = {
  title: "Not found",
}

export default function NotFound() {
  return (
    /* `force-dark` keeps this page dark even when the visitor stored the light
       colour mode — same idiom as the landing page. */
    <div className="force-dark dark flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <p className="text-gradient-hero text-6xl font-extrabold tracking-tight sm:text-8xl">
        404
      </p>

      <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">
        This page is off the quest log.
      </h1>

      <p className="text-pretty max-w-md text-sm text-muted-foreground">
        The link may be broken or the page may have moved.
      </p>

      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <Link
          href="/"
          className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
        >
          Back home
        </Link>
        <Link
          href="/dashboard"
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "w-full sm:w-auto"
          )}
        >
          Go to dashboard
        </Link>
        <Link
          href="/jobs/discover"
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "w-full sm:w-auto"
          )}
        >
          Discover jobs
        </Link>
      </div>
    </div>
  )
}
