/**
 * Pure research predicates shared by server and client code.
 *
 * Kept out of `company-research.service.ts` because that module owns the
 * SSRF-guarded fetch and imports Node-only code. A client component may only
 * import this file and the research result type.
 */

export function isVerifiedCompanyResearch(
  research: { citations?: readonly unknown[] | null } | null | undefined
): boolean {
  return Boolean(
    research?.citations?.some(
      (citation) =>
        typeof citation === "object" &&
        citation !== null &&
        (citation as { verified?: unknown }).verified === true
    )
  )
}

/**
 * A result written after source checking existed, even when no URL could be
 * fetched. Legacy rows have no marker and must not claim they were checked.
 */
export function isSourceCheckedResearch(
  research: { validationVersion?: unknown } | null | undefined
): boolean {
  return research?.validationVersion === 2
}
