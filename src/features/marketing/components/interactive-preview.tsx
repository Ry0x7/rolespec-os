"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Briefcase,
  Check,
  CheckCircle2,
  Cpu,
  FileText,
  Gauge,
  Mail,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react"
import { cn } from "@/shared/lib/utils"

type TabKey = "resume" | "ats" | "outreach" | "local-ai"

export function InteractivePreview() {
  const [activeTab, setActiveTab] = useState<TabKey>("resume")

  return (
    <div className="relative mx-auto w-full max-w-xl">
      {/* Decorative ambient backdrop glow behind the preview */}
      <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-brand-600/30 via-indigo-600/20 to-purple-600/30 blur-xl opacity-75 transition-all duration-500" />

      {/* Main glass card container */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/90 shadow-2xl backdrop-blur-xl">
        {/* Top title bar & tab navigation */}
        <div className="border-b border-border bg-muted/40 p-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-error/70" />
              <span className="h-3 w-3 rounded-full bg-warning/70" />
              <span className="h-3 w-3 rounded-full bg-success/70" />
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                workspace.rolespec
              </span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-300">
              <ShieldCheck className="h-3 w-3 text-brand-400" />
              100% Offline Capable
            </span>
          </div>

          {/* Interactive Navigation Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pt-1 no-scrollbar">
            {(
              [
                { key: "resume", label: "Resume Studio", icon: FileText },
                { key: "ats", label: "ATS Scanner", icon: Gauge },
                { key: "outreach", label: "Outreach", icon: Mail },
                { key: "local-ai", label: "Local Models", icon: Cpu },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon
              const isSelected = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                    isSelected
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80 hover:bg-muted/50"
                  )}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="active-tab-indicator"
                      className="absolute inset-0 rounded-lg bg-brand-500/20 border border-brand-500/40 shadow-glow-sm"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                  <Icon className="relative z-10 h-3.5 w-3.5 text-brand-400" />
                  <span className="relative z-10 whitespace-nowrap">{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content area */}
        <div className="p-4 sm:p-6 min-h-[310px]">
          <AnimatePresence mode="wait">
            {activeTab === "resume" && (
              <motion.div
                key="resume"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Lead Product Designer</p>
                      <p className="text-xs text-muted-foreground">Tailored for Vercel • 3 versions saved</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded bg-brand-500/10 px-2 py-0.5 text-xs font-semibold text-brand-300">
                    <Sparkles className="h-3 w-3" />
                    AI Enhanced
                  </span>
                </div>

                <div className="space-y-2 rounded-xl border border-border bg-background/80 p-3.5">
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>Target Experience Bullet</span>
                    <span className="text-brand-400 font-mono">+8 Keywords Matched</span>
                  </div>
                  <p className="text-xs sm:text-sm leading-relaxed text-foreground">
                    &ldquo;Architected end-to-end design systems and conducted 40+ usability interviews,
                    accelerating sprint release velocity by <span className="bg-brand-500/20 text-brand-300 px-1 py-0.5 rounded font-medium">32%</span> and boosting customer activation.&rdquo;
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/60">
                    {["Design Systems", "Usability Testing", "Sprint Velocity", "Figma"].map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-300 font-medium"
                      >
                        <Check className="h-2.5 w-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    Export ready (PDF / DOCX)
                  </span>
                  <span className="font-mono text-brand-300">ATS Match: 96%</span>
                </div>
              </motion.div>
            )}

            {activeTab === "ats" && (
              <motion.div
                key="ats"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">ATS Compatibility Scan</p>
                    <p className="text-xs text-muted-foreground">Simulated against Taleo, Greenhouse & Lever</p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold font-mono text-success">94</span>
                    <span className="text-xs text-muted-foreground"> / 100</span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {[
                    { label: "Target Keyword Coverage", score: "98%", status: "Excellent", color: "bg-success" },
                    { label: "Measurable Impact Metrics", score: "92%", status: "Strong", color: "bg-brand-400" },
                    { label: "Formatting & Single-Column Parser", score: "100%", status: "Verified", color: "bg-success" },
                  ].map((item) => (
                    <div key={item.label} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-mono font-medium text-foreground">{item.score}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: item.score }}
                          transition={{ duration: 0.8, ease: "easeOut" }}
                          className={cn("h-full rounded-full", item.color)}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-success/30 bg-success/5 p-2.5 text-xs text-success flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Resume passed all ATS screening criteria with 0 critical warnings.</span>
                </div>
              </motion.div>
            )}

            {activeTab === "outreach" && (
              <motion.div
                key="outreach"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-brand-400" />
                    <p className="text-sm font-semibold">Personalized Outreach Email</p>
                  </div>
                  <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                    Hiring Manager Tone
                  </span>
                </div>

                <div className="rounded-lg border border-border bg-background p-3 text-xs leading-relaxed space-y-2 font-mono">
                  <p className="text-muted-foreground">
                    <span className="text-brand-300">Subject:</span> Lead Product Designer role — design systems & velocity
                  </p>
                  <p className="text-foreground">
                    &ldquo;Hi Alex, I saw Vercel is expanding its design infrastructure team. In my last role, I scaled our design token pipeline across 14 engineers, cutting review latency in half. I’d love to share ideas on how this aligns with your product goals.&rdquo;
                  </p>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Drafted from your master resume & job description</span>
                  <span className="text-brand-400 font-medium">1-click copy</span>
                </div>
              </motion.div>
            )}

            {activeTab === "local-ai" && (
              <motion.div
                key="local-ai"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-brand-400" />
                    <p className="text-sm font-semibold">Local AI Inference Runner</p>
                  </div>
                  <span className="rounded bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-400 border border-green-500/20">
                    Zero API Cost
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 p-2.5 space-y-1">
                    <p className="text-xs font-semibold text-foreground">Ollama</p>
                    <p className="text-[11px] text-muted-foreground">Running on localhost:11434</p>
                    <div className="flex items-center gap-1 text-[10px] text-green-400 pt-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                      Qwen 2.5 / Llama 3
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1">
                    <p className="text-xs font-semibold text-foreground">LM Studio</p>
                    <p className="text-[11px] text-muted-foreground">Local OpenAI-compatible API</p>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground pt-1">
                      <Zap className="h-3 w-3 text-brand-400" />
                      Hardware accelerated
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-background p-2.5 text-xs text-muted-foreground flex items-center justify-between">
                  <span>Your career data never leaves this machine.</span>
                  <span className="font-mono text-brand-300">100% Private</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
