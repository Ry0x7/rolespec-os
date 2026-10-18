import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google"
import { siteConfig } from "@/config/site"
import { AppToaster } from "@/shared/components/app-toaster"
import { ACCENT_INIT_SCRIPT } from "@/shared/lib/theme"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

// Heading face (see `--font-display` in globals.css). Only the weights headings
// actually use are requested, so the extra face costs one small subset file.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "RoleSpec — The Job Seeking AI OS",
    template: "%s | RoleSpec",
  },
  description:
    "The Job Seeking AI OS: resumes, ATS scoring, application tracking and outreach in one self-hosted workspace that runs on your own AI key.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: siteConfig.name,
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
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} dark`}
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
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <AppToaster />
      </body>
    </html>
  )
}
