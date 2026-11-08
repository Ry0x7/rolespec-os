import Link from "next/link"

/**
 * Shared chrome for /terms and /privacy.
 *
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
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to RoleSpec
      </Link>

      <h1 className="mt-8 text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Effective {effectiveDate}</p>

      <div className="prose-legal mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </main>
  )
}

export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
      {children}
    </section>
  )
}
