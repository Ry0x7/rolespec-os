/**
 * Provider ids → display labels.
 *
 * Separate from the adapter modules so a client component can badge a
 * candidate's source without pulling the server-side fetch code (and the
 * logger) into the browser bundle. Adapters read their own label from here, so
 * there is still one place to change it.
 */
export const PROVIDER_LABELS: Record<string, string> = {
  remotive: "Remotive",
  arbeitnow: "Arbeitnow",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  bamboohr: "BambooHR",
  freshteam: "Freshteam",
  workday: "Workday",
  kalibrr: "Kalibrr",
  onlinejobsph: "OnlineJobs.ph",
  /** A posting the user pasted the URL of, read straight off the page. */
  web: "Added by URL",
  firecrawl: "Firecrawl",
}

/** Falls back to the raw id, so an unlabelled provider still renders. */
export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id
}
