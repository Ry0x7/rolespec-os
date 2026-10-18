import { siteConfig } from "@/config/site"
import { logger } from "@/shared/lib/logger"

const log = logger("email")

/**
 * Outbound email.
 *
 * The app had no way to send mail at all, which is why there was no password
 * reset. This is the one seam every outbound message goes through.
 *
 * Deliberately dependency-free: Resend's REST API is a single POST, so adding an
 * SDK would buy nothing and widen the install. Swapping provider means adding one
 * `EmailTransport`.
 *
 * Server-only — it reads `RESEND_API_KEY` and must never be imported into a
 * client component.
 */

export interface EmailMessage {
  to: string
  subject: string
  /** Both bodies are always sent: some clients refuse to render HTML-only mail. */
  html: string
  text: string
}

export type EmailResult =
  | { ok: true; transport: "resend" | "log" }
  | { ok: false; transport: "resend" | "log"; error: string }

export interface EmailTransport {
  readonly name: "resend" | "log"
  send(message: EmailMessage): Promise<EmailResult>
}

/** Sender address. Must be a domain verified with the provider. */
function fromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || `RoleSpec <no-reply@${hostOf(siteConfig.url)}>`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "localhost"
  }
}

/**
 * Development / unconfigured fallback: logs the message instead of sending it.
 *
 * The subject and recipient are logged so a developer can follow the flow, and
 * the body is logged **in full** because that is the only way to click a reset
 * link locally. It therefore prints a token to stdout — acceptable in dev, which
 * is why `selectTransport` refuses to choose this transport in production.
 */
export const logTransport: EmailTransport = {
  name: "log",
  async send(message) {
    console.log(
      [
        "",
        "──────── email (not sent: no RESEND_API_KEY) ────────",
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        "",
        message.text,
        "────────────────────────────────────────────────────",
        "",
      ].join("\n")
    )
    return { ok: true, transport: "log" }
  },
}

export const resendTransport: EmailTransport = {
  name: "resend",
  async send(message) {
    const apiKey = process.env.RESEND_API_KEY?.trim()
    if (!apiKey) return { ok: false, transport: "resend", error: "RESEND_API_KEY is not set" }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress(),
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      })

      if (!response.ok) {
        // The body carries the provider's reason (unverified domain, bad key).
        // Kept for the server log only — never returned to a caller, because
        // these messages reach user-facing flows.
        const detail = await response.text().catch(() => "")
        return {
          ok: false,
          transport: "resend",
          error: `resend responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        }
      }

      return { ok: true, transport: "resend" }
    } catch (error) {
      return {
        ok: false,
        transport: "resend",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
}

/**
 * Picks a transport from the environment.
 *
 * Falls back to logging when no key is configured so local development works
 * unchanged — except in production, where silently not sending a password reset
 * is worse than failing loudly, so the absence of a key is surfaced as an error.
 */
export function selectTransport(
  env: Record<string, string | undefined> = process.env
): EmailTransport | null {
  if (env.RESEND_API_KEY?.trim()) return resendTransport
  if (env.NODE_ENV === "production") return null
  return logTransport
}

/**
 * Sends one message. Never throws — every caller is a user-facing flow that must
 * not 500 because a third party is down, and each decides for itself whether a
 * failure is worth surfacing.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const transport = selectTransport()

  if (!transport) {
    const error = "no email transport configured (set RESEND_API_KEY)"
    log.error("dropping message: no transport configured", { to: message.to, reason: error })
    return { ok: false, transport: "resend", error }
  }

  const result = await transport.send(message)
  if (!result.ok) {
    log.error("send failed", { transport: result.transport, reason: result.error })
  }
  return result
}
