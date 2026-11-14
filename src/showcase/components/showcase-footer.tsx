import React from "react"
import { LogoMarkIcon, CheckIcon } from "./icons"

const LINKS = [
  { href: "https://github.com/Ry0x7/rolespec-os", label: "GitHub source" },
  { href: "https://github.com/Ry0x7/rolespec-os/releases/latest", label: "Latest release" },
  { href: "https://github.com/Ry0x7/rolespec-os/blob/main/LICENSE", label: "AGPL-3.0 license" },
  { href: "https://github.com/Ry0x7", label: "Publisher: Chryypt" },
]

export function ShowcaseFooter() {
  return (
    <footer className="border-t py-10" style={{ borderColor: "var(--border-soft)", background: "var(--surface)" }}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <p className="flex items-center gap-2">
              <LogoMarkIcon className="h-6 w-6" />
              <span className="text-sm font-semibold">RoleSpec OS</span>
              <span className="text-xs" style={{ color: "var(--text-3)" }}>v2.0.1</span>
            </p>
            <p className="max-w-sm text-center text-xs leading-relaxed sm:text-left" style={{ color: "var(--text-2)" }}>
              A local-first career workspace. Published by Chryypt Inc.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm" style={{ color: "var(--text-2)" }}>
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="transition-colors hover:text-[var(--text)]">
                {l.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t pt-6 text-center text-xs sm:flex-row sm:text-left" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
          <p className="flex items-center gap-1.5">
            <CheckIcon className="h-3.5 w-3.5" />
            Single-owner and local-first. Zero telemetry.
          </p>
          <p>© {new Date().getFullYear()} RoleSpec OS · AGPL-3.0</p>
        </div>
      </div>
    </footer>
  )
}
