/**
 * Locates the user's own Codex CLI and its configured model.
 *
 * Why this exists: `ai-sdk-provider-codex-cli` bundles a pinned `@openai/codex`
 * (0.144.x in the version this repo uses) and prefers that bundled binary over
 * the CLI the user installed and signed in with. A bundled CLI from before the
 * current model lineup rejects models the user's actual CLI supports, which made
 * the ChatGPT path fail with "model is not supported" even though the same
 * command worked in the user's terminal.
 *
 * RoleSpec's setup flow already requires the official CLI (that is where the
 * ChatGPT sign-in lives), so the provider must use it. Nothing here reads a
 * token: only the executable location and the non-secret `model` setting from
 * `config.toml` are inspected.
 */

import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/** Last-resort model when neither the environment nor the CLI config names one. */
const FALLBACK_MODEL = "gpt-6.1-sol"

function codexHome(): string {
  const override = process.env.CODEX_HOME?.trim()
  return override || path.join(os.homedir(), ".codex")
}

/**
 * Reads the top-level `model = "..."` from the Codex config. Profile tables may
 * also define models, but the CLI's default comes from the top level; stop at
 * the first table header so a profile's model is never mistaken for the default.
 */
export function parseCodexConfigModel(toml: string): string | null {
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    if (trimmed.startsWith("[")) break
    const match = /^model\s*=\s*["']([^"']+)["']/.exec(trimmed)
    if (match?.[1]?.trim()) return match[1].trim()
  }
  return null
}

/**
 * The model Codex itself would use: explicit env override, then the CLI's
 * config, then a current fallback. Always non-empty because the AI SDK provider
 * requires a model id and passes it as `-m`.
 */
export function resolveCodexModelId(): string {
  const envModel = process.env.CODEX_CLI_MODEL?.trim()
  if (envModel) return envModel

  try {
    const config = readFileSync(path.join(codexHome(), "config.toml"), "utf8")
    const configured = parseCodexConfigModel(config)
    if (configured) return configured
  } catch {
    // No config yet (fresh CLI install) or unreadable; use the fallback.
  }

  return FALLBACK_MODEL
}

/**
 * Returns the path/command to hand to the provider's `codexPath` setting, or
 * null to leave the provider on its bundled binary.
 *
 * - `CODEX_CLI_PATH` wins (escape hatch for custom installs).
 * - Windows: the official standalone installer's launcher, then the npm-global
 *   package's JS entry (the provider runs `.js` paths with node), then common
 *   per-user locations. A bare `codex` is not used on Windows because the npm
 *   shim is a `.cmd`, which a shell-less spawn cannot execute.
 * - POSIX: a bare `codex` resolves through PATH exactly as the user's shell does.
 */
export function resolveInstalledCodexPath(): string | null {
  const explicit = process.env.CODEX_CLI_PATH?.trim()
  if (explicit) return explicit

  if (process.platform !== "win32") return "codex"

  const localAppData = process.env.LOCALAPPDATA?.trim()
  const appData = process.env.APPDATA?.trim()
  const home = os.homedir()

  const candidates = [
    localAppData
      ? path.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe")
      : null,
    appData
      ? path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
      : null,
    path.join(home, ".local", "bin", "codex.exe"),
    localAppData ? path.join(localAppData, "Programs", "codex", "codex.exe") : null,
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}
