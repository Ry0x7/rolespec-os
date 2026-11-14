import React, { useRef, useState } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { CheckIcon, ExternalIcon } from "./icons"
import { TiltShot } from "./tilt-shot"

type TabKey = "ats" | "diff" | "pipeline" | "screenshots"

const TABS: { key: TabKey; label: string }[] = [
  { key: "ats", label: "ATS matcher" },
  { key: "diff", label: "Resume diff" },
  { key: "pipeline", label: "Opportunity radar" },
  { key: "screenshots", label: "Screenshots" },
]

export function Hyperframe({ isReducedMotion, theme }: { isReducedMotion: boolean; theme: "light" | "dark" }) {
  const [activeTab, setActiveTab] = useState<TabKey>("ats")
  const [diffApplied, setDiffApplied] = useState(true)
  const [selectedScreenshot, setSelectedScreenshot] = useState(0)
  const [atsViewMode, setAtsViewMode] = useState<"visual" | "raw">("visual")
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const reduce = useReducedMotion()

  const screenshots = [
    { title: "Dashboard", light: "dashboard.png", dark: "dashboard-dark.png", height: 1080, desc: "Today's status, next action, attention and ranked roles in one view." },
    { title: "Job applications", light: "jobs.png", dark: "jobs-dark.png", desc: "Every saved role, fit signal and next step on one board." },
    { title: "Resume editor", light: "resume-editor.png", dark: "resume-editor-dark.png", desc: "Structured editing with a live ATS score and PDF export." },
    { title: "Agent preparation", light: "job-prepare.png", dark: "job-prepare-dark.png", desc: "One click researches, tailors and prepares; you review before submitting." },
    { title: "ATS analysis", light: "job-ats.png", dark: "job-ats-dark.png", desc: "Quality score, sub-scores and concrete suggestions in a drawer." },
    { title: "Pipeline", light: "workspace.png", dark: "workspace-dark.png", desc: "A drag-and-drop pipeline with your weekly goal and outcomes." },
  ]
  const selected = screenshots[selectedScreenshot]
  const selectedFile = theme === "dark" ? selected.dark : selected.light

  function onTabKeyDown(e: React.KeyboardEvent, index: number) {
    let next: number | null = null
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = TABS.length - 1
    if (next !== null) {
      e.preventDefault()
      setActiveTab(TABS[next].key)
      tabRefs.current[next]?.focus()
    }
  }

  const scene = reduce || isReducedMotion
    ? { initial: false as const, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } }

  return (
    <section id="hyperframes" aria-labelledby="hyperframes-heading" className="scroll-mt-20 py-16" style={{ background: "var(--surface)" }}>
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div className="mb-10 text-center">
          <h2 id="hyperframes-heading" className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Try the core workflows
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-base" style={{ color: "var(--text-2)" }}>
            Interactive previews of the ATS matcher, resume diffs and opportunity radar.
            Nothing leaves your browser.
          </p>
        </div>

        <div className="card overflow-hidden" style={{ background: "var(--background)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5" style={{ borderColor: "var(--border-soft)" }}>
            <span className="font-mono text-xs" style={{ color: "var(--text-3)" }}>RoleSpec OS · 127.0.0.1:3100</span>
            <div className="tab-strip" role="tablist" aria-label="Workflow previews">
              {TABS.map((tab, i) => (
                <button
                  key={tab.key}
                  ref={(el) => { tabRefs.current[i] = el }}
                  type="button"
                  role="tab"
                  id={`hyperframe-tab-${tab.key}`}
                  aria-selected={activeTab === tab.key}
                  aria-controls={`hyperframe-panel-${tab.key}`}
                  tabIndex={activeTab === tab.key ? 0 : -1}
                  onClick={() => setActiveTab(tab.key)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className="tab-btn"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-[420px] p-5 sm:p-7">
            <AnimatePresence mode="wait">
              {activeTab === "ats" && (
                <motion.div key="ats" {...scene} transition={{ duration: 0.25 }} role="tabpanel" id="hyperframe-panel-ats" aria-labelledby="hyperframe-tab-ats" className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  <div className="card p-5 lg:col-span-5" style={{ background: "var(--background)", boxShadow: "none" }}>
                    <div className="flex items-start justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-soft)" }}>
                      <div>
                        <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Target role</span>
                        <h3 className="mt-1 text-base font-semibold">Staff AI Engineer @ Anthropic</h3>
                      </div>
                      <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: "var(--success)", background: "rgba(36,138,61,0.1)" }}>
                        <CheckIcon className="h-3 w-3" /> ATS pass
                      </span>
                    </div>

                    <div className="my-6 flex items-center justify-center">
                      <div className="relative flex h-32 w-32 items-center justify-center rounded-full" style={{ border: "4px solid var(--border-soft)" }}>
                        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                          <circle cx="50" cy="50" r="42" stroke="var(--border-soft)" strokeWidth="7" fill="none" />
                          <circle cx="50" cy="50" r="42" stroke="var(--link)" strokeWidth="7" strokeDasharray={264} strokeDashoffset={264 * (1 - 0.94)} strokeLinecap="round" fill="none" />
                        </svg>
                        <div className="text-center">
                          <div className="text-3xl font-semibold tracking-tight">94%</div>
                          <div className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Match index</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 text-xs">
                      {[
                        { label: "Keyword density", value: "98% (high)", width: "98%" },
                        { label: "Hard requirements", value: "91% (10/11 matched)", width: "91%" },
                        { label: "Semantic cohesion", value: "95% (strong)", width: "95%" },
                      ].map((m) => (
                        <div key={m.label}>
                          <div className="mb-1 flex justify-between" style={{ color: "var(--text-2)" }}>
                            <span>{m.label}</span><span className="font-medium" style={{ color: "var(--text)" }}>{m.value}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface)" }}>
                            <div className="h-full rounded-full" style={{ width: m.width, background: "var(--link)" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card p-5 lg:col-span-7" style={{ background: "var(--background)", boxShadow: "none" }}>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3" style={{ borderColor: "var(--border-soft)" }}>
                      <span className="text-sm font-semibold">Keyword gap &amp; alignment</span>
                      <div className="tab-strip" role="group" aria-label="ATS view mode">
                        {(["visual", "raw"] as const).map((mode) => (
                          <button key={mode} type="button" aria-pressed={atsViewMode === mode} onClick={() => setAtsViewMode(mode)} className="tab-btn">
                            {mode === "visual" ? "Visual" : "ATS raw parse"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {atsViewMode === "visual" ? (
                      <div className="mt-4 flex flex-col gap-4">
                        <div>
                          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--success)" }}>
                            <CheckIcon className="h-3.5 w-3.5" /> Matched critical tokens (14)
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {["Distributed systems", "Rust / Tokio", "vLLM & TensorRT", "PostgreSQL vector", "Model context protocol", "PyTorch", "Kubernetes", "Triton inference", "Prompt orchestration"].map((token) => (
                              <span key={token} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium" style={{ background: "rgba(36,138,61,0.1)", color: "var(--success)" }}>
                                <CheckIcon className="h-3 w-3" /> {token}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="mb-2 text-xs font-medium" style={{ color: "#b64400" }}>Missing high-weight tokens (2)</p>
                          <div className="flex flex-wrap gap-2">
                            {["CUDA kernels · +3.2 pts", "Speculative decoding · +2.8 pts"].map((token) => (
                              <span key={token} className="rounded-md px-2.5 py-1 text-[11px] font-medium" style={{ background: "rgba(214,106,0,0.1)", color: "#b64400" }}>{token}</span>
                            ))}
                          </div>
                        </div>
                        <p className="rounded-lg p-3 text-xs leading-relaxed" style={{ background: "var(--surface)", color: "var(--text-2)" }}>
                          <span className="mb-1 block font-semibold" style={{ color: "var(--text)" }}>Local AI suggestion</span>
                          Synthesize one experience bullet describing CUDA kernel benchmarks for batch
                          inference to raise the score toward 99%.
                        </p>
                      </div>
                    ) : (
                      <div className="code-block mt-4" aria-label="Simulated ATS parser output">
                        <div style={{ color: "var(--text-3)" }}>{"// ATS parser output (simulated extraction)"}</div>
                        <div>ROLE_TARGET: &quot;Staff AI Engineer&quot;</div>
                        <div>CANDIDATE: &quot;Lead Systems Architect&quot;</div>
                        <div>EXPERIENCE_TOTAL_MONTHS: 104</div>
                        <div>HARD_MATCH_COUNT: 11/12 (91.6%)</div>
                        <div>PARSER_STATUS: CLEAN_NO_TABLE_FAILS</div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === "diff" && (
                <motion.div key="diff" {...scene} transition={{ duration: 0.25 }} role="tabpanel" id="hyperframe-panel-diff" aria-labelledby="hyperframe-tab-diff" className="flex flex-col gap-4">
                  <div className="card flex flex-wrap items-center justify-between gap-3 p-4" style={{ background: "var(--background)", boxShadow: "none" }}>
                    <span className="flex items-center gap-2 text-xs" style={{ color: "var(--text-2)" }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: "var(--success)" }} />
                      Revision #4 · tailored for <strong style={{ color: "var(--text)" }}>Staff AI Engineer</strong>
                    </span>
                    <button type="button" onClick={() => setDiffApplied(!diffApplied)} className="link-more !text-sm">
                      {diffApplied ? "Revert to previous revision" : "Apply AI tailored diff"}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="card p-4" style={{ background: "var(--background)", boxShadow: "none" }}>
                      <p className="mb-3 flex items-center justify-between font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                        <span>Base resume (original)</span><span>v1.0.0</span>
                      </p>
                      <div className="flex flex-col gap-3 text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
                        <p>Architected distributed inference microservices across 32 GPU nodes handling traffic spikes.</p>
                        <p>Optimized vector similarity search using PostgreSQL and pgvector for agent recall.</p>
                        <p>Mentored 4 engineers and improved team test coverage to 85% across core repositories.</p>
                      </div>
                    </div>

                    <div className="card p-4" style={{ background: "var(--background)", boxShadow: "none", borderColor: "var(--border)" }}>
                      <p className="mb-3 flex items-center justify-between font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                        <span>AI tailored diff</span>
                        <span style={{ color: "var(--success)" }}>{diffApplied ? "+12% ATS match" : "Reverted"}</span>
                      </p>
                      {diffApplied ? (
                        <div className="flex flex-col gap-3 text-xs leading-relaxed">
                          <p className="rounded-lg border p-2 font-mono text-[11px]" style={{ borderColor: "rgba(36,138,61,0.3)", background: "rgba(36,138,61,0.06)" }}>
                            + Architected high-throughput vLLM &amp; TensorRT-LLM inference pipelines across 32 Hopper H100 nodes, slashing P99 latency by 44% while serving 1.2M daily agent requests.
                          </p>
                          <p className="rounded-lg border p-2 font-mono text-[11px]" style={{ borderColor: "rgba(36,138,61,0.3)", background: "rgba(36,138,61,0.06)" }}>
                            + Engineered hybrid dense-sparse vector indexing atop PostgreSQL pgvector, unlocking sub-15ms semantic retrieval for multi-turn agent contexts.
                          </p>
                          <p style={{ color: "var(--text-2)" }}>Led technical design reviews and established zero-downtime canary deployments across Kubernetes.</p>
                        </div>
                      ) : (
                        <p className="text-xs italic" style={{ color: "var(--text-2)" }}>Diff reverted. Original text is active. Apply the diff above to compare enhancements.</p>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "pipeline" && (
                <motion.div key="pipeline" {...scene} transition={{ duration: 0.25 }} role="tabpanel" id="hyperframe-panel-pipeline" aria-labelledby="hyperframe-tab-pipeline" className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {[
                    { title: "1. Radar / Sourced", count: "3 roles", jobs: [
                      { name: "Staff AI Engineer", org: "Anthropic · SF / Remote", score: "94%", meta: "$320k–$460k · visa: yes" },
                      { name: "Founding LLM Systems Lead", org: "Cognition AI · Remote", score: "89%", meta: "$280k–$410k + equity" },
                    ] },
                    { title: "2. Tailored & ready", count: "2 ready", jobs: [
                      { name: "Principal Infra Architect", org: "Mistral AI · Paris / Remote", score: "97%", meta: "PDF rendered & ATS verified" },
                    ] },
                    { title: "3. Technical rounds", count: "1 active", jobs: [
                      { name: "Senior Systems Engineer", org: "Stripe · Remote", score: "Round 3", meta: "Next: distributed consensus deep dive, Fri 2 PM PST" },
                    ] },
                  ].map((col) => (
                    <div key={col.title} className="card p-4" style={{ background: "var(--background)", boxShadow: "none" }}>
                      <div className="mb-3 flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border-soft)" }}>
                        <span className="text-xs font-semibold" style={{ color: "var(--text-2)" }}>{col.title}</span>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--surface)", color: "var(--text-2)" }}>{col.count}</span>
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {col.jobs.map((job) => (
                          <div key={job.name} className="rounded-lg p-3" style={{ background: "var(--surface)" }}>
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-semibold">{job.name}</span>
                              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "rgba(0,102,204,0.1)", color: "var(--link)" }}>{job.score}</span>
                            </div>
                            <p className="mt-1 text-[11px]" style={{ color: "var(--text-2)" }}>{job.org}</p>
                            <p className="mt-2 font-mono text-[10px]" style={{ color: "var(--text-3)" }}>{job.meta}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}

              {activeTab === "screenshots" && (
                <motion.div key="screenshots" {...scene} transition={{ duration: 0.25 }} role="tabpanel" id="hyperframe-panel-screenshots" aria-labelledby="hyperframe-tab-screenshots" className="flex flex-col gap-5">
                  <div className="tab-strip" role="group" aria-label="Screenshot picker">
                    {screenshots.map((s, idx) => (
                      <button key={s.title} type="button" aria-pressed={selectedScreenshot === idx} onClick={() => setSelectedScreenshot(idx)} className="tab-btn">
                        {s.title}
                      </button>
                    ))}
                  </div>

                  <TiltShot
                    light={selected.light}
                    dark={selected.dark}
                    alt={selected.title}
                    width={1440}
                    height={selected.height ?? 960}
                    loading="lazy"
                    reducedMotion={reduce || isReducedMotion}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{selected.title}</p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-2)" }}>{selected.desc}</p>
                    </div>
                    <a href={`RoleSpecOS/${selectedFile}`} target="_blank" rel="noreferrer" className="link-more !text-sm">
                      Full resolution <ExternalIcon className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs" style={{ borderColor: "var(--border-soft)", color: "var(--text-3)", background: "var(--background)" }}>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: "var(--success)" }} />
              Single-owner local security model
            </span>
            <span>PostgreSQL · Next.js · Personal use</span>
          </div>
        </div>
      </div>
    </section>
  )
}
