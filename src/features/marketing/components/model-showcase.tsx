"use client"

import { motion } from "framer-motion"
import { Key, Laptop, Lock, Shield, Sparkles } from "lucide-react"

const PROVIDERS = [
  {
    name: "Ollama",
    tagline: "Local & Private",
    type: "local",
    desc: "100% private offline inference with zero telemetry or API bills.",
    badge: "Free & Local",
  },
  {
    name: "LM Studio",
    tagline: "Local GGUF Models",
    type: "local",
    desc: "Run open-weights models with Apple Silicon & CUDA acceleration.",
    badge: "Free & Local",
  },
  {
    name: "ChatGPT / Codex CLI",
    tagline: "Your ChatGPT Account",
    type: "cli",
    desc: "Use your existing ChatGPT Plus or Pro subscription with zero per-token cost.",
    badge: "Subscription",
  },
  {
    name: "Claude Code",
    tagline: "Your Claude Account",
    type: "cli",
    desc: "Sign in with your Claude Pro or Team account directly on your host.",
    badge: "Subscription",
  },
  {
    name: "Bring Your Own Key",
    tagline: "OpenAI, Anthropic, DeepSeek",
    type: "api",
    desc: "Pay providers directly at wholesale token rates. Encrypted with AES-256.",
    badge: "Direct API",
  },
] as const

export function ModelShowcase() {
  return (
    <div className="relative mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {PROVIDERS.map((provider, i) => (
        <motion.div
          key={provider.name}
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: i * 0.08 }}
          whileHover={{ y: -4, transition: { duration: 0.2 } }}
          className="group relative overflow-hidden rounded-xl border border-border bg-card/60 p-5 backdrop-blur-sm transition-colors hover:border-brand-500/40"
        >
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400 group-hover:bg-brand-500/20 group-hover:text-brand-300 transition-colors">
                {provider.type === "local" ? (
                  <Laptop className="h-4 w-4" />
                ) : provider.type === "cli" ? (
                  <Sparkles className="h-4 w-4" />
                ) : (
                  <Key className="h-4 w-4" />
                )}
              </span>
              <span className="font-semibold text-foreground">{provider.name}</span>
            </div>
            <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[10px] font-medium text-brand-300">
              {provider.badge}
            </span>
          </div>
          <p className="text-xs font-medium text-brand-300/90">{provider.tagline}</p>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            {provider.desc}
          </p>
        </motion.div>
      ))}

      {/* Security callout card */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: 0.4 }}
        className="flex flex-col justify-between rounded-xl border border-success/30 bg-success/5 p-5"
      >
        <div className="flex items-center gap-2 text-success">
          <Shield className="h-5 w-5" />
          <span className="font-semibold text-sm text-foreground">Zero Cloud Lock-in</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          RoleSpec never sells subscriptions or proxies AI calls. You own the model bill, or run 100% free with local offline models.
        </p>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-success/90 pt-1">
          <Lock className="h-3 w-3" />
          <span>AES-256 encrypted at rest</span>
        </div>
      </motion.div>
    </div>
  )
}
