import type { MetadataRoute } from "next"

import { siteConfig } from "@/config/site"

/**
 * The app had no robots file, so crawlers had no guidance at all.
 *
 * Everything behind the owner guard is disallowed. A crawler that reaches one
 * of these routes is redirected to /unlock, so they were never indexable — but
 * each attempt costs a request, and a disallow keeps them out of crawl budget
 * and out of any "pages with redirects" report.
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
          "/career-profile",
          "/settings",
          "/onboarding",
          // The remote owner key screen must never be indexed.
          "/unlock",
        ],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
  }
}
