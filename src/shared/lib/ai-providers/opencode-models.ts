/**
 * Server-only discovery for the OpenCode CLI provider.
 *
 * `opencode models --verbose` is the CLI's own view of what it can run: it
 * already applies the install's provider configuration and credentials, so we
 * never have to guess from models.dev. We keep only the zero-cost models from
 * the `opencode` provider (the free tier) because that is the promise of this
 * provider: AI with no API key and no per-token bill.
 *
 * Nothing here reads a credential file. The command is bounded and its output
 * is parsed as data.
 */

import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"

/** Fallback used when the CLI cannot be probed (env/config resolution only). */
export const DEFAULT_OPENCODE_MODEL = "opencode/deepseek-v4.1-flash-free"

/** Preferred free models, in order. The first one present wins. */
const PREFERRED_FREE_MODELS = [
  "opencode/deepseek-v4.1-flash-free",
  "opencode/glm-5.3-flash-free",
  "opencode/minimax-m3.1-flash-free",
  "opencode/big-pickle",
] as const

const COMMAND_TIMEOUT_MS = 20_000
const MAX_COMMAND_OUTPUT = 4 * 1024 * 1024
const CACHE_TTL_MS = 60_000
const FAILURE_TTL_MS = 15_000

export interface OpenCodeModel {
  /** `provider/model`, exactly what `opencode run --model` expects. */
  id: string
  /** Provider id reported by the CLI (`opencode` for the free tier). */
  provider: string
  /** Human label from the CLI's model metadata, falling back to the id. */
  name: string
  /** True only for the zero-cost models this provider is allowed to offer. */
  free: boolean
}

export interface OpenCodeProbe {
  installed: boolean
  version: string | null
  models: OpenCodeModel[]
  /** Sanitized reason the probe failed, for diagnostics only. */
  error?: string
}

interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  notFound: boolean
}

/**
 * Adds the usual OpenCode/npm bin directories to PATH. Shared with the runtime
 * spawn so a CLI found by the probe can also be executed by the provider.
 */
export function openCodeEnv(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const extras = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
    path.join(home, ".local", "bin"),
    path.join(home, ".opencode", "bin"),
  ].filter((entry): entry is string => Boolean(entry))

  return {
    ...process.env,
    NO_COLOR: "1",
    PATH: [...extras, process.env.PATH ?? ""].join(path.delimiter),
  }
}

/**
 * Runs one of the CLI's read-only discovery commands. `shell` is only enabled
 * on Windows, where npm installs `opencode` as a `.cmd` shim that `execFile`
 * cannot execute directly. No user-supplied argument ever reaches this call.
 */
function run(command: string, args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
        shell: process.platform === "win32",
        encoding: "utf8",
        maxBuffer: MAX_COMMAND_OUTPUT,
        env: openCodeEnv(),
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true, stdout: stdout ?? "", stderr: stderr ?? "", notFound: false })
          return
        }
        const errno = error as NodeJS.ErrnoException
        resolve({
          ok: false,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          notFound: errno.code === "ENOENT",
        })
      }
    )
  })
}

const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/
const MAX_MODEL_ID_LENGTH = 200

/**
 * True for the `provider/model` shape the CLI accepts. Also the allow-list for
 * the model id on the Windows spawn path, where `cmd.exe` would otherwise treat
 * shell metacharacters as syntax.
 */
export function isOpenCodeModelId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_MODEL_ID_LENGTH && MODEL_ID_PATTERN.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function nameFromId(id: string): string {
  const slug = id.split("/")[1] ?? id
  return slug
    .split("-")
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ")
}

/**
 * Parses `opencode models --verbose` output. The CLI prints an id line followed
 * by a pretty-printed JSON object, repeating per model. A malformed block is
 * skipped instead of discarding the whole catalog; ids are still usable even
 * when their metadata is not.
 */
export function parseOpenCodeModels(output: string): OpenCodeModel[] {
  const lines = output.split(/\r?\n/)
  const models: OpenCodeModel[] = []
  let currentId: string | null = null
  let buffer: string[] = []

  const flush = () => {
    if (!currentId) return
    const id = currentId
    currentId = null
    let metadata: Record<string, unknown> | null = null
    try {
      metadata = asRecord(JSON.parse(buffer.join("\n")))
    } catch {
      metadata = null
    }
    buffer = []

    const provider = typeof metadata?.providerID === "string"
      ? metadata.providerID
      : id.split("/")[0]
    const cost = asRecord(metadata?.cost)
    const input = asNumber(cost?.input)
    const output = asNumber(cost?.output)
    // `opencode` is the bundled free tier. Require explicit zero input/output
    // prices: a model whose metadata failed to parse (or omitted pricing) must
    // not leak into a "free" selector as if it cost nothing.
    const free = provider === "opencode" && input === 0 && output === 0
    const name = typeof metadata?.name === "string" && metadata.name.trim()
      ? metadata.name.trim()
      : nameFromId(id)

    models.push({ id, provider, name, free })
  }

  for (const line of lines) {
    if (isOpenCodeModelId(line.trim())) {
      flush()
      currentId = line.trim()
      continue
    }
    if (currentId) buffer.push(line)
  }
  flush()

  return models
}

/** Zero-cost models from the install's free OpenCode tier, de-duplicated. */
export function freeOpenCodeModels(models: readonly OpenCodeModel[]): OpenCodeModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (!model.free || seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

/** Picks the best available free model, honoring OPENCODE_MODEL first. */
export function resolveOpenCodeModelId(
  configured?: string | null,
  available: readonly OpenCodeModel[] = []
): string {
  const explicit = configured?.trim() || process.env.OPENCODE_MODEL?.trim()
  if (explicit) return explicit

  const free = freeOpenCodeModels(available)
  for (const preferred of PREFERRED_FREE_MODELS) {
    if (free.some((model) => model.id === preferred)) return preferred
  }
  return free[0]?.id ?? DEFAULT_OPENCODE_MODEL
}

let cache: { value: OpenCodeProbe; expiresAt: number } | null = null
let inFlight: Promise<OpenCodeProbe> | null = null

/** Drops the probe cache so the next call re-runs the CLI. */
export function clearOpenCodeModelsCache(): void {
  cache = null
  inFlight = null
}

async function probe(): Promise<OpenCodeProbe> {
  const version = await run("opencode", ["--version"])
  if (!version.ok) {
    return {
      installed: false,
      version: null,
      models: [],
      error: version.notFound ? "opencode was not found on PATH" : "opencode --version failed",
    }
  }

  const listed = await run("opencode", ["models", "--verbose"])
  if (!listed.ok) {
    return {
      installed: true,
      version: version.stdout.trim() || null,
      models: [],
      error: "opencode models --verbose failed",
    }
  }

  return {
    installed: true,
    version: version.stdout.trim() || null,
    models: parseOpenCodeModels(listed.stdout),
  }
}

/**
 * Probes the installed CLI and its model catalog. Concurrent callers share one
 * subprocess, and a successful result is cached briefly: both the settings page
 * and the onboarding snapshot ask for this on the same request.
 */
export async function probeOpenCodeCli(): Promise<OpenCodeProbe> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value
  if (inFlight) return inFlight

  inFlight = probe()
    .catch((): OpenCodeProbe => ({
      installed: false,
      version: null,
      models: [],
      error: "opencode probe failed",
    }))
    .then((value) => {
      cache = {
        value,
        expiresAt: Date.now() + (value.installed ? CACHE_TTL_MS : FAILURE_TTL_MS),
      }
      return value
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

/** Free models only — the exact set the settings/onboarding selectors show. */
export async function listOpenCodeModels(): Promise<OpenCodeModel[]> {
  const result = await probeOpenCodeCli()
  return freeOpenCodeModels(result.models)
}
