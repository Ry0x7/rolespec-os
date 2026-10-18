/** Hard cap on the bytes read from a fetched portfolio page. */
export const PORTFOLIO_FETCH_MAX_BYTES = 3 * 1024 * 1024 // 3 MB
/** AbortController budget for the portfolio fetch. */
export const PORTFOLIO_FETCH_TIMEOUT_MS = 10 * 1000
/** Redirects followed manually, each re-validated against the SSRF guard. */
export const PORTFOLIO_FETCH_MAX_REDIRECTS = 3
