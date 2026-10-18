import Link from "next/link"

/**
 * Shared chrome for /terms and /privacy.
 *
 * The review banner is a deliberate part of the component rather than something
 * each page opts into: both documents are drafted from what this codebase actually
 * does, which is the substantive half of the work, but they are not legal advice
 * and must not ship to paying customers unreviewed. Making the notice structural
 * means it cannot be forgotten in one page and not the other.
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

      <div
        role="note"
        className="mt-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200"
      >
        <p className="font-semibold">Draft — requires legal review before launch.</p>
        <p className="mt-1 text-amber-200/80">
          The data handling described below reflects what the application actually does, and
          it has been verified against the codebase. The legal framing does not constitute
          legal advice: a qualified adviser should review the whole document before it ships
          to paying customers — particularly if you accept payments from the EU, UK or
          California.
        </p>
      </div>

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
