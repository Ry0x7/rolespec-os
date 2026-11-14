/** Wall-clock bound on a single PDF parse. */
const PARSE_TIMEOUT_MS = 30_000
/** Longest extracted text handed to the model. */
const MAX_EXTRACTED_TEXT_LENGTH = 200_000

/**
 * Bounds how long the caller waits on the parser.
 *
 * LIMITATION: a CPU-bound parse running in this process cannot be cancelled.
 * The race bounds the *request*, not the worker — a pathological PDF can still
 * occupy the event loop after the rejection. Real isolation would need a
 * separate process or worker thread.
 */
function withParseTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`PDF parse timed out after ${PARSE_TIMEOUT_MS}ms`)),
      PARSE_TIMEOUT_MS
    )
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Extracts plain text from LinkedIn's "Save profile as PDF" export using the
 * same `pdf-parse` pipeline as the resume upload flow. Time-bounded, and the
 * output is capped before it can reach a prompt.
 */
export async function extractLinkedInPdfText(buffer: Uint8Array): Promise<string> {
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse(buffer)
  try {
    const result = await withParseTimeout(parser.getText())
    const text = result.text.replace(/\r\n/g, "\n").trim()
    return text.length > MAX_EXTRACTED_TEXT_LENGTH
      ? text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
      : text
  } finally {
    // pdf-parse v2 exposes destroy(); a mocked/older parser may not.
    await Promise.resolve(parser.destroy?.()).catch(() => {})
  }
}
