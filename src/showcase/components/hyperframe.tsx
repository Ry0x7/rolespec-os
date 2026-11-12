/* eslint-disable @next/next/no-img-element */
import React, { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  FileText,
  Sparkles,
  GitCompare,
  Kanban,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  ExternalLink,
  ShieldCheck,
  Maximize2,
  Terminal,
  Layers,
} from "lucide-react"

interface HyperframeProps {
  isReducedMotion: boolean
}

type TabKey = "ats" | "diff" | "pipeline" | "screenshots"

export function Hyperframe({ isReducedMotion }: HyperframeProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("ats")
  const [diffApplied, setDiffApplied] = useState(true)
  const [selectedScreenshot, setSelectedScreenshot] = useState<number>(0)
  const [atsViewMode, setAtsViewMode] = useState<"visual" | "raw">("visual")

  const screenshots = [
    {
      title: "Workspace & Application Dashboard",
      file: "RoleSpecOS/workspace.png",
      tag: "v1.0.5 UI",
      desc: "Full overview of active job matches, ATS readiness, resume pipelines, and real-time telemetry.",
    },
    {
      title: "AI Resume Studio & Realtime Editor",
      file: "RoleSpecOS/resume-editor.png",
      tag: "Deep Alignment",
      desc: "Side-by-side semantic diffing, atomic rollbacks, and instant PDF rendering powered by React-PDF.",
    },
    {
      title: "Job Discovery & Grounded Research",
      file: "RoleSpecOS/jobs-discover.png",
      tag: "Opportunity Radar",
      desc: "Salary transparency, visa sponsorship filters, and automated company dossier research.",
    },
  ]

  const tabTransition = isReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 350, damping: 30 }

  return (
    <div id="hyperframes" className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-16">
      {/* Section Header */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-mono font-medium text-purple-300">
          <Terminal className="h-3.5 w-3.5 text-purple-400" />
          <span>Interactive Hyperframe • RoleSpec OS v1.0.5</span>
        </div>
        <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
          Simulated Desktop Runtime.{" "}
          <span className="text-gradient">No Cloud Leaks.</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm sm:text-base text-zinc-400">
          Switch between live interactive workflows below to test the ATS Matcher, atomic rollback resume diffs,
          opportunity radar, and production screenshots.
        </p>
      </div>

      {/* The Hyperframe Window */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0c0c14] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8),0_0_35px_rgba(168,85,247,0.15)]">
        {/* Window Chrome / Titlebar */}
        <div className="flex flex-wrap items-center justify-between border-b border-white/[0.08] bg-[#12121c]/90 px-4 py-3 backdrop-blur-md">
          {/* Traffic lights & App Name */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="h-3 w-3 rounded-full bg-[#ff5f56] shadow-sm inline-block" />
              <span className="h-3 w-3 rounded-full bg-[#ffbd2e] shadow-sm inline-block" />
              <span className="h-3 w-3 rounded-full bg-[#27c93f] shadow-sm inline-block" />
            </div>
            <div className="h-4 w-px bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-zinc-300">RoleSpec OS</span>
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                127.0.0.1:3100
              </span>
            </div>
          </div>

          {/* Interactive Mode Tabs */}
          <div className="flex items-center gap-1 mt-2 sm:mt-0 p-1 rounded-xl bg-black/40 border border-white/5">
            <button
              type="button"
              onClick={() => setActiveTab("ats")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                activeTab === "ats"
                  ? "bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>ATS Matcher</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("diff")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                activeTab === "diff"
                  ? "bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <GitCompare className="h-3.5 w-3.5" />
              <span>Resume Diff</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("pipeline")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                activeTab === "pipeline"
                  ? "bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <Kanban className="h-3.5 w-3.5" />
              <span>Opportunity Radar</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("screenshots")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                activeTab === "screenshots"
                  ? "bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>v1.0.5 Screenshots</span>
            </button>
          </div>
        </div>

        {/* Hyperframe Stage / Canvas */}
        <div className="min-h-[460px] p-5 sm:p-7 bg-gradient-to-b from-[#0a0a10] to-[#0d0d16]">
          <AnimatePresence mode="wait">
            {/* SCENE 1: ATS MATCH & RADAR */}
            {activeTab === "ats" && (
              <motion.div
                key="scene-ats"
                initial={isReducedMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={isReducedMotion ? {} : { opacity: 0, y: -10 }}
                transition={tabTransition}
                className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
              >
                {/* Left Card: Score Breakdown */}
                <div className="lg:col-span-5 rounded-xl border border-white/10 bg-[#12121e]/80 p-5 backdrop-blur-sm">
                  <div className="flex items-center justify-between pb-4 border-b border-white/5">
                    <div>
                      <span className="font-mono text-[11px] uppercase tracking-wider text-purple-400 font-semibold">
                        Target Role
                      </span>
                      <h4 className="font-display text-base font-bold text-white">
                        Staff AI Engineer @ Anthropic
                      </h4>
                    </div>
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-300 border border-emerald-500/20">
                      <ShieldCheck className="h-3 w-3" />
                      ATS Pass
                    </span>
                  </div>

                  {/* Circular Radar Radial */}
                  <div className="my-6 flex items-center justify-center">
                    <div className="relative flex h-36 w-36 items-center justify-center rounded-full border-4 border-purple-500/20 bg-purple-950/20 shadow-[0_0_30px_rgba(168,85,247,0.25)]">
                      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
                        <circle
                          cx="50"
                          cy="50"
                          r="42"
                          stroke="currentColor"
                          strokeWidth="7"
                          fill="none"
                          className="text-white/5"
                        />
                        <circle
                          cx="50"
                          cy="50"
                          r="42"
                          stroke="url(#atsGrad)"
                          strokeWidth="7"
                          strokeDasharray={264}
                          strokeDashoffset={264 * (1 - 0.94)}
                          strokeLinecap="round"
                          fill="none"
                          className="transition-all duration-1000"
                        />
                        <defs>
                          <linearGradient id="atsGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#a855f7" />
                            <stop offset="100%" stopColor="#22d3ee" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="text-center">
                        <div className="font-display text-3xl font-extrabold text-white">94%</div>
                        <div className="font-mono text-[10px] uppercase text-zinc-400 tracking-wider">
                          Match Index
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Criteria Meters */}
                  <div className="space-y-3 font-mono text-xs">
                    <div>
                      <div className="flex justify-between text-zinc-300 mb-1">
                        <span>Keyword Density</span>
                        <span className="text-purple-300">98% (High)</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 w-[98%]" />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-zinc-300 mb-1">
                        <span>Hard Requirements</span>
                        <span className="text-cyan-300">91% (10/11 matched)</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 w-[91%]" />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-zinc-300 mb-1">
                        <span>Semantic Vector Cohesion</span>
                        <span className="text-emerald-300">95% (Strong)</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 w-[95%]" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Card: Keyword Analysis & Raw ATS Parse */}
                <div className="lg:col-span-7 rounded-xl border border-white/10 bg-[#12121e]/80 p-5 backdrop-blur-sm">
                  <div className="flex items-center justify-between pb-3 border-b border-white/5">
                    <span className="font-mono text-xs font-semibold text-zinc-200">
                      Keyword Gap & Alignment Radar
                    </span>
                    <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/5 text-[11px] font-mono">
                      <button
                        type="button"
                        onClick={() => setAtsViewMode("visual")}
                        className={`px-2 py-0.5 rounded ${
                          atsViewMode === "visual" ? "bg-white/10 text-white" : "text-zinc-400"
                        }`}
                      >
                        Visual
                      </button>
                      <button
                        type="button"
                        onClick={() => setAtsViewMode("raw")}
                        className={`px-2 py-0.5 rounded ${
                          atsViewMode === "raw" ? "bg-white/10 text-white" : "text-zinc-400"
                        }`}
                      >
                        ATS Raw Parse
                      </button>
                    </div>
                  </div>

                  {atsViewMode === "visual" ? (
                    <div className="mt-4 space-y-4">
                      <div>
                        <div className="text-xs font-medium text-emerald-400 mb-2 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Matched Critical Tokens ({14})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            "Distributed Systems",
                            "Rust / Tokio",
                            "vLLM & TensorRT",
                            "PostgreSQL Vector",
                            "Model Context Protocol",
                            "PyTorch",
                            "Kubernetes",
                            "Triton Inference",
                            "Prompt Orchestration",
                          ].map((token) => (
                            <span
                              key={token}
                              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-300"
                            >
                              ✓ {token}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-medium text-amber-400 mb-2 flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>Missing High-Weight Tokens (2)</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-300">
                            <span>CUDA Kernels</span>
                            <span className="text-[10px] text-amber-400/80">• +3.2 pts</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-300">
                            <span>Speculative Decoding</span>
                            <span className="text-[10px] text-amber-400/80">• +2.8 pts</span>
                          </span>
                        </div>
                      </div>

                      <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs text-purple-200/90 leading-relaxed">
                        <div className="font-semibold text-purple-300 mb-1 flex items-center gap-1">
                          <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                          Local AI Recommendation (Ollama / Claude Code / Codex)
                        </div>
                        Synthesize experience bullet under Senior ML Engineer describing CUDA kernel
                        benchmarks for batch inference to raise score to 99%.
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg bg-black/60 p-3 font-mono text-[11px] text-zinc-300 border border-white/5 space-y-1">
                      <div className="text-zinc-500">{"// ATS Parser Output v2.4 (Simulated Workday/Taleo Extraction)"}</div>
                      <div className="text-purple-400">ROLE_TARGET: &quot;Staff AI Engineer&quot;</div>
                      <div>CANDIDATE: &quot;Lead Systems Architect&quot; [ID: RS-8921]</div>
                      <div className="text-cyan-400">EXPERIENCE_TOTAL_MONTHS: 104</div>
                      <div className="text-emerald-400">HARD_MATCH_COUNT: 11/12 (91.6%)</div>
                      <div className="text-zinc-400">PARSER_STATUS: CLEAN_NO_TABLE_FAILS</div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* SCENE 2: RESUME DIFF & ATOMIC ROLLBACK */}
            {activeTab === "diff" && (
              <motion.div
                key="scene-diff"
                initial={isReducedMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={isReducedMotion ? {} : { opacity: 0, y: -10 }}
                transition={tabTransition}
                className="space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[#12121e] border border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-mono text-xs text-zinc-300">
                      Revision #4 • Tailored for <strong className="text-white">Staff AI Engineer</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDiffApplied(!diffApplied)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/20 px-3 py-1 font-mono text-xs font-medium text-purple-200 hover:bg-purple-500/30 transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>{diffApplied ? "Revert to Previous Revision" : "Apply AI Tailored Diff"}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left: Original Base Resume */}
                  <div className="rounded-xl border border-white/10 bg-[#0e0e16] p-4">
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center justify-between">
                      <span>Base Resume (Original)</span>
                      <span className="text-zinc-500">v1.0.0</span>
                    </div>
                    <div className="space-y-3 font-sans text-xs text-zinc-400 leading-relaxed">
                      <p>
                        • Architected distributed inference microservices across 32 GPU nodes handling
                        traffic spikes.
                      </p>
                      <p>
                        • Worked on optimizing vector similarity search using PostgreSQL and pgvector for
                        agent recall.
                      </p>
                      <p>
                        • Mentored 4 engineers and improved team test coverage to 85% across all core
                        repositories.
                      </p>
                    </div>
                  </div>

                  {/* Right: AI Tailored Diff */}
                  <div className="rounded-xl border border-purple-500/30 bg-[#141224] p-4 relative overflow-hidden">
                    <div className="absolute top-0 right-0 h-16 w-16 bg-purple-500/10 blur-xl pointer-events-none" />
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-purple-300 mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                        RoleSpec OS AI Tailored Bullet (Atomic Diff)
                      </span>
                      <span className="text-emerald-400 font-mono text-[10px]">
                        {diffApplied ? "+12% ATS MATCH" : "REVERTED"}
                      </span>
                    </div>

                    <div className="space-y-3 font-sans text-xs leading-relaxed">
                      {diffApplied ? (
                        <>
                          <div className="rounded border-l-2 border-emerald-500 bg-emerald-500/10 p-2 text-emerald-200 font-mono text-[11px]">
                            + Architected high-throughput vLLM &amp; TensorRT-LLM inference pipelines across
                            32 Hopper H100 nodes, slashing P99 latency by 44% while serving 1.2M daily agent
                            requests.
                          </div>
                          <div className="rounded border-l-2 border-emerald-500 bg-emerald-500/10 p-2 text-emerald-200 font-mono text-[11px]">
                            + Engineered hybrid dense-sparse vector indexing atop PostgreSQL pgvector and HNSW
                            indexes, unlocking sub-15ms semantic retrieval for multi-turn agent contexts.
                          </div>
                          <p className="text-zinc-400">
                            • Led technical design reviews and established zero-downtime blue-green canary
                            deployments across Kubernetes clusters.
                          </p>
                        </>
                      ) : (
                        <p className="text-zinc-400 italic">
                          Diff reverted. Original text active. Click &quot;Apply AI Tailored Diff&quot; above
                          to compare enhancements.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* SCENE 3: KANBAN RADAR & PIPELINE */}
            {activeTab === "pipeline" && (
              <motion.div
                key="scene-pipeline"
                initial={isReducedMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={isReducedMotion ? {} : { opacity: 0, y: -10 }}
                transition={tabTransition}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Column 1: Match Radar */}
                  <div className="rounded-xl border border-white/10 bg-[#12121e]/80 p-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-3">
                      <span className="font-mono text-xs font-semibold text-zinc-300">
                        1. Radar / Sourced
                      </span>
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                        3 Roles
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 hover:border-purple-500/50 transition-colors cursor-pointer">
                        <div className="flex justify-between items-start">
                          <span className="font-display font-semibold text-xs text-white">
                            Staff AI Engineer
                          </span>
                          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
                            94%
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-1">Anthropic • SF / Remote</div>
                        <div className="flex items-center gap-2 mt-2 font-mono text-[10px] text-purple-300">
                          <span>$320k - $460k</span>
                          <span>•</span>
                          <span>Visa: Yes</span>
                        </div>
                      </div>

                      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 hover:border-white/20 transition-colors cursor-pointer">
                        <div className="flex justify-between items-start">
                          <span className="font-display font-semibold text-xs text-white">
                            Founding LLM Systems Lead
                          </span>
                          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded">
                            89%
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-1">Cognition AI • Remote</div>
                        <div className="flex items-center gap-2 mt-2 font-mono text-[10px] text-zinc-400">
                          <span>$280k - $410k + Equity</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Column 2: Tailored & In Review */}
                  <div className="rounded-xl border border-white/10 bg-[#12121e]/80 p-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-3">
                      <span className="font-mono text-xs font-semibold text-zinc-300">
                        2. Tailored &amp; Ready
                      </span>
                      <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-mono text-purple-300">
                        2 Ready
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 hover:border-cyan-500/50 transition-colors cursor-pointer">
                        <div className="flex justify-between items-start">
                          <span className="font-display font-semibold text-xs text-white">
                            Principal Infra Architect
                          </span>
                          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
                            97%
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-1">Mistral AI • Paris / Remote</div>
                        <div className="mt-2 text-[10px] font-mono text-cyan-300 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>PDF Rendered &amp; ATS Verified</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Column 3: Active Interviews */}
                  <div className="rounded-xl border border-white/10 bg-[#12121e]/80 p-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-3">
                      <span className="font-mono text-xs font-semibold text-zinc-300">
                        3. Technical Rounds
                      </span>
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
                        1 Active
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
                        <div className="flex justify-between items-start">
                          <span className="font-display font-semibold text-xs text-white">
                            Senior Systems Engineer
                          </span>
                          <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded">
                            Round 3
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-1">Stripe • Remote</div>
                        <div className="mt-2 rounded bg-black/40 p-2 text-[10px] font-mono text-zinc-300">
                          Next: Distributed Consensus Deep Dive on Friday 2 PM PST
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* SCENE 4: REAL v1.0.5 SCREENSHOTS SHOWCASE */}
            {activeTab === "screenshots" && (
              <motion.div
                key="scene-screenshots"
                initial={isReducedMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={isReducedMotion ? {} : { opacity: 0, y: -10 }}
                transition={tabTransition}
                className="space-y-5"
              >
                {/* Thumbnails Picker */}
                <div className="flex flex-wrap items-center gap-3">
                  {screenshots.map((s, idx) => (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => setSelectedScreenshot(idx)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                        selectedScreenshot === idx
                          ? "border-purple-500 bg-purple-500/20 text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                          : "border-white/10 bg-white/5 text-zinc-400 hover:text-white"
                      }`}
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span>{s.title}</span>
                      <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-purple-300">
                        {s.tag}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Screenshot Display Card */}
                <div className="overflow-hidden rounded-xl border border-white/10 bg-[#09090f] shadow-2xl">
                  <div className="relative aspect-[16/9] w-full bg-black/50 overflow-hidden flex items-center justify-center">
                    <img
                      src={screenshots[selectedScreenshot].file}
                      alt={screenshots[selectedScreenshot].title}
                      className="h-full w-full object-cover object-top transition-transform duration-500 hover:scale-[1.02]"
                    />
                    <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-display font-bold text-white text-sm">
                          {screenshots[selectedScreenshot].title}
                        </div>
                        <div className="text-zinc-300 text-xs mt-0.5 max-w-xl">
                          {screenshots[selectedScreenshot].desc}
                        </div>
                      </div>
                      <a
                        href={screenshots[selectedScreenshot].file}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-white/10 backdrop-blur-md px-2.5 py-1 text-xs text-white hover:bg-white/20 transition-colors"
                      >
                        <span>Full Resolution</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Hyperframe Footer Bar */}
        <div className="flex flex-wrap items-center justify-between border-t border-white/[0.08] bg-[#0e0e16] px-5 py-3 text-xs text-zinc-400 font-mono">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>Single-Owner Local Sandboxed Security Model</span>
          </div>
          <div className="flex items-center gap-4 mt-2 sm:mt-0">
            <span>PostgreSQL Native Adapter</span>
            <span>React 19 &amp; Next.js 16</span>
            <span className="text-purple-400">AGPL-3.0</span>
          </div>
        </div>
      </div>
    </div>
  )
}
