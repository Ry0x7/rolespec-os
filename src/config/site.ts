/**
 * The app's own origin, used for canonical metadata and for absolute links in
 * outbound email.
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
  name: "RoleSpec",
  tagline: "The Job Seeking AI OS.",
  description:
    "A self-hosted workspace for building resumes, scoring them against real jobs, tracking applications and drafting outreach.",
  url: resolveAppUrl(),
} as const
