import { cn } from "@/shared/lib/utils"

export type LogoMarkVariant = "brand" | "ink" | "ice" | "on-dark" | "mono"

const MARK =
  "M14 13H35L47 25V31L36 42H25V52H14Z M25 23V32H32L36 28L31 23Z"
const ACCENT = "M31 45H43L51 53H39Z"

/**
 * Supplied brand-kit colourways. The geometry never changes; only the tile,
 * glyph and accent colours do, so the mark stays recognisable everywhere.
 */
const VARIANTS: Record<
  LogoMarkVariant,
  { tile: string | null; glyph: string; accent: string }
> = {
  brand: { tile: "#1447E6", glyph: "#FFFFFF", accent: "#8EC5FF" },
  ink: { tile: "#101828", glyph: "#F5F5F7", accent: "#8EC5FF" },
  ice: { tile: "#8EC5FF", glyph: "#1447E6", accent: "#FFFFFF" },
  "on-dark": { tile: null, glyph: "#FFFFFF", accent: "#8EC5FF" },
  mono: { tile: null, glyph: "currentColor", accent: "currentColor" },
}

export function LogoMark({
  className,
  variant = "brand",
}: {
  className?: string
  variant?: LogoMarkVariant
}) {
  const colors = VARIANTS[variant]

  return (
    <span className={cn("inline-flex shrink-0", className)} aria-hidden="true">
      <svg viewBox="0 0 64 64" className="h-full w-full">
        {colors.tile ? (
          <rect x="1" y="1" width="62" height="62" rx="15" fill={colors.tile} />
        ) : null}
        <path fill={colors.glyph} fillRule="evenodd" d={MARK} />
        <path fill={colors.accent} d={ACCENT} />
      </svg>
    </span>
  )
}
