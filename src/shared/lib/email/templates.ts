import { siteConfig } from "@/config/site"

import type { EmailMessage } from "."

/**
 * Email bodies.
 *
 * Plain string templates rather than a rendering library: these are a couple of
 * short transactional messages, and inlining the markup keeps the HTML auditable
 * — mail clients strip most CSS anyway, so a component layer would buy nothing.
 *
 * Every interpolated value is escaped. User-controlled strings reach these
 * templates (display names), and HTML mail is a real injection
 * surface: an unescaped `<a>` in a display name becomes a phishing link inside a
 * message the recipient trusts because it came from us.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Shared chrome. Table-based and inline-styled, which is what mail clients honour. */
function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#fafafa">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#18181b;border-radius:12px;border:1px solid #27272a">
      <tr>
        <td style="padding:32px">
          <p style="margin:0 0 24px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#a1a1aa">${escapeHtml(siteConfig.name)}</p>
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#fafafa">${escapeHtml(heading)}</h1>
          ${bodyHtml}
        </td>
      </tr>
    </table>
    <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#71717a">
      Sent by ${escapeHtml(siteConfig.name)}. If you were not expecting this email you can ignore it.
    </p>
  </body>
</html>`
}

function button(href: string, label: string): string {
  // href is always app-generated, never user input.
  return `<p style="margin:0 0 24px">
    <a href="${href}" style="display:inline-block;padding:12px 20px;background:#fafafa;color:#09090b;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(label)}</a>
  </p>`
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#d4d4d8">${escapeHtml(text)}</p>`
}

function fallbackLink(url: string): string {
  return `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#71717a">
    If the button does not work, paste this into your browser:<br />
    <span style="color:#a1a1aa;word-break:break-all">${escapeHtml(url)}</span>
  </p>`
}

export function passwordResetEmail(to: string, resetUrl: string, ttlMinutes: number): EmailMessage {
  const heading = "Reset your password"
  const intro = `Use the link below to choose a new password. It expires in ${ttlMinutes} minutes and can only be used once.`
  const warning =
    "If you did not ask to reset your password, ignore this email — your password has not changed."

  return {
    to,
    subject: `Reset your ${siteConfig.name} password`,
    html: layout(
      heading,
      [paragraph(intro), button(resetUrl, "Choose a new password"), paragraph(warning), fallbackLink(resetUrl)].join(
        "\n"
      )
    ),
    text: [heading, "", intro, "", resetUrl, "", warning].join("\n"),
  }
}

