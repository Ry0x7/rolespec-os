import React from "react"
import { CheckIcon } from "./icons"

const CATEGORIES = [
  {
    title: "Local, offline",
    models: [
      { name: "Ollama", desc: "Llama 3.3 70B, DeepSeek-R1 32B, Qwen 2.5 Coder", status: "Zero network" },
      { name: "LM Studio", desc: "Local OpenAI-compatible endpoint with GPU acceleration", status: "Localhost" },
      { name: "Local vLLM", desc: "High-throughput speculative decoding server", status: "Self-hosted" },
    ],
  },
  {
    title: "Your subscriptions",
    models: [
      { name: "Claude Code CLI", desc: "Sign in with your Claude account; native workflow integration", status: "Integrated" },
      { name: "Codex CLI", desc: "Command-line generation and resume diff review", status: "Integrated" },
      { name: "OpenCode", desc: "Free hosted models where available", status: "Active" },
    ],
  },
  {
    title: "Bring your own key",
    models: [
      { name: "Anthropic", desc: "Claude with extended thinking", status: "Official SDK" },
      { name: "OpenAI", desc: "Multimodal and structured JSON outputs", status: "Official SDK" },
      { name: "Google Gemini", desc: "Deep context over full job portfolios", status: "Official SDK" },
      { name: "DeepSeek", desc: "Cost-effective reasoning and ATS parsing", status: "BYOK key" },
    ],
  },
]

export function ModelMatrix() {
  return (
    <section id="models" aria-labelledby="models-heading" className="mx-auto w-full max-w-5xl scroll-mt-20 px-4 py-16 sm:px-6">
      <div className="mb-12 max-w-2xl">
        <h2 id="models-heading" className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
          Run it your way.
        </h2>
        <p className="mt-3 text-pretty text-base" style={{ color: "var(--text-2)" }}>
          Swap models per task. Run free and offline, or pay providers directly — never a SaaS markup on tokens.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
        {CATEGORIES.map((cat) => (
          <div key={cat.title}>
            <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>{cat.title}</h3>
            <ul className="mt-4 divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {cat.models.map((m) => (
                <li key={m.name} className="border-t py-4" style={{ borderColor: "var(--border-soft)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold">{m.name}</span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--success)" }}>
                      <CheckIcon className="h-3 w-3" /> {m.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>{m.desc}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
