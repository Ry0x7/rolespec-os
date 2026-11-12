import React from "react"
import { ShieldCheck } from "lucide-react"

export function ShowcaseFooter() {
  return (
    <footer className="border-t border-white/[0.08] bg-[#07070c] py-14 text-xs text-zinc-500">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col items-center md:items-start gap-2">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-purple-600/20 border border-purple-500/40 flex items-center justify-center font-display font-bold text-xs text-purple-300">
                R
              </div>
              <span className="font-display font-bold text-sm text-white">RoleSpec OS</span>
              <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                v1.0.5 / v2.0.1
              </span>
            </div>
            <p className="text-center md:text-left text-zinc-400 max-w-md">
              Sovereign, local-first career operating system engineered for senior engineers and engineering leaders.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 font-mono text-xs">
            <a
              href="https://github.com/Ry0x7/rolespec-os"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-white transition-colors"
            >
              GitHub Source
            </a>
            <a
              href="https://github.com/Ry0x7/rolespec-os/releases/tag/v1.0.5"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-white transition-colors"
            >
              v1.0.5 Release Notes
            </a>
            <a
              href="https://github.com/Ry0x7/rolespec-os/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-white transition-colors"
            >
              AGPL-3.0 License
            </a>
            <a
              href="https://github.com/Ry0x7"
              target="_blank"
              rel="noreferrer"
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              Publisher: Chryypt
            </a>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left text-[11px] text-zinc-500 font-mono">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span>Air-gapped and single-owner sovereign design. Zero telemetry collected.</span>
          </div>
          <div>
            © {new Date().getFullYear()} RoleSpec OS • Published under AGPL-3.0 by Chryypt
          </div>
        </div>
      </div>
    </footer>
  )
}
