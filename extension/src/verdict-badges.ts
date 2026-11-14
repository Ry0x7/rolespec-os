import type { QualificationVerdict } from "./types"

/**
 * Badge copy per verdict, and which notice border it borrows. Shared by the side panel
 * and the in-page fit badge so both say exactly the same thing.
 */
export const VERDICT_BADGES: Record<QualificationVerdict, { label: string; notice: string }> = {
  STRONG: { label: "✓ Strong fit", notice: "notice notice-ok" },
  WORTH_A_LOOK: { label: "Worth a look", notice: "notice" },
  WEAK: { label: "⚠ Weak fit", notice: "notice notice-warn" },
  BLOCKED: { label: "⛔ Blocked", notice: "notice notice-error" },
}
