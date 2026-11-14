import Link from "next/link"
import { ArrowLeft, Shield } from "lucide-react"
import { siteConfig } from "@/config/site"
import { LogoMark } from "./logo-mark"

/**
 * Shared chrome for /terms and /privacy.
 *
 * The in-app landing page is gone, so these pages carry the product header
 * rather than the marketing navigation that used to point at removed sections.
 * The copy is derived from what this codebase actually does. Legal review of the
 * final wording is still an operator responsibility, so it is tracked in the
 * release checklist rather than shown as a banner to every visitor.
 */
export function LegalPage({
  title,
  effectiveDate,
  children,
}: {
  title: string
  effectiveDate: string
  children: React.ReactNode
}) {
  return (
    <div className="force-dark dark flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark className="h-8 w-8" />
            <span className="text-lg font-bold tracking-tight">{siteConfig.name}</span>
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Open workspace
          </Link>
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        {/* Ambient background aura glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[500px] w-full max-w-5xl -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-brand-600/15 via-purple-600/10 to-transparent blur-3xl"
        />

        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="mb-8 flex items-center justify-between">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to workspace</span>
            </Link>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
              <Shield className="h-3.5 w-3.5 text-brand-400" />
              <span>Published by {siteConfig.publisher}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md sm:p-10">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Effective {effectiveDate}</p>

            <div className="prose-legal mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
              {children}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{heading}</h2>
      {children}
    </section>
  )
}
