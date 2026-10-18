/**
 * Structured logging.
 *
 * The app logged through 37 bare `console.*` calls with hand-written `[scope]`
 * prefixes. That is readable in a terminal and close to useless in a hosted log
 * viewer: no level to filter on, no scope to group by, and no way to attach
 * context without interpolating it into a sentence.
 *
 * Two output shapes, chosen by environment rather than by configuration:
 *
 * - **Production** emits one JSON object per line, which is what Vercel's log
 *   drains and every aggregator parse.
 * - **Development** emits `LEVEL [scope] message { context }`, which is what a
 *   human reads.
 *
 * This does not report to Sentry. Call sites that need an exception recorded
 * already call `Sentry.captureException` explicitly, and folding that in here
 * would double-report every handled error that is also logged.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** Structured fields attached to a line. Values must be JSON-serialisable. */
export type LogContext = Record<string, unknown>

/**
 * Context keys whose values are replaced with `[redacted]`.
 *
 * Matched case-insensitively as a substring, so `resetToken`, `AUTH_SECRET` and
 * `OPENAI_API_KEY` are all covered. This is a backstop, not a licence to pass
 * secrets — but a backstop is worth having, because the cost of one accidental
 * token in a log aggregator is an account takeover.
 */
const REDACTED_KEY_PATTERNS = [
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "credential",
  "signature",
]

const REDACTED = "[redacted]"

function shouldRedact(key: string): boolean {
  const lower = key.toLowerCase()
  return REDACTED_KEY_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Recursively redacts sensitive keys. Depth-limited because log context should be
 * shallow, and an unbounded walk over an unexpected object graph (a Prisma model,
 * a request) is a way to turn logging into a performance problem.
 */
export function redactContext(context: LogContext, depth = 0): LogContext {
  if (depth > 3) return { truncated: true }

  const out: LogContext = {}
  for (const [key, value] of Object.entries(context)) {
    if (shouldRedact(key)) {
      out[key] = REDACTED
      continue
    }
    if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message }
      continue
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactContext(value as LogContext, depth + 1)
      continue
    }
    out[key] = value
  }
  return out
}

/** Below this level, lines are dropped. `debug` is silent outside development. */
function minimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase()
  if (configured && configured in LEVEL_ORDER) return configured as LogLevel
  return process.env.NODE_ENV === "production" ? "info" : "debug"
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production"
}

/** `console` is the transport: the platform captures stdout/stderr either way. */
function write(level: LogLevel, line: string): void {
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

function format(level: LogLevel, scope: string, message: string, context?: LogContext): string {
  const safe = context ? redactContext(context) : undefined

  if (isProduction()) {
    return JSON.stringify({
      level,
      scope,
      message,
      time: new Date().toISOString(),
      ...safe,
    })
  }

  const suffix = safe && Object.keys(safe).length > 0 ? ` ${JSON.stringify(safe)}` : ""
  return `${level.toUpperCase()} [${scope}] ${message}${suffix}`
}

export interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  /** Narrows the scope, e.g. `logger("resume").child("parse")`. */
  child(scope: string): Logger
}

/**
 * Creates a logger for one scope. Scopes read as paths — `resume/parse`,
 * `export/store` — matching the `[bracketed]` prefixes this replaces, so
 * existing log searches keep working.
 */
export function logger(scope: string): Logger {
  const emit = (level: LogLevel, message: string, context?: LogContext) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel()]) return
    write(level, format(level, scope, message, context))
  }

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
    child: (childScope) => logger(`${scope}/${childScope}`),
  }
}
