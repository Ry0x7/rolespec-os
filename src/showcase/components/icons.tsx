/**
 * Hand-authored icon set for the showcase: 24x24, 1.5 stroke, round caps,
 * drawn from scratch in an SF-Symbols-like geometry. The showcase carries no
 * icon library — these are the only glyphs on the page, used for chrome only
 * (actions, arrows, checks), never as decorative tiles.
 */

interface IconProps {
  className?: string
  style?: React.CSSProperties
}

function Base({
  className,
  style,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function DownloadIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <path d="M12 4v11" />
      <path d="M7.5 11.5 12 16l4.5-4.5" />
      <path d="M5 20h14" />
    </Base>
  )
}

export function ArrowRightIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <path d="M4 12h15" />
      <path d="M13.5 6.5 19 12l-5.5 5.5" />
    </Base>
  )
}

export function ChevronRightIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </Base>
  )
}

export function CheckIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </Base>
  )
}

export function MenuIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <path d="M4 7.5h16" />
      <path d="M4 12h16" />
      <path d="M4 16.5h16" />
    </Base>
  )
}

export function XIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Base>
  )
}

export function ExternalIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <path d="M9.5 5H5v14h14v-4.5" />
      <path d="M14 5h5v5" />
      <path d="M19 5l-6.5 6.5" />
    </Base>
  )
}

export function CopyIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5.5 15.5v-9a2 2 0 0 1 2-2h9" />
    </Base>
  )
}

export function SunIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2" />
      <path d="M12 19.5v2" />
      <path d="M2.5 12h2" />
      <path d="M19.5 12h2" />
      <path d="m5.4 5.4 1.4 1.4" />
      <path d="m17.2 17.2 1.4 1.4" />
      <path d="m18.6 5.4-1.4 1.4" />
      <path d="m6.8 17.2-1.4 1.4" />
    </Base>
  )
}

export function MoonIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <path d="M20 13.2A8.6 8.6 0 0 1 10.8 4 8.8 8.8 0 1 0 20 13.2Z" />
    </Base>
  )
}

/** RoleSpec mark: solid brand tile with a white "R" monogram — matches the
 * app's logo treatment (src/features/marketing/components/logo-mark.tsx). */
export function LogoMarkIcon({ className, style }: IconProps) {
  return (
    <span
      className={className}
      style={{ ...style, display: "inline-flex", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "22%", background: "#0066cc", color: "#fff" }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "62%", height: "62%" }} aria-hidden="true">
        <path d="M7 19.5v-15h5.5a3.75 3.75 0 0 1 0 7.5H7" />
        <path d="M12.5 12 17.5 19.5" />
      </svg>
    </span>
  )
}
