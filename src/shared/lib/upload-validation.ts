/**
 * Content-level checks for user uploads.
 *
 * A browser-declared `File.type` and file name are attacker-controlled, so the
 * upload routes sniff the first bytes and — for the zip-shaped formats (DOCX) —
 * do a cheap structural sanity pass before any parser touches the buffer.
 *
 * Dependency-free on purpose: this runs on every upload, before the expensive
 * PDF/DOCX parse, and must never be the thing that fails a request by itself.
 */

/** File shapes this app knowingly accepts. */
export type UploadKind = "pdf" | "zip"

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // "PK\x03\x04"

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false
  }
  return true
}

/**
 * Identifies an upload from its leading bytes. `null` means "not a shape we
 * accept" — including a buffer too short to tell.
 *
 * DOCX is a zip container, so a DOCX and a plain zip are indistinguishable
 * here; `checkZipSanity` plus the parser itself carry the rest.
 */
export function sniffUploadKind(bytes: Uint8Array): UploadKind | null {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf"
  if (startsWith(bytes, ZIP_MAGIC)) return "zip"
  return null
}

export interface ZipSanityOptions {
  /** Sum of the central directory's declared uncompressed sizes. */
  maxTotalUncompressedBytes?: number
  /** Number of entries the archive says it holds. */
  maxEntries?: number
}

export interface ZipSanityResult {
  ok: boolean
  /** Machine-readable failure cause. Absent when `ok`. */
  reason?:
    | "no_eocd"
    | "malformed"
    | "too_many_entries"
    | "too_large_uncompressed"
  /** Entries declared by the End Of Central Directory record. */
  entries?: number
  /** Sum of the declared uncompressed sizes. */
  totalUncompressedBytes?: number
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_FILE_SIGNATURE = 0x02014b50
const EOCD_MIN_SIZE = 22
/** A zip comment is a uint16 length, so the EOCD starts at most 64 KB + 22 from the end. */
const EOCD_SEARCH_WINDOW = 0xffff + EOCD_MIN_SIZE

const DEFAULT_MAX_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 1000

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

/** Scans backwards for the End Of Central Directory signature. -1 when absent. */
function findEocd(bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - EOCD_SEARCH_WINDOW)
  for (let i = bytes.length - EOCD_MIN_SIZE; i >= start; i--) {
    if (readUint32LE(bytes, i) === EOCD_SIGNATURE) return i
  }
  return -1
}

/**
 * Structural zip-bomb guard: walks the central directory and adds up the
 * *declared* uncompressed sizes.
 *
 * IMPORTANT LIMITATION: those sizes are self-reported by the archive and can
 * lie — a crafted zip may declare 1 KB and inflate to gigabytes. This check is
 * a cheap first filter that catches honest-but-huge and obviously malformed
 * archives; the parser timeout in the extraction layer is the real backstop.
 *
 * Zip64 archives (entries at 0xFFFFFFFF) are not decoded; such an entry reads
 * as its 32-bit sentinel, which already exceeds the default cap and is
 * rejected.
 */
export function checkZipSanity(
  bytes: Uint8Array,
  options: ZipSanityOptions = {}
): ZipSanityResult {
  const maxTotal =
    options.maxTotalUncompressedBytes ?? DEFAULT_MAX_TOTAL_UNCOMPRESSED
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES

  const eocd = findEocd(bytes)
  if (eocd < 0) return { ok: false, reason: "no_eocd" }

  const entries = readUint16LE(bytes, eocd + 10)
  const directorySize = readUint32LE(bytes, eocd + 12)
  const directoryOffset = readUint32LE(bytes, eocd + 16)

  if (entries > maxEntries) {
    return { ok: false, reason: "too_many_entries", entries }
  }
  if (directoryOffset + directorySize > bytes.length) {
    return { ok: false, reason: "malformed", entries }
  }

  let cursor = directoryOffset
  let total = 0

  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > bytes.length) {
      return { ok: false, reason: "malformed", entries }
    }
    if (readUint32LE(bytes, cursor) !== CENTRAL_FILE_SIGNATURE) {
      return { ok: false, reason: "malformed", entries }
    }

    total += readUint32LE(bytes, cursor + 24)
    if (total > maxTotal) {
      return {
        ok: false,
        reason: "too_large_uncompressed",
        entries,
        totalUncompressedBytes: total,
      }
    }

    const nameLength = readUint16LE(bytes, cursor + 28)
    const extraLength = readUint16LE(bytes, cursor + 30)
    const commentLength = readUint16LE(bytes, cursor + 32)
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return { ok: true, entries, totalUncompressedBytes: total }
}

/** Longest title kept from an upload's file name. */
const MAX_UPLOAD_TITLE_LENGTH = 120

/**
 * Turns an upload's file name into something safe to store as a title: last
 * extension dropped, control characters removed, whitespace collapsed, capped.
 * Returns "" when nothing usable is left, so callers keep their own fallback.
 */
export function sanitizeUploadTitle(name: string): string {
  const withoutExtension = name.replace(/\.[^/.]+$/, "")
  const cleaned = withoutExtension
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned.slice(0, MAX_UPLOAD_TITLE_LENGTH).trim()
}
