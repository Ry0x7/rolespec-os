import React from "react"
import { EyeOff, Sparkles, Download } from "lucide-react"

interface ShowcaseNavProps {
  isReducedMotion: boolean
  onToggleMotion: () => void
}

export function ShowcaseNav({ isReducedMotion, onToggleMotion }: ShowcaseNavProps) {
  return (
    <header className="glass sticky top-0 z-50 w-full border-b border-white/[0.08] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <a href="#" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 p-0.5 shadow-[0_0_15px_rgba(168,85,247,0.4)]">
              <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-[#09090e]">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-purple-400" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                </svg>
              </div>
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-white group-hover:text-purple-300 transition-colors">
              RoleSpec <span className="text-purple-400">OS</span>
            </span>
          </a>

          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-purple-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            v2.0.1 / v1.0.5
          </span>
        </div>

        {/* Links */}
        <nav aria-label="Main" className="hidden md:flex items-center gap-7 font-sans text-sm font-medium text-zinc-400">
          <a href="#hyperframes" className="hover:text-white transition-colors">
            Hyperframes
          </a>
          <a href="#features" className="hover:text-white transition-colors">
            Core Workflows
          </a>
          <a href="#models" className="hover:text-white transition-colors">
            AI Models
          </a>
          <a href="#quickstart" className="hover:text-white transition-colors">
            Downloads
          </a>
        </nav>

        {/* Actions & Motion Controls */}
        <div className="flex items-center gap-2.5">
          {/* Reduce Motion Toggle Button */}
          <button
            type="button"
            onClick={onToggleMotion}
            aria-label={isReducedMotion ? "Reduced motion active. Click to enable full animations." : "Full motion active. Click to reduce animations."}
            title={isReducedMotion ? "Reduced motion enabled (click to enable full motion)" : "Full motion active (click to reduce motion)"}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-mono font-medium transition-all ${
              isReducedMotion
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                : "border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20"
            }`}
          >
            {isReducedMotion ? (
              <>
                <EyeOff className="h-3.5 w-3.5 text-amber-400" />
                <span className="hidden sm:inline">Reduce Motion: On</span>
                <span className="sm:hidden">Reduced</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                <span className="hidden sm:inline">Motion: Full</span>
                <span className="sm:hidden">Motion</span>
              </>
            )}
          </button>

          {/* GitHub Link */}
          <a
            href="https://github.com/Ry0x7/rolespec-os"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub Repository"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:border-white/20 hover:text-white transition-all"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span>GitHub</span>
          </a>

          {/* Windows Download CTA */}
          <a
            href="https://github.com/Ry0x7/rolespec-os/releases/download/v1.0.5/RoleSpec_1.0.5_x64-setup.exe"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_15px_rgba(147,51,234,0.35)] hover:from-purple-500 hover:to-indigo-500 transition-all"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Download Windows</span>
            <span className="sm:hidden">Download</span>
          </a>
        </div>
      </div>
    </header>
  )
}
