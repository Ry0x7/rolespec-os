import React from "react"
import {
  FileCheck2,
  GitBranch,
  Kanban,
  Cpu,
  Search,
  ShieldCheck,
  FileCode2,
  Sparkles,
  Zap,
} from "lucide-react"

export function FeatureGrid() {
  const features = [
    {
      icon: FileCheck2,
      title: "ATS Semantic Match Engine",
      tag: "Deterministic Scoring",
      description:
        "Extracts hard requirements, keyword frequency, and vector embeddings from target job specs. Calculates exact ATS pass probability before you apply.",
      color: "from-purple-500/20 to-purple-500/5",
      border: "hover:border-purple-500/40",
      iconColor: "text-purple-400",
    },
    {
      icon: GitBranch,
      title: "Atomic Diff & Rollback Studio",
      tag: "Version Controlled",
      description:
        "Every AI enhancement is stored as an immutable atomic revision. Inspect visual side-by-side diffs with instantaneous single-click rollback.",
      color: "from-indigo-500/20 to-indigo-500/5",
      border: "hover:border-indigo-500/40",
      iconColor: "text-indigo-400",
    },
    {
      icon: Kanban,
      title: "Opportunity Radar & Kanban",
      tag: "Realtime Pipeline",
      description:
        "Organize targets from discovery to final technical round. View salary telemetry, visa sponsorship status, and automatic follow-up reminders.",
      color: "from-cyan-500/20 to-cyan-500/5",
      border: "hover:border-cyan-500/40",
      iconColor: "text-cyan-400",
    },
    {
      icon: Cpu,
      title: "100% Local AI & BYOK Cloud",
      tag: "Ollama / Claude / Codex",
      description:
        "Run completely offline via local Ollama or LM Studio models, or connect Claude Code, Codex CLI, OpenAI, Anthropic, Gemini, and DeepSeek keys.",
      color: "from-emerald-500/20 to-emerald-500/5",
      border: "hover:border-emerald-500/40",
      iconColor: "text-emerald-400",
    },
    {
      icon: Search,
      title: "Grounded Company Intelligence",
      tag: "Web Extraction",
      description:
        "Automatically synthesize company tech stack, recent engineering blog posts, interview questions, and team structure into a contextual cheat-sheet.",
      color: "from-amber-500/20 to-amber-500/5",
      border: "hover:border-amber-500/40",
      iconColor: "text-amber-400",
    },
    {
      icon: ShieldCheck,
      title: "Zero-Cloud Sovereign Privacy",
      tag: "PostgreSQL Local DB",
      description:
        "Single-owner security model with local PostgreSQL persistence. Your resume, job applications, notes, and compensation data never leave your computer.",
      color: "from-rose-500/20 to-rose-500/5",
      border: "hover:border-rose-500/40",
      iconColor: "text-rose-400",
    },
    {
      icon: FileCode2,
      title: "Pixel-Perfect Vector PDF Engine",
      tag: "React-PDF Native",
      description:
        "Direct vector PDF compilation with standard fonts and clean typography that parses flawlessly through Workday, Greenhouse, Lever, and Taleo.",
      color: "from-purple-500/20 to-indigo-500/5",
      border: "hover:border-purple-500/40",
      iconColor: "text-purple-300",
    },
    {
      icon: Zap,
      title: "Universal Reduce Motion & a11y",
      tag: "WCAG Compliant",
      description:
        "Instant toggle for reduced motion across the entire platform, complete keyboard shortcuts, high-contrast dark palette, and screen reader semantic landmarks.",
      color: "from-cyan-500/20 to-purple-500/5",
      border: "hover:border-cyan-500/40",
      iconColor: "text-cyan-300",
    },
  ]

  return (
    <section id="features" className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <div className="mb-14 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-mono font-medium text-purple-300">
          <Sparkles className="h-3.5 w-3.5 text-purple-400" />
          <span>Engineered for Senior &amp; Staff Engineers</span>
        </div>
        <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
          A Sovereign Career Operating System.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm sm:text-base text-zinc-400">
          Built without bloated subscription paywalls, opaque third-party cloud data harvesting, or generic AI templates.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {features.map((f) => {
          const Icon = f.icon
          return (
            <div
              key={f.title}
              className={`group relative flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-gradient-to-b ${f.color} p-6 backdrop-blur-sm transition-all duration-300 ${f.border} hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-950/20`}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 ${f.iconColor}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                    {f.tag}
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold text-white group-hover:text-purple-200 transition-colors">
                  {f.title}
                </h3>
                <p className="mt-2.5 text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  {f.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
