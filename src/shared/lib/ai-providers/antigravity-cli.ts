/**
 * Google Antigravity CLI (`agy`) as an AI SDK provider.
 *
 * Antigravity is an agent CLI, not a completion endpoint. This adapter uses its
 * headless stream-json mode as a text generator:
 *
 *   agy --input-format stream-json --output-format stream-json --model <id>
 *
 * The prompt goes over stdin as one NDJSON user message, so large resumes and
 * job descriptions never hit the platform argument limit. The process runs in a
 * fresh empty scratch directory, with sandboxing on and no dangerous permission
 * flag. Auth is the Google account already cached by the CLI; no key is passed.
 *
 * IMPORTANT: this spawns a local binary. It only works on local-development /
 * self-hosted installs, never on Vercel serverless.
 */

import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
} from "@ai-sdk/provider"
import { AI_PROVIDER_META } from "./constants"
import { logger } from "@/shared/lib/logger"

const log = logger("ai-provider/antigravity-cli")

const DEFAULT_TIMEOUT_MS = 180_000
const SYSTEM_INSTRUCTION =
  "You are the text generation engine for RoleSpec, a career workspace. " +
  "Follow the user's instructions exactly. You are not a coding agent: never " +
  "call tools, never read or write files, and never run commands. Return only " +
  "the requested output, with no preamble or explanation unless asked for it."

export class AntigravityCliError extends Error {
  readonly data: { message: string; stderr?: string; exitCode?: number }

  constructor(message: string, data: { stderr?: string; exitCode?: number } = {}) {
    super(message)
    this.name = "AntigravityCliError"
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function textFromParts(content: unknown): string[] {
  if (typeof content === "string") return content.trim() ? [content] : []
  if (!Array.isArray(content)) return []

  const parts: string[] = []
  for (const rawPart of content) {
    const part = asRecord(rawPart)
    if (!part) continue
    switch (part.type) {
      case "text":
        if (typeof part.text === "string" && part.text.trim()) parts.push(part.text)
        break
      case "file":
        parts.push(`[attached file omitted: ${String(part.mediaType ?? "unknown")}]`)
        break
      case "reasoning":
        // Reasoning is internal. Do not feed it back into a fresh conversation.
        break
      case "tool-call":
        parts.push(`[tool call requested: ${String(part.toolName ?? "unknown")}]`)
        break
      case "tool-result":
        parts.push(`[tool result: ${String(part.toolName ?? "unknown")}]`)
        break
      case "custom":
        parts.push("[custom provider content omitted]")
        break
      default:
        break
    }
  }
  return parts
}

/** Flattens the AI SDK prompt into the single text turn `agy` accepts. */
export function buildAntigravityPrompt(options: LanguageModelV4CallOptions): string {
  const system: string[] = []
  const conversation: string[] = []

  for (const message of options.prompt) {
    if (message.role === "system") {
      if (message.content.trim()) system.push(message.content.trim())
      continue
    }
    const parts = textFromParts(message.content)
    if (parts.length === 0) continue
    conversation.push(`${message.role.toUpperCase()}:\n${parts.join("\n")}`)
  }

  const format =
    options.responseFormat?.type === "json"
      ? [
          "RESPONSE FORMAT",
          "Return exactly one JSON value and nothing else. Do not wrap it in Markdown code fences and do not add commentary.",
          options.responseFormat.name ? `Output name: ${options.responseFormat.name}` : "",
          options.responseFormat.description
            ? `Output description: ${options.responseFormat.description}`
            : "",
          options.responseFormat.schema
            ? `JSON Schema:\n${JSON.stringify(options.responseFormat.schema)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : ""

  return [
    `SYSTEM:\n${SYSTEM_INSTRUCTION}`,
    system.length > 0 ? `ADDITIONAL INSTRUCTIONS:\n${system.join("\n\n")}` : "",
    conversation.join("\n\n"),
    format,
  ]
    .filter((section) => section.length > 0)
    .join("\n\n")
}

/** Models occasionally wrap JSON despite being told not to; unwrap one fence. */
function stripFence(text: string, isJson: boolean): string {
  if (!isJson) return text
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : text.trim()
}

function emptyUsage(): LanguageModelV4Usage {
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

function usageFromTokens(tokens: Record<string, unknown> | null): LanguageModelV4Usage {
  if (!tokens) return emptyUsage()
  const input = asNumber(tokens.input_tokens) ?? asNumber(tokens.inputTokens)
  const output = asNumber(tokens.output_tokens) ?? asNumber(tokens.outputTokens)
  const cacheRead =
    asNumber(tokens.cache_read_tokens) ?? asNumber(tokens.cachedInputTokens) ?? 0
  const reasoning =
    asNumber(tokens.thinking_tokens) ?? asNumber(tokens.reasoningTokens) ?? 0
  return {
    inputTokens: {
      total: input,
      noCache: input !== undefined ? Math.max(0, input - cacheRead) : undefined,
      cacheRead,
      cacheWrite: 0,
    },
    outputTokens: {
      total: output,
      text: output !== undefined ? Math.max(0, output - reasoning) : undefined,
      reasoning,
    },
  }
}

function finishReason(raw: string | undefined): LanguageModelV4FinishReason {
  switch (raw) {
    case "SUCCESS":
    case "stop":
      return { unified: "stop", raw }
    case "length":
      return { unified: "length", raw }
    case "ERROR":
    case "error":
      return { unified: "error", raw }
    case "CANCELED":
    case "INTERRUPTED":
      return { unified: "interrupted", raw }
    default:
      return { unified: "other", raw }
  }
}

/**
 * Antigravity's JSON-schema enforcement occasionally returns a field whose
 * value is the JSON encoding of the whole object again, e.g.
 * `{"answer":"{\"answer\":\"OK\"}"}`. Collapse that one redundant layer so
 * the AI SDK receives the object the schema asked for.
 */
function normalizeStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStructuredValue)
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value
    try {
      return normalizeStructuredValue(JSON.parse(trimmed))
    } catch {
      return value
    }
  }
  if (typeof value !== "object" || value === null) return value

  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(record)) {
    let next = normalizeStructuredValue(raw)
    if (typeof next === "object" && next !== null && !Array.isArray(next)) {
      const nested = next as Record<string, unknown>
      const keys = Object.keys(nested)
      if (keys.length === 1 && keys[0] === key) next = nested[key]
    }
    out[key] = next
  }
  return out
}

function normalizeJsonText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text
  try {
    return JSON.stringify(normalizeStructuredValue(JSON.parse(trimmed)))
  } catch {
    return text
  }
}

export interface ParsedAntigravityOutput {
  text: string
  status: string | undefined
  conversationId: string | undefined
  usage: LanguageModelV4Usage
  error: string | undefined
}

/**
 * Parses the NDJSON stream from `agy --output-format stream-json`.
 *
 * Exported for unit tests: no process is created here, and malformed lines are
 * ignored so a stray progress line cannot fail an otherwise good result.
 */
export function parseAntigravityOutput(stdout: string, isJson = false): ParsedAntigravityOutput {
  let text = ""
  let response = ""
  let structuredText = ""
  let status: string | undefined
  let conversationId: string | undefined
  let usage = emptyUsage()
  let error: string | undefined

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    let event: Record<string, unknown>
    try {
      const parsed = JSON.parse(line)
      const record = asRecord(parsed)
      if (!record) continue
      event = record
    } catch {
      continue
    }

    const type = asString(event.event)
    const step = asRecord(event.step_update)
    const result = asRecord(event.result)
    const failure = asRecord(event.error)

    if (type === "init") {
      conversationId = asString(event.conversation_id) ?? conversationId
      continue
    }

    if (type === "step_update") {
      const delta = asString(step?.text_delta)
      if (delta) text += delta
      const stepUsage = asRecord(step?.usage)
      if (stepUsage) usage = usageFromTokens(stepUsage)
      continue
    }

    if (type === "result") {
      conversationId = asString(result?.conversation_id) ?? conversationId
      status = asString(result?.status) ?? status
      response = asString(result?.response) ?? response
      const structured = result?.structured_output
      if (typeof structured === "string") structuredText = structured
      else if (structured !== undefined) structuredText = JSON.stringify(structured)
      const resultUsage = asRecord(result?.usage)
      if (resultUsage) usage = usageFromTokens(resultUsage)
      const resultError = asString(result?.error)
      if (resultError) error = resultError
      continue
    }

    if (type === "error") {
      error =
        asString(failure?.message) ??
        asString(failure?.error) ??
        (typeof event.error === "string" ? event.error : "Antigravity CLI returned an error")
      status = "ERROR"
    }
  }

  const candidate = structuredText || response || text
  const stripped = stripFence(candidate, isJson)
  return {
    text: isJson ? normalizeJsonText(stripped) : stripped,
    status,
    conversationId,
    usage,
    error,
  }
}

interface RunInput {
  prompt: string
  modelId: string
  isJson: boolean
  schema?: string
  abortSignal?: AbortSignal
}

interface RunResult extends ParsedAntigravityOutput {
  finishReason: LanguageModelV4FinishReason
}

function scratchDirectory(): string {
  return mkdtempSync(path.join(os.tmpdir(), "rolespec-agy-"))
}

function runAntigravity({
  prompt,
  modelId,
  isJson,
  schema,
  abortSignal,
}: RunInput): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (!/^[a-zA-Z0-9._:/-]+$/.test(modelId)) {
      reject(
        new AntigravityCliError(
          `"${modelId}" is not a valid Antigravity model id. Run \`agy models\` and choose a listed model.`
        )
      )
      return
    }

    const scratch = scratchDirectory()
    let schemaPath: string | undefined
    if (schema) {
      schemaPath = path.join(scratch, "response-schema.json")
      writeFileSync(schemaPath, schema, "utf8")
    }

    const timeoutMs = Number(process.env.ANTIGRAVITY_CLI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--disable-slash-commands",
      "--sandbox",
      "--model",
      modelId,
      "--print-timeout",
      `${Math.ceil(timeoutMs / 1000)}s`,
    ]
    if (schemaPath) args.push("--json-schema", schemaPath)

    const child = spawn(process.env.ANTIGRAVITY_CLI_PATH?.trim() || "agy", args, {
      cwd: scratch,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    })

    let stdout = ""
    let stderr = ""
    let aborted = false
    let timedOut = false
    let settled = false

    const cleanup = () => {
      clearTimeout(timeout)
      abortSignal?.removeEventListener("abort", onAbort)
      rmSync(scratch, { recursive: true, force: true })
    }

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    const onAbort = () => {
      aborted = true
      child.kill()
    }
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timeout)
        rmSync(scratch, { recursive: true, force: true })
        reject(new DOMException("Request aborted", "AbortError"))
        return
      }
      abortSignal.addEventListener("abort", onAbort, { once: true })
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
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
          ? new AntigravityCliError(
              "The agy command was not found. Install the Antigravity CLI and sign in once, then try again."
            )
          : new AntigravityCliError(error.message)
      )
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      cleanup()

      if (aborted) {
        reject(new DOMException("Request aborted", "AbortError"))
        return
      }
      if (timedOut) {
        reject(
          new AntigravityCliError("Antigravity CLI timed out before finishing.", {
            exitCode: code ?? undefined,
            ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
          })
        )
        return
      }

      const parsed = parseAntigravityOutput(stdout, isJson)
      if (parsed.error || parsed.status === "ERROR" || parsed.status === "INVALID") {
        log.warn("Antigravity CLI reported an error", { model: modelId })
        reject(
          new AntigravityCliError(parsed.error ?? "Antigravity CLI returned an error.", {
            exitCode: code ?? undefined,
            ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
          })
        )
        return
      }
      if (code !== 0) {
        reject(
          new AntigravityCliError(
            `Antigravity CLI exited with code ${code ?? "unknown"}.`,
            {
              exitCode: code ?? undefined,
              ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
            }
          )
        )
        return
      }
      if (!parsed.text) {
        reject(
          new AntigravityCliError("Antigravity CLI returned an empty response.", {
            ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
          })
        )
        return
      }

      resolve({ ...parsed, finishReason: finishReason(parsed.status) })
    })

    child.stdin.on("error", () => {
      // The child may exit before reading stdin (bad model/auth). The close
      // handler reports the real cause; this only suppresses an EPIPE crash.
    })
    child.stdin.write(
      `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`
    )
    child.stdin.end()
  })
}

class AntigravityLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const
  readonly provider = "antigravity-cli"
  readonly modelId: string
  readonly supportedUrls = {}

  constructor(modelId: string) {
    this.modelId = modelId
  }

  async doGenerate(
    options: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4GenerateResult> {
    const isJson = options.responseFormat?.type === "json"
    const result = await runAntigravity({
      prompt: buildAntigravityPrompt(options),
      modelId: this.modelId,
      isJson,
      ...(options.responseFormat?.type === "json" && options.responseFormat.schema
        ? { schema: JSON.stringify(options.responseFormat.schema) }
        : {}),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    })

    return {
      content: [{ type: "text", text: result.text }],
      ...(isJson ? { structuredOutputText: result.text } : {}),
      finishReason: result.finishReason,
      usage: result.usage,
      warnings: [],
      request: { body: { model: this.modelId } },
      response: {
        ...(result.conversationId ? { id: result.conversationId } : {}),
        timestamp: new Date(),
        modelId: this.modelId,
      },
    }
  }

  async doStream(
    options: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4StreamResult> {
    // RoleSpec uses generateText/generateObject only. A one-shot stream keeps
    // the contract correct for a future caller without a second parser.
    const result = await this.doGenerate(options)
    const id = "antigravity-text"
    const text = result.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("")

    return {
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: result.warnings })
          controller.enqueue({
            type: "response-metadata",
            ...(result.response?.id ? { id: result.response.id } : {}),
            timestamp: result.response?.timestamp ?? new Date(),
            modelId: result.response?.modelId ?? "antigravity-cli",
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
      }),
      request: { body: { model: this.modelId } },
    }
  }
}

/** Resolves the model slug: explicit choice, then env, then the provider default. */
export function resolveAntigravityModelId(modelId?: string): string {
  return (
    modelId?.trim() ||
    process.env[AI_PROVIDER_META["antigravity-cli"].modelEnvVar]?.trim() ||
    AI_PROVIDER_META["antigravity-cli"].defaultModel
  )
}

export function getAntigravityCliModel(modelId?: string): LanguageModelV4 {
  return new AntigravityLanguageModel(resolveAntigravityModelId(modelId))
}
