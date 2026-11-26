import { ImageResponse } from "next/og"

const BRAND = "#1447E6"
const ICE = "#8EC5FF"

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
      alt: "RoleSpec OS",
    },
    {
      id: "192",
      size: { width: 192, height: 192 },
      contentType: "image/png",
      alt: "RoleSpec OS",
    },
    {
      id: "512",
      size: { width: 512, height: 512 },
      contentType: "image/png",
      alt: "RoleSpec OS",
    },
    {
      id: "512-maskable",
      size: { width: 512, height: 512 },
      contentType: "image/png",
      alt: "RoleSpec OS",
    },
  ]
}

/** The supplied brand-kit geometry (64-unit grid, no font dependencies). */
const MARK = `
  <path fill="#FFFFFF" fill-rule="evenodd" d="M14 13H35L47 25V31L36 42H25V52H14Z M25 23V32H32L36 28L31 23Z"/>
  <path fill="${ICE}" d="M31 45H43L51 53H39Z"/>
`

function iconSvg(maskable: boolean): string {
  if (maskable) {
    // Maskable icons are clipped by the launcher, so the tile bleeds to the
    // edges and the mark is inset into the 80% safe zone.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${BRAND}"/>
  <g transform="translate(32 32) scale(0.88) translate(-32 -32)">${MARK}</g>
</svg>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="1" y="1" width="62" height="62" rx="15" fill="${BRAND}"/>
  ${MARK}
</svg>`
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const iconId = String(await id)
  const maskable = iconId.endsWith("-maskable")
  const dimension = Number.parseInt(iconId, 10)
  const svg = iconSvg(maskable)
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundImage: `url(${src})`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
      }}
    />,
    { width: dimension, height: dimension }
  )
}
