import React, { useRef, useState } from "react"
import { DownloadIcon, CopyIcon, CheckIcon } from "./icons"

type TabKey = "desktop" | "docker" | "node"

const TABS: { key: TabKey; label: string }[] = [
  { key: "desktop", label: "Windows desktop" },
  { key: "docker", label: "Docker Compose" },
  { key: "node", label: "Source / Node.js" },
]

const COMMANDS: Record<Exclude<TabKey, "desktop">, string> = {
  docker: [
    "git clone https://github.com/Ry0x7/rolespec-os.git",
    "cd rolespec-os",
    "cp .env.docker.example .env.docker",
    "# Set AUTH_SECRET and ENCRYPTION_KEY in .env.docker",
    "docker compose up -d --build",
    "# Open http://localhost:3000",
  ].join("\n"),
  node: [
    "git clone https://github.com/Ry0x7/rolespec-os.git",
    "cd rolespec-os",
    "npm install",
    "cp .env.example .env",
    "# Set DATABASE_URL, AUTH_SECRET and ENCRYPTION_KEY in .env",
    "npx prisma migrate deploy",
    "npm run dev",
    "# Open http://localhost:3100",
  ].join("\n"),
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function QuickstartTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>("desktop")
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const onCopy = async (text: string, key: string) => {
    const ok = await copyText(text)
    setCopyFailed(!ok)
    if (ok) {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }
  }

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

  return (
    <section id="quickstart" aria-labelledby="quickstart-heading" className="scroll-mt-20 py-16" style={{ background: "var(--surface)" }}>
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
        <div className="mb-10 text-center">
          <h2 id="quickstart-heading" className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Get RoleSpec OS
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-base" style={{ color: "var(--text-2)" }}>
            The desktop app, a Docker container, or the source — your call.
          </p>
        </div>

        <div className="mb-6 flex justify-center">
          <div className="tab-strip max-w-full rounded-full border p-1" role="tablist" aria-label="Install methods" style={{ borderColor: "var(--border-soft)", background: "var(--background)" }}>
            {TABS.map((tab, i) => (
              <button
                key={tab.key}
                ref={(el) => { tabRefs.current[i] = el }}
                type="button"
                role="tab"
                id={`quickstart-tab-${tab.key}`}
                aria-selected={activeTab === tab.key}
                aria-controls={`quickstart-panel-${tab.key}`}
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

        <div className="card p-6 sm:p-8" style={{ background: "var(--background)" }}>
          {activeTab === "desktop" && (
            <div role="tabpanel" id="quickstart-panel-desktop" aria-labelledby="quickstart-tab-desktop" className="flex flex-col gap-6">
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xl font-semibold tracking-tight">RoleSpec OS for Windows <span className="text-sm font-medium" style={{ color: "var(--text-3)" }}>v2.1.0</span></p>
                  <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>Bundled database, single-owner, local-first.</p>
                  <p className="mt-2 text-xs" style={{ color: "var(--text-3)" }}>Windows 10/11 x64 · WebView2 · Unsigned installer</p>
                </div>
                <a href="https://github.com/Ry0x7/rolespec-os/releases/latest" target="_blank" rel="noreferrer" className="btn-primary shrink-0">
                  <DownloadIcon className="h-5 w-5" /> Latest release
                </a>
              </div>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
                <li>Run the installer, then launch RoleSpec OS. First boot initializes the local database.</li>
                <li>Choose your AI provider in Settings — local or cloud, your keys stay yours.</li>
              </ol>
            </div>
          )}

          {activeTab === "docker" && (
            <div role="tabpanel" id="quickstart-panel-docker" aria-labelledby="quickstart-tab-docker" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm" style={{ color: "var(--text-2)" }}>App + PostgreSQL in one container</span>
                <button type="button" onClick={() => onCopy(COMMANDS.docker, "docker")} className="link-more !text-sm">
                  {copiedKey === "docker" ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon className="h-3.5 w-3.5" /> Copy commands</>}
                </button>
              </div>
              <pre className="code-block"><code>{COMMANDS.docker}</code></pre>
            </div>
          )}

          {activeTab === "node" && (
            <div role="tabpanel" id="quickstart-panel-node" aria-labelledby="quickstart-tab-node" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm" style={{ color: "var(--text-2)" }}>Node.js 22+ with your own PostgreSQL</span>
                <button type="button" onClick={() => onCopy(COMMANDS.node, "node")} className="link-more !text-sm">
                  {copiedKey === "node" ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon className="h-3.5 w-3.5" /> Copy commands</>}
                </button>
              </div>
              <pre className="code-block"><code>{COMMANDS.node}</code></pre>
            </div>
          )}

          <p aria-live="polite" className="min-h-5 text-sm" style={{ color: copyFailed ? "#b64400" : "var(--success)" }}>
            {copyFailed ? "Copy failed — select the commands manually." : copiedKey ? "Commands copied to clipboard." : ""}
          </p>
        </div>
      </div>
    </section>
  )
}
