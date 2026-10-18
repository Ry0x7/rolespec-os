import type { MetadataRoute } from "next"

import { siteConfig } from "@/config/site"

/**
 * The app had no robots file, so crawlers had no guidance at all.
 *
 * Everything behind a session is disallowed. Those routes already redirect a
 * signed-out crawler to /sign-in, so they were never indexable — but each attempt
 * costs a request, and a disallow keeps them out of crawl budget and out of any
 * "pages with redirects" report. The admin surface is covered by the /settings
 * disallow: it lives at /settings/admin and returns 404 to non-admins anyway.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/resumes",
          "/jobs",
          "/workspace",
          "/planner",
          "/linkedin",
          "/portfolio",
          "/settings",
          "/onboarding",
          "/admin-verify",
          // Account recovery pages carry single-use tokens in the query string.
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
  }
}
