import { ImageResponse } from "next/og"

const ACCENT = "#7C3AED"

type IconSpec = {
  id: string
  size: { width: number; height: number }
  contentType: string
  alt: string
}

export function generateImageMetadata(): IconSpec[] {
  return [
    {
      id: "32",
      size: { width: 32, height: 32 },
      contentType: "image/png",
      alt: "RoleSpec",
    },
    {
      id: "192",
      size: { width: 192, height: 192 },
      contentType: "image/png",
      alt: "RoleSpec",
    },
    {
      id: "512",
      size: { width: 512, height: 512 },
      contentType: "image/png",
      alt: "RoleSpec",
    },
    {
      id: "512-maskable",
      size: { width: 512, height: 512 },
      contentType: "image/png",
      alt: "RoleSpec",
    },
  ]
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const iconId = String(await id)
  const maskable = iconId.endsWith("-maskable")
  const dimension = Number.parseInt(iconId, 10)

  // Maskable icons bleed to the edges and keep the glyph inside the 80% safe
  // zone; standard icons use a rounded square mark.
  const fontSize = Math.round(dimension * (maskable ? 0.44 : 0.62))
  const borderRadius = maskable ? 0 : Math.round(dimension * 0.22)

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
          borderRadius,
          color: "#FFFFFF",
          fontSize,
          fontWeight: 700,
          letterSpacing: "-0.05em",
        }}
      >
        R
      </div>
    ),
    { width: dimension, height: dimension }
  )
}
