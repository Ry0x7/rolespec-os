import Link from "next/link"
import { siteConfig } from "@/config/site"
import { LogoMark } from "./logo-mark"

const FOOTER_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#pricing", label: "Self-hosting" },
  { href: "/sign-in", label: "Sign in" },
  { href: "/sign-up", label: "Create account" },
  // A payment processor and a prospective customer both look for these in the
  // footer, so they need to be reachable without an account.
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
]

export function MarketingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative border-t border-border">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-700/40 to-transparent"
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm space-y-2">
            <div className="flex items-center gap-2">
              <LogoMark className="h-7 w-7" />
              <span className="font-bold tracking-tight">{siteConfig.name}</span>
            </div>
            <p className="text-pretty text-sm text-muted-foreground">
              {siteConfig.tagline} {siteConfig.description}
            </p>
          </div>

          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="flex min-h-11 items-center transition-colors hover:text-brand-300"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            &copy; {year} {siteConfig.name}. All rights reserved.
          </p>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Built for the job hunt
          </p>
        </div>
      </div>
    </footer>
  )
}
