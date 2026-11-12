import React from "react"
import { Cpu, Terminal, Cloud, Shield, CheckCircle } from "lucide-react"

export function ModelMatrix() {
  const providerCategories = [
    {
      title: "Local Offline Inference",
      tag: "Air-Gapped Privacy",
      icon: Cpu,
      color: "border-purple-500/30 bg-purple-500/5",
      models: [
        { name: "Ollama", desc: "Llama 3.3 70B, DeepSeek-R1 32B, Qwen 2.5 Coder", status: "Zero Network" },
        { name: "LM Studio", desc: "Local OpenAI-compatible endpoint with GPU acceleration", status: "Localhost" },
        { name: "Local vLLM", desc: "High-throughput speculative decoding server", status: "Self-Hosted" },
      ],
    },
    {
      title: "CLI & Developer Tools",
      tag: "Terminal Native",
      icon: Terminal,
      color: "border-cyan-500/30 bg-cyan-500/5",
      models: [
        { name: "Claude Code CLI", desc: "Native authentication and subagent workflow integration", status: "Integrated" },
        { name: "Codex CLI", desc: "Command-line code generation and resume diff review", status: "Integrated" },
        { name: "OpenCode MCP", desc: "Model Context Protocol client for IDE orchestration", status: "Active" },
      ],
    },
    {
      title: "Direct BYOK Cloud LLMs",
      tag: "Zero Markup",
      icon: Cloud,
      color: "border-indigo-500/30 bg-indigo-500/5",
      models: [
        { name: "Anthropic Claude 3.7", desc: "Hybrid reasoning with extended thinking tokens", status: "Official SDK" },
        { name: "OpenAI GPT-4o / o3", desc: "Multimodal and structured JSON schema outputs", status: "Official SDK" },
        { name: "Google Gemini 2.5", desc: "Deep context window analysis of full job portfolios", status: "Official SDK" },
        { name: "DeepSeek V3 / R1", desc: "Ultra-cost-effective reasoning and ATS parsing", status: "BYOK Key" },
      ],
    },
  ]

  return (
    <section id="models" className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-20 border-t border-white/[0.06]">
      <div className="mb-14 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-mono font-medium text-cyan-300">
          <Cpu className="h-3.5 w-3.5 text-cyan-400" />
          <span>Universal Provider Matrix</span>
        </div>
        <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
          Bring Your Own Model. Or Stay Completely Offline.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm sm:text-base text-zinc-400">
          RoleSpec OS integrates with Vercel AI SDK 4 to let you swap models per task. Never pay a 3x SaaS subscription markup on AI tokens.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {providerCategories.map((cat) => {
          const Icon = cat.icon
          return (
            <div
              key={cat.title}
              className={`rounded-2xl border ${cat.color} p-6 backdrop-blur-sm flex flex-col justify-between`}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <h3 className="font-display text-base font-bold text-white">{cat.title}</h3>
                  </div>
                  <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                    {cat.tag}
                  </span>
                </div>

                <div className="space-y-3 mt-6">
                  {cat.models.map((m) => (
                    <div
                      key={m.name}
                      className="rounded-xl border border-white/5 bg-black/40 p-3 hover:border-white/15 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-white">{m.name}</span>
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.2 rounded">
                          <CheckCircle className="h-2.5 w-2.5" />
                          {m.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-400">{m.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-white/5 flex items-center gap-2 text-zinc-500 font-mono text-[11px]">
                <Shield className="h-3.5 w-3.5 text-zinc-400" />
                <span>Zero telemetry sent to RoleSpec servers</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
