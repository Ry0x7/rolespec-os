/**
 * Readable company names for boards that never state one.
 *
 * BambooHR keys a board on a slug and Workday on a tenant, and neither payload
 * carries the employer's name, so the identifier has to stand in. Printed raw it
 * reads as an id ("globe · 18F The Globe Tower"), which is not how a person
 * writes a company down.
 *
 * Deliberately not applied to Lever or Ashby: those adapters have stored the
 * bare slug since they shipped, and rewriting existing saved jobs' company names
 * is not what this change is for.
 */

/**
 * `"globe"` → `"Globe"`, `"thinking-machines"` → `"Thinking Machines"`.
 *
 * Splits on the two separators a board slug may contain, then title-cases each
 * word. A word that is already uppercase and at most three characters is left
 * alone so an initialism survives; board slugs are lowercased on the way into
 * the watchlist, so in practice that branch only protects a hand-built caller.
 *
 * This is presentation only — it never touches the slug used to build a URL, and
 * it cannot recover a word boundary the slug does not have
 * (`"thinkingmachines"` stays one word).
 *
 * Returns the input unchanged when there is nothing to humanize, so a caller
 * always gets a non-empty name.
 */
export function humanizeBoardSlug(slug: string): string {
  const words = (slug ?? "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )

  return words.length > 0 ? words.join(" ") : slug
}
