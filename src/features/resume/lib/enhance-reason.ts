/**
 * The model addresses enhance targets by internal id
 * (`<sectionId>::<itemId>::b<index>` and friends) and sometimes echoes those
 * ids into the user-facing `reason`. This strips them after the model
 * responds. It is deliberately conservative: anything that is not an id from
 * this run or a bare lowercase bullet ref such as "b0" is left untouched.
 * It fails closed: if stripping throws, the reason comes back empty so the
 * suggestion is dropped.
 */

/** An id component worth stripping: long, a single token, and carrying a digit. */
const ID_COMPONENT = /^[A-Za-z0-9_-]{8,}$/
const HAS_DIGIT = /\d/

/** "bullet b0", "Bullet [b0]", "target b3", "bullet #0" — the ref goes, the noun stays. */
const CONNECTOR_REF =
  /\b(bullet|target)\s+(?:#\s*\d+\b|\[\s*b\d+\s*\]|\(\s*b\d+\s*\)|`\s*b\d+\s*`|b\d+\b)/gi

/** A bare bullet ref, optionally wrapped: b0, [b0], (b0), `b0`. Lowercase only. */
const BARE_REF = /\[\s*b\d+\s*\]|\(\s*b\d+\s*\)|`\s*b\d+\s*`|\bb\d+\b/g

const EMPTY_WRAPPERS = /\(\s*\)|\[\s*\]|`\s*`/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function removeLiteral(text: string, literal: string): string {
  return text.replace(new RegExp(escapeRegExp(literal), "g"), " ")
}

export function stripInternalRefs(reason: string, targetIds: readonly string[]): string {
  if (typeof reason !== "string") return ""
  try {
    let text = reason

    // Full ids first (longest first, so no id is half-eaten by a shorter one),
    // then the section/item components that may appear on their own.
    const fullIds = [...new Set(targetIds.filter((id) => typeof id === "string" && id))].sort(
      (a, b) => b.length - a.length
    )
    for (const id of fullIds) text = removeLiteral(text, id)

    const components = new Set<string>()
    for (const id of fullIds) {
      for (const part of id.split("::")) {
        if (ID_COMPONENT.test(part) && HAS_DIGIT.test(part)) components.add(part)
      }
    }
    for (const part of [...components].sort((a, b) => b.length - a.length)) {
      text = removeLiteral(text, part)
    }

    text = text.replace(CONNECTOR_REF, (_match, noun: string) =>
      noun.toLowerCase() === "target"
        ? noun[0] === "T"
          ? "This bullet"
          : "this bullet"
        : noun
    )
    text = text.replace(BARE_REF, " ")
    text = text.replace(/::/g, " ")
    text = text.replace(EMPTY_WRAPPERS, " ")

    return text
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
      .trim()
  } catch {
    return ""
  }
}
