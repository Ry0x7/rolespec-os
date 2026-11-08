/**
 * The app's own origin, used for canonical metadata and for absolute links.
 *
 * `NEXT_PUBLIC_APP_URL` is the intended source and is inlined at build time.
 * `VERCEL_PROJECT_PRODUCTION_URL` is a runtime fallback so that forgetting the
 * var on a Vercel deploy degrades to the real production domain rather than
 * `localhost:3100`. It is the stable production domain (not the per-deployment
 * `VERCEL_URL`), which is what a link target needs to be.
 */
function resolveAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/+$/, "")

  const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercelDomain) return `https://${vercelDomain}`

  return "http://localhost:3100"
}

export const siteConfig = {
  /** Product name used in page titles, navigation and structured data. */
  name: "RoleSpec OS",
  /** Space-constrained name for the web app manifest and install surfaces. */
  shortName: "RoleSpec OS",
  /** Publisher shown in metadata and the Windows installer properties. */
  publisher: "Chryypt",
  tagline: "The Job Seeking AI OS.",
  description:
    "A self-hosted job-search workspace for resumes, ATS analysis, job discovery, applications and follow-ups.",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Windows, macOS, Linux",
  url: resolveAppUrl(),
} as const
