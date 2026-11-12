import React, { useState } from "react"
import { Download, Terminal, Container, Copy, Check } from "lucide-react"

export function QuickstartTabs() {
  const [activeTab, setActiveTab] = useState<"desktop" | "docker" | "node">("desktop")
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const downloadUrl =
    "https://github.com/Ry0x7/rolespec-os/releases/download/v1.0.5/RoleSpec_1.0.5_x64-setup.exe"

  return (
    <section id="quickstart" className="relative mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-20 border-t border-white/[0.06]">
      <div className="mb-12 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-mono font-medium text-purple-300">
          <Download className="h-3.5 w-3.5 text-purple-400" />
          <span>Release v1.0.5 Setup &amp; Deployment</span>
        </div>
        <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
          Deploy on Windows, Docker, or Node.js.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm sm:text-base text-zinc-400">
          Start in seconds with pre-packaged desktop binaries, single-command Docker Compose, or clone the AGPL-3.0 source repository.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex p-1 rounded-xl bg-[#12121e] border border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab("desktop")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs sm:text-sm font-medium transition-all ${
              activeTab === "desktop"
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Download className="h-4 w-4" />
            <span>Windows Desktop (v1.0.5)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("docker")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs sm:text-sm font-medium transition-all ${
              activeTab === "docker"
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Container className="h-4 w-4" />
            <span>Docker Compose</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("node")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs sm:text-sm font-medium transition-all ${
              activeTab === "node"
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Terminal className="h-4 w-4" />
            <span>Source / Node.js</span>
          </button>
        </div>
      </div>

      {/* Tab Panels */}
      <div className="rounded-2xl border border-white/10 bg-[#0c0c14] p-6 sm:p-8 shadow-2xl">
        {activeTab === "desktop" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl border border-purple-500/30 bg-purple-500/10">
              <div>
                <div className="flex items-center gap-2 font-display text-lg font-bold text-white">
                  <span>RoleSpec OS for Windows</span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-200">
                    v1.0.5 Stable
                  </span>
                </div>
                <p className="text-xs text-zinc-300 mt-1">
                  Bundled with embedded PostgreSQL runtime, single-owner isolation, and auto-upgrades.
                </p>
                <div className="flex items-center gap-3 mt-3 text-[11px] font-mono text-zinc-400">
                  <span>SHA-256 Verified</span>
                  <span>•</span>
                  <span>x86_64 Architecture</span>
                  <span>•</span>
                  <span>Publisher: Chryypt</span>
                </div>
              </div>

              <a
                href={downloadUrl}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-3 font-semibold text-white shadow-[0_0_25px_rgba(147,51,234,0.4)] hover:from-purple-500 hover:to-indigo-500 transition-all text-sm shrink-0"
              >
                <Download className="h-4 w-4" />
                <span>Download .exe (v1.0.5)</span>
              </a>
            </div>

            <div className="space-y-2 text-xs text-zinc-400">
              <div className="font-semibold text-zinc-300">Quick Installation Instructions:</div>
              <ol className="list-decimal list-inside space-y-1.5 pl-1 leading-relaxed">
                <li>Run <code className="text-purple-300 bg-white/5 px-1.5 py-0.5 rounded">RoleSpec_1.0.5_x64-setup.exe</code>.</li>
                <li>Launch RoleSpec OS. On first boot, local PostgreSQL database initialization takes ~3 seconds.</li>
                <li>Configure your preferred AI provider in Settings &gt; LLM (Local Ollama, LM Studio, or Cloud BYOK).</li>
              </ol>
            </div>
          </div>
        )}

        {activeTab === "docker" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-400">Single-command container deployment</span>
              <button
                type="button"
                onClick={() =>
                  copyToClipboard(
                    "curl -sSL https://raw.githubusercontent.com/Ry0x7/rolespec-os/main/docker-compose.yml -o docker-compose.yml && docker compose up -d",
                    "docker-cmd"
                  )
                }
                className="inline-flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200"
              >
                {copiedKey === "docker-cmd" ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Command</span>
                  </>
                )}
              </button>
            </div>

            <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/80 p-4 font-mono text-xs text-zinc-300 leading-relaxed">
              <code>{`# Download compose spec and spin up local Postgres + Web UI
curl -sSL https://raw.githubusercontent.com/Ry0x7/rolespec-os/main/docker-compose.yml -o docker-compose.yml
docker compose up -d

# Open in browser: http://localhost:3100`}</code>
            </pre>
          </div>
        )}

        {activeTab === "node" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-400">Node.js 22+ development runtime</span>
              <button
                type="button"
                onClick={() =>
                  copyToClipboard(
                    "git clone https://github.com/Ry0x7/rolespec-os.git\ncd rolespec-os\nnpm install\nnpx prisma migrate dev\nnpm run build\nnpm start",
                    "node-cmd"
                  )
                }
                className="inline-flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200"
              >
                {copiedKey === "node-cmd" ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Script</span>
                  </>
                )}
              </button>
            </div>

            <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/80 p-4 font-mono text-xs text-zinc-300 leading-relaxed">
              <code>{`git clone https://github.com/Ry0x7/rolespec-os.git
cd rolespec-os
npm install
npx prisma migrate dev
npm run build
npm start`}</code>
            </pre>
          </div>
        )}
      </div>
    </section>
  )
}
