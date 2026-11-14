import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { siteConfig } from "@/config/site"
import { AppToaster } from "@/shared/components/app-toaster"
import { AppMotionProvider } from "@/shared/components/app-motion-provider"
import { ACCENT_INIT_SCRIPT } from "@/shared/lib/theme"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  preload: true,
})

// Headings reuse Inter (see `--font-display` in globals.css) — one text face
// for the whole product, Apple-style. No separate display face to load.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
})

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: siteConfig.name,
  applicationCategory: siteConfig.applicationCategory,
  operatingSystem: siteConfig.operatingSystem,
  description: siteConfig.description,
  url: siteConfig.url,
  softwareVersion: "1.0.2",
  isAccessibleForFree: true,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  publisher: {
    "@type": "Organization",
    name: siteConfig.publisher,
    url: siteConfig.url,
  },
}

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  applicationName: siteConfig.name,
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: `${siteConfig.tagline} ${siteConfig.description}`,
  authors: [{ name: siteConfig.publisher }],
  creator: siteConfig.publisher,
  publisher: siteConfig.publisher,
  category: "productivity",
  keywords: [
    "job search",
    "resume builder",
    "ATS resume checker",
    "job application tracker",
    "cover letter",
    "career profile",
    "self-hosted",
    "RoleSpec OS",
    "Chryypt Inc",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    url: siteConfig.url,
    locale: "en_US",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: siteConfig.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    images: ["/opengraph-image"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: siteConfig.shortName,
  },
}

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#09090C",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} dark`}
      // The init script below adds a `theme-*` class and can swap `dark` for
      // `light` before hydration, so <html>'s className legitimately differs
      // from the server markup.
      suppressHydrationWarning
    >
      <head>
        {/* Applies the stored accent and colour mode before first paint so
            neither the accent nor the background flashes on load. */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
        {/* Framer server-renders the reveal items at opacity 0 and only clears
            it on hydration, so without JS everything below the hero is blank. */}
        <noscript>
          <style>{`.scroll-reveal-item,.hero-reveal-item{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppMotionProvider>
          {children}
          <AppToaster />
        </AppMotionProvider>
      </body>
    </html>
  )
}
