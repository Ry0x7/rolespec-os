import type { MetadataRoute } from "next"

import { siteConfig } from "@/config/site"

/**
 * Only the publicly reachable pages belong here. Everything else in the app is
 * behind a session, so listing it would submit URLs that answer with a redirect —
 * which is worse than not listing them.
 *
 * `/pricing` is deliberately absent: `redirects()` in next.config.ts sends it to
 * `/#pricing`, and a sitemap entry that 308s is a crawl error rather than a hint.
 * The legal pages are included because they are exactly what a payment processor
 * or an app store reviewer goes looking for.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  return [
    { url: siteConfig.url, lastModified, changeFrequency: "weekly", priority: 1 },
    {
      url: `${siteConfig.url}/sign-up`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteConfig.url}/sign-in`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${siteConfig.url}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteConfig.url}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ]
}
