import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production"

/**
 * Content-Security-Policy.
 *
 * `script-src` carries `'unsafe-inline'` deliberately. The App Router streams
 * hydration payloads as inline `<script>self.__next_f.push(...)</script>` tags,
 * and src/app/layout.tsx inlines the pre-paint theme script, so a strict policy
 * needs a per-request nonce — which means reading `headers()` in the root layout
 * and giving up static rendering for every route, including the marketing pages.
 * The policy below still blocks the things a static header can block: remote
 * script origins, plugins, framing, `<base>` hijacking and cross-origin form
 * posts. Revisit if the landing page stops needing to be static.
 */
function contentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    // No iframes anywhere in the app, and the app must not be framed either.
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'"],
    // Next's inline styles, next/font and framer-motion all set style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    // OAuth avatars come from Google/GitHub CDNs, which are not a fixed origin.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
  }

  // No `upgrade-insecure-requests`: it is the one directive that would break a
  // self-hosted deployment served over plain http (the Docker image supports
  // that), and it buys almost nothing here — every subresource is same-origin, so
  // it already follows the page's scheme, and the only remote origins allowed are
  // `img-src https:` and the Sentry ingest endpoint.
  if (!isProduction) {
    // React Refresh evaluates code; the dev server talks over a websocket.
    directives["script-src"].push("'unsafe-eval'")
    directives["connect-src"].push("ws:", "wss:")
  }

  return Object.entries(directives)
    .map(([directive, values]) => (values.length ? `${directive} ${values.join(" ")}` : directive))
    .join("; ")
}

function securityHeaders() {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
    // Belt-and-braces with frame-ancestors, for anything that predates CSP2.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Resume ids live in the path, so full URLs must not leak to third parties.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    // Only meaningful over HTTPS; harmless (and ignored) on a plain-http dev origin.
    ...(isProduction
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]
      : []),
  ]
}

const nextConfig: NextConfig = {
  // Desktop builds use their own output tree. A `next dev` server in the same
  // checkout owns `.next`, and mixing the two produced a standalone bundle whose
  // manifests referenced dev chunks that the production server could not serve.
  distDir: process.env.DESKTOP_BUILD === "1" ? ".next-desktop" : ".next",
  // Self-hosted/Docker deploys run `node .next/standalone/server.js` with only
  // the traced dependency subset copied into the image. Gated on an explicit
  // build flag (set in the Dockerfile) because Vercel never consumes
  // .next/standalone — leaving it on there only changes tracing semantics and
  // adds build time. Gating on DOCKER_BUILD rather than `!process.env.VERCEL`
  // keeps a plain local `npm run build` identical to the Vercel build.
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
  // Dev-only: lets a phone/tablet on the LAN load the dev server without Next
  // 403-ing its own /_next chunks and HMR socket. Wildcard segment so a DHCP
  // reassignment does not need a config edit.
  allowedDevOrigins: ["192.168.0.*"],
  // ai-sdk-provider-claude-code pulls in @anthropic-ai/claude-agent-sdk and its
  // per-platform native binaries. It is local-dev only (see
  // src/shared/lib/ai-providers/claude-code.ts) and is dynamically imported, but
  // externalizing it keeps the bundler from trying to follow it at build time.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "ai-sdk-provider-claude-code"],
  // The PDF export embeds Inter from @fontsource at runtime via a filesystem
  // path (src/features/export/templates/pdf/setup.ts), which file tracing
  // cannot see — force the .woff files into every server bundle that may
  // render an export.
  // pdfjs-dist (via pdf-parse) pulls two things in ways tracing cannot see:
  // @napi-rs/canvas behind a try/catch require (missing it throws "DOMMatrix is
  // not defined" on PDF upload) and pdf.worker.mjs behind a runtime dynamic
  // import ("Setting up fake worker failed"). Only the linux x64 glibc canvas
  // binary is listed — the other platform packages would just bloat the image,
  // and globs that match nothing are ignored.
  // Keyed "/**/*" so the intent ("every server bundle") is what is written: the
  // consumers are all nested routes — /resumes/[id] for the export action,
  // /api/resume/parse and /api/linkedin/{rating,assist} for canvas/pdf-worker.
  // Verified against .next/server/**/*.nft.json that all four entries land in
  // those bundles.
  outputFileTracingIncludes: {
    "/**/*": [
      "node_modules/@fontsource/inter/files/inter-latin-*.woff",
      "node_modules/@napi-rs/canvas/**",
      "node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
  async headers() {
    return [
      {
        // Everything, including /api and static assets.
        source: "/:path*",
        headers: securityHeaders(),
      },
    ]
  },
  async redirects() {
    return [
      // Pricing lives as a section on the landing page, but nav/footer links and
      // inbound traffic still ask for /pricing. Temporary so the canonical URL
      // can move to a real page later without a cached 308 in the way.
      { source: "/pricing", destination: "/#pricing", permanent: false },
      // Discover lives under the tracker, but "/discover" is the URL people
      // type and the one the product language implies. Temporary for the same
      // reason as above: the canonical path may yet move.
      { source: "/discover", destination: "/jobs/discover", permanent: false },
    ];
  },
};

export default nextConfig;
