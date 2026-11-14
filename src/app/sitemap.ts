import type { MetadataRoute } from "next"

import { siteConfig } from "@/config/site"

/**
 * Only the publicly reachable pages belong here. The workspace opens directly
 * for its owner and is not a separate marketing destination, so sign-in and
 * sign-up are gone with the account system.
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
