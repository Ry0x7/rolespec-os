import { ImageResponse } from "next/og"
import { siteConfig } from "@/config/site"

/**
 * Social preview card. Kept deliberately typographic so it needs no external
 * font download at request time: the generated image is the product name, the
 * one-line promise and the publisher.
 */
export const alt = `${siteConfig.name} — ${siteConfig.tagline}`
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#09090C",
          color: "#F4F4F5",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              width: "64px",
              height: "64px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "16px",
              background: "#4F46E5",
              fontSize: "34px",
              fontWeight: 700,
            }}
          >
            R
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "34px", fontWeight: 700 }}>{siteConfig.name}</span>
            <span style={{ fontSize: "20px", color: "#A1A1AA" }}>by {siteConfig.publisher}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <span style={{ fontSize: "72px", fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.03em" }}>
            {siteConfig.tagline}
          </span>
          <span style={{ fontSize: "30px", lineHeight: 1.35, color: "#A1A1AA", maxWidth: "950px" }}>
            Resumes, ATS analysis, job discovery and application tracking in one
            self-hosted workspace.
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "22px", color: "#71717A" }}>
          <span>{siteConfig.url.replace(/^https?:\/\//, "")}</span>
          <span>Self-hosted · Bring your own AI key</span>
        </div>
      </div>
    ),
    size
  )
}
