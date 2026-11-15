import { ImageResponse } from "next/og"

const ACCENT = "#7C3AED"

export const size = {
  width: 180,
  height: 180,
}
export const contentType = "image/png"

export default function AppleIcon() {
  // iOS applies its own mask, so the mark bleeds to the edges.
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: ACCENT,
          color: "#FFFFFF",
          fontSize: 112,
          fontWeight: 700,
          letterSpacing: "-0.05em",
        }}
      >
        R
      </div>
    ),
    { ...size }
  )
}
