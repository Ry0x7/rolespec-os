/**
 * OpenCode CLI as an AI SDK provider.
 *
 * OpenCode ships a free tier (the `opencode/*` models) that needs no API key,
 * so this is the zero-cost sibling of `codex-cli` and `claude-code`. It spawns
 * `opencode run --format json` and maps its JSONL event stream onto the AI SDK.
 *
 * Safety: the subprocess is a text generator, not an agent. A custom agent
 * prompt tells the model not to call tools, and every dangerous tool is
 * disabled. `read` has to stay enabled: OpenCode's free tier rejects requests
 * whose tool list omits it, so the process instead runs in an empty scratch
 * directory with `external_directory` denied. A prompt-injected model therefore
 * has nothing to read and no way to leave that directory.
 *
 * IMPORTANT: this provider spawns a local binary. It only works on
 * local-development / self-hosted installs, never on Vercel serverless.
 */

import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"
import { logger } from "@/shared/lib/logger"
import {
  isOpenCodeModelId,
  openCodeEnv,
  resolveOpenCodeModelId,
} from "./opencode-models"

const log = logger("ai-provider/opencode-cli")

const AGENT_NAME = "rolespec"
const DEFAULT_TIMEOUT_MS = 180_000

const SYSTEM_PROMPT =
  "You are the text generation engine for RoleSpec, a career workspace. " +
  "Follow the user's instructions exactly. You are not a coding agent: never " +
  "call tools, never read or write files, and never run commands. Return only " +
  "the requested output, with no preamble or explanation unless asked for it."

/**
 * OpenCode's free tier refuses requests that omit the `read` tool, so keep
 * `read` (and only `read`) available and deny leaving the scratch directory.
 */
const CONFIG_CONTENT = JSON.stringify({
  agent: {
    [AGENT_NAME]: {
      description: "RoleSpec plain-text generation (tools disabled)",
      mode: "primary",
      prompt: SYSTEM_PROMPT,
    },
  },
  // Wildcard first so tools added by future CLI releases stay off. `read` is
  // the one exception the free tier requires; the empty scratch directory is
  // what makes keeping it harmless.
  tools: {
    "*": false,
    read: true,
  },
  permission: {
    external_directory: "deny",
  },
})

/** One shared, empty working directory so `read` cannot see the app's files. */
function scratchDirectory(): string {
  const dir = path.join(os.tmpdir(), "rolespec-opencode")
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * CLI failures are shaped so `classifyProviderError` can read the real cause
 * from `data.message` / `data.stderr`, exactly like the other CLI providers.
 */
export class OpenCodeCliError extends Error {
  readonly data: { message: string; stderr?: string; exitCode?: number }

  constructor(message: string, data: { stderr?: string; exitCode?: number } = {}) {
    super(message)
    this.name = "OpenCodeCliError"
    this.data = { message, ...data }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function textFromPrompt(prompt: LanguageModelV3CallOptions["prompt"]): {
  system: string
  conversation: string
} {
  const systemParts: string[] = []
  const conversation: string[] = []

  for (const message of prompt) {
    if (message.role === "system") {
      if (message.content.trim()) systemParts.push(message.content.trim())
      continue
    }

    const parts: string[] = []
    for (const part of message.content) {
      switch (part.type) {
        case "text":
          if (part.text.trim()) parts.push(part.text)
          break
        case "file":
          parts.push(`[attached file omitted: ${part.mediaType}]`)
          break
        case "tool-call":
          parts.push(`[tool call: ${part.toolName}]`)
          break
        case "tool-result":
          parts.push(`[tool result: ${part.toolName}]`)
          break
        default:
          break
      }
    }
    if (parts.length === 0) continue
    conversation.push(`${message.role.toUpperCase()}:\n${parts.join("\n")}`)
  }

  return { system: systemParts.join("\n\n"), conversation: conversation.join("\n\n") }
}

function responseFormatInstruction(
  responseFormat: LanguageModelV3CallOptions["responseFormat"]
): string | null {
  if (responseFormat?.type !== "json") return null
  const schema = responseFormat.schema
    ? `\n\nJSON Schema:\n${JSON.stringify(responseFormat.schema)}`
    : ""
  const name = responseFormat.name?.trim()
  const description = responseFormat.description?.trim()
  return [
    "RESPONSE FORMAT",
    "Return exactly one JSON value and nothing else. Do not wrap it in Markdown code fences and do not add commentary.",
    name ? `Output name: ${name}` : "",
    description ? `Output description: ${description}` : "",
  ]
    .filter(Boolean)
    .join("\n") + schema
}

function buildPrompt(options: LanguageModelV3CallOptions): string {
  const { system, conversation } = textFromPrompt(options.prompt)
  const format = responseFormatInstruction(options.responseFormat)
  return [system ? `SYSTEM:\n${system}` : "", conversation, format ?? ""]
    .filter((section) => section.length > 0)
    .join("\n\n")
}

/** Models occasionally wrap JSON despite being told not to; unwrap one fence. */
function stripFence(text: string, isJson: boolean): string {
  if (!isJson) return text
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : text.trim()
}

interface CliResult {
  text: string
  usage: LanguageModelV3Usage
  finishReason: LanguageModelV3FinishReason
  responseId?: string
}

function emptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
    },
  }
}

function usageFromTokens(tokens: Record<string, unknown> | null): LanguageModelV3Usage {
  if (!tokens) return emptyUsage()
  const input = asNumber(tokens.input)
  const output = asNumber(tokens.output)
  const reasoning = asNumber(tokens.reasoning)
  const cache = asRecord(tokens.cache)
  const cacheRead = asNumber(cache?.read)
  const cacheWrite = asNumber(cache?.write)
  return {
    inputTokens: {
      total: input,
      noCache:
        input !== undefined && cacheRead !== undefined
          ? Math.max(0, input - cacheRead)
          : input,
      cacheRead,
      cacheWrite,
    },
    outputTokens: {
      total: output,
      text: output,
      reasoning,
    },
  }
}

function finishReason(raw: string | undefined): LanguageModelV3FinishReason {
  switch (raw) {
    case "stop":
      return { unified: "stop", raw }
    case "length":
      return { unified: "length", raw }
    case "tool-calls":
      return { unified: "tool-calls", raw }
    case "error":
      return { unified: "error", raw }
    default:
      return { unified: "other", raw }
  }
}

/**
 * Spawns one `opencode run` and collects its JSONL events. The prompt goes over
 * stdin so large resume/job text never hits the platform's argument limit or a
 * shell-quoting path.
 */
function runOpenCode(
  prompt: string,
  modelId: string,
  isJson: boolean,
  abortSignal?: AbortSignal
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    // On Windows the CLI is spawned through cmd.exe so npm's `.cmd` shim also
    // works; an unchecked id could inject a second command there.
    if (!isOpenCodeModelId(modelId)) {
      reject(
        new OpenCodeCliError(
          `"${modelId}" is not a valid OpenCode model id. Run \`opencode models\` and choose a listed model.`
        )
      )
      return
    }

    const args = [
      "run",
      "--agent",
      AGENT_NAME,
      "--format",
      "json",
      "--model",
      modelId,
    ]

    const child = spawn("opencode", args, {
      cwd: scratchDirectory(),
      env: {
        ...openCodeEnv(),
        OPENCODE_CONFIG_CONTENT: CONFIG_CONTENT,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    })

    let stderr = ""
    let lineBuffer = ""
    const textParts: string[] = []
    let usage = emptyUsage()
    let finish = finishReason(undefined)
    let responseId: string | undefined
    let cliError: OpenCodeCliError | null = null
    let aborted = false
    let timedOut = false
    let settled = false

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, Number(process.env.OPENCODE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)

    const onAbort = () => {
      aborted = true
      child.kill()
    }
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timeout)
        child.kill()
        reject(new DOMException("Request aborted", "AbortError"))
        return
      }
      abortSignal.addEventListener("abort", onAbort, { once: true })
    }

    const cleanup = () => {
      clearTimeout(timeout)
      abortSignal?.removeEventListener("abort", onAbort)
    }

    const handleEvent = (line: string) => {
      if (!line.trim()) return
      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        return
      }
      const record = asRecord(event)
      if (!record) return

      const part = asRecord(record.part)
      switch (record.type) {
        case "step_start":
          if (typeof record.sessionID === "string") responseId = record.sessionID
          break
        case "text": {
          const text = typeof part?.text === "string" ? part.text : ""
          if (text.trim()) textParts.push(text)
          break
        }
        case "step_finish": {
          usage = usageFromTokens(asRecord(part?.tokens))
          finish = finishReason(typeof part?.reason === "string" ? part.reason : undefined)
          break
        }
        case "error": {
          const error = asRecord(record.error)
          const data = asRecord(error?.data)
          const message =
            (typeof data?.message === "string" && data.message) ||
            (typeof error?.name === "string" && error.name) ||
            "OpenCode CLI returned an error"
          const body = typeof data?.responseBody === "string" ? data.responseBody : undefined
          const status =
            typeof data?.statusCode === "number" && Number.isFinite(data.statusCode)
              ? ` (status ${data.statusCode})`
              : ""
          cliError = new OpenCodeCliError(`${message}${status}`, {
            ...(body ? { stderr: body } : {}),
          })
          break
        }
        default:
          break
      }
    }

    const drainLines = (final: boolean) => {
      const parts = lineBuffer.split("\n")
      const leftover = parts.pop() ?? ""
      for (const line of parts) handleEvent(line)
      if (final) handleEvent(leftover)
      else lineBuffer = leftover
    }

    child.stdout.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString("utf8")
      drainLines(false)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    child.on("error", (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(
        error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new OpenCodeCliError(
              "The opencode command was not found. Install the OpenCode CLI and try again."
            )
          : new OpenCodeCliError(error.message)
      )
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      cleanup()
      drainLines(true)

      if (aborted) {
        reject(new DOMException("Request aborted", "AbortError"))
        return
      }
      if (timedOut) {
        reject(
          new OpenCodeCliError("OpenCode CLI timed out before finishing.", {
            exitCode: code ?? undefined,
          })
        )
        return
      }
      if (cliError) {
        log.warn("OpenCode CLI reported an error", { model: modelId })
        reject(cliError)
        return
      }
      if (code !== 0) {
        reject(
          new OpenCodeCliError(
            `OpenCode CLI exited with code ${code ?? "unknown"}.`,
            {
              ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
              exitCode: code ?? undefined,
            }
          )
        )
        return
      }

      const text = stripFence(textParts.join("\n"), isJson)
      if (!text) {
        reject(
          new OpenCodeCliError("OpenCode CLI returned an empty response.", {
            ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
          })
        )
        return
      }

      resolve({ text, usage, finishReason: finish, ...(responseId ? { responseId } : {}) })
    })

    child.stdin.on("error", () => {
      // The child may exit before consuming stdin (e.g. bad model id). The
      // close handler reports the real cause; this only stops an EPIPE crash.
    })
    child.stdin.end(prompt)
  })
}

class OpenCodeCliLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider = "opencode-cli"
  readonly modelId: string
  readonly supportedUrls = {}

  constructor(modelId: string) {
    this.modelId = modelId
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const prompt = buildPrompt(options)
    const result = await runOpenCode(
      prompt,
      this.modelId,
      options.responseFormat?.type === "json",
      options.abortSignal
    )

    return {
      content: [{ type: "text", text: result.text }],
      finishReason: result.finishReason,
      usage: result.usage,
      warnings: [],
      request: { body: { model: this.modelId } },
      response: {
        ...(result.responseId ? { id: result.responseId } : {}),
        timestamp: new Date(),
        modelId: this.modelId,
      },
    }
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    // The app only uses generateText/generateObject. A one-shot stream keeps the
    // contract correct for any future caller without a second event parser.
    const result = await this.doGenerate(options)
    const text = result.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("")
    const id = "opencode-text"

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: result.warnings })
        controller.enqueue({
          type: "response-metadata",
          ...(result.response?.id ? { id: result.response.id } : {}),
          timestamp: result.response?.timestamp ?? new Date(),
          modelId: result.response?.modelId ?? "opencode-cli",
        })
        controller.enqueue({ type: "text-start", id })
        controller.enqueue({ type: "text-delta", id, delta: text })
        controller.enqueue({ type: "text-end", id })
        controller.enqueue({
          type: "finish",
          usage: result.usage,
          finishReason: result.finishReason,
        })
        controller.close()
      },
    })

    return { stream, request: { body: { model: this.modelId } } }
  }
}

/**
 * Builds the model object for a given `provider/model` id. Resolution of the
 * default free model is exported so the resolver and diagnostics agree.
 */
export function getOpenCodeCliModel(modelId?: string) {
  return new OpenCodeCliLanguageModel(resolveOpenCodeModelId(modelId))
}
