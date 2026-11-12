import React, { useState, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "framer-motion"
import {
  Download,
  ShieldCheck,
  ArrowRight,
  Cpu,
  CheckCircle,
} from "lucide-react"

import { HiggsfieldAura } from "./components/higgsfield-aura"
import { ShowcaseNav } from "./components/showcase-nav"
import { Hyperframe } from "./components/hyperframe"
import { FeatureGrid } from "./components/feature-grid"
import { ModelMatrix } from "./components/model-matrix"
import { QuickstartTabs } from "./components/quickstart-tabs"
import { ShowcaseFooter } from "./components/showcase-footer"

function ShowcaseApp() {
  const [isReducedMotion, setIsReducedMotion] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    const stored = localStorage.getItem("rolespec-motion")
    if (stored === "reduced") return true
    if (stored === "full") return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  })

  useEffect(() => {
    const root = document.documentElement
    if (isReducedMotion) {
      root.classList.add("reduce-motion")
      root.classList.remove("motion-full")
    } else {
      root.classList.add("motion-full")
      root.classList.remove("reduce-motion")
    }
  }, [isReducedMotion])

  const toggleMotion = () => {
    setIsReducedMotion((prev) => {
      const next = !prev
      localStorage.setItem("rolespec-motion", next ? "reduced" : "full")
      return next
    })
  }

  const downloadUrl =
    "https://github.com/Ry0x7/rolespec-os/releases/download/v1.0.5/RoleSpec_1.0.5_x64-setup.exe"

  return (
    <MotionConfig reducedMotion={isReducedMotion ? "always" : "never"}>
      <div className="relative min-h-screen bg-[#07070a] text-[#f4f4f7] selection:bg-purple-500/30 selection:text-white">
        {/* Generative Higgsfield Particle Aura */}
        <HiggsfieldAura isReducedMotion={isReducedMotion} />

        {/* Global Nav with Reduce Motion Toggle */}
        <ShowcaseNav isReducedMotion={isReducedMotion} onToggleMotion={toggleMotion} />

        {/* HERO SECTION */}
        <section className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-12 sm:pb-20 text-center">
          <div className="mx-auto max-w-4xl space-y-6">
            {/* Release Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-950/40 px-3.5 py-1.5 backdrop-blur-md shadow-[0_0_20px_rgba(168,85,247,0.25)]">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-xs font-semibold text-purple-200">
                Release v1.0.5 is Live
              </span>
              <span className="text-zinc-500">•</span>
              <span className="font-mono text-[11px] text-zinc-300">Windows x64 &amp; Docker</span>
            </div>

            {/* Main Headline */}
            <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.08]">
              The Sovereign Career <br className="hidden sm:inline" />
              <span className="text-gradient">Operating System.</span>
            </h1>

            {/* Subheading */}
            <p className="mx-auto max-w-2xl font-sans text-base sm:text-lg lg:text-xl text-zinc-300 leading-relaxed">
              Deterministic ATS matching, atomic resume diff rollbacks, and offline-first opportunity
              radar. Powered by local LLMs or BYOK cloud models in a 100% private sandbox.
            </p>

            {/* Action CTA Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
              <a
                href={downloadUrl}
                className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-3.5 font-sans text-sm font-bold text-white shadow-[0_0_30px_rgba(168,85,247,0.4)] hover:from-purple-500 hover:to-indigo-500 transition-all hover:scale-[1.02]"
              >
                <Download className="h-4.5 w-4.5" />
                <span>Download for Windows (v1.0.5)</span>
              </a>

              <a
                href="#hyperframes"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3.5 font-sans text-sm font-semibold text-zinc-200 backdrop-blur-sm hover:border-white/20 hover:bg-white/10 hover:text-white transition-all"
              >
                <span>Explore Hyperframe</span>
                <ArrowRight className="h-4 w-4 text-purple-400" />
              </a>
            </div>

            {/* Telemetry & Trust Badges */}
            <div className="pt-8 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs font-mono text-zinc-400">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>100% Localhost DB</span>
              </div>
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-purple-400" />
                <span>Ollama / Claude Code / Codex</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-cyan-400" />
                <span>AGPL-3.0 Sovereign Open Source</span>
              </div>
            </div>
          </div>
        </section>

        {/* INTERACTIVE HYPERFRAME WORKFLOWS & REAL SCREENSHOTS */}
        <Hyperframe isReducedMotion={isReducedMotion} />

        {/* 8 CORE WORKFLOWS SPOTLIGHT */}
        <FeatureGrid />

        {/* AI PROVIDER MATRIX */}
        <ModelMatrix />

        {/* QUICKSTART & DOWNLOADS */}
        <QuickstartTabs />

        {/* FOOTER */}
        <ShowcaseFooter />
      </div>
    </MotionConfig>
  )
}

const rootElement = document.getElementById("root")
if (rootElement) {
  createRoot(rootElement).render(<ShowcaseApp />)
}
