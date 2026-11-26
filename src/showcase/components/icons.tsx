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

export function ExpandIcon({ className, style }: IconProps) {
  return (
    <Base className={className} style={style}>
      <path d="M9.5 4.5H4.5v5" />
      <path d="M14.5 4.5h5v5" />
      <path d="M19.5 14.5v5h-5" />
      <path d="M4.5 14.5v5h5" />
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

/** RoleSpec mark: the supplied brand-kit app icon. Matches the app's logo
 * treatment (src/features/marketing/components/logo-mark.tsx). */
export function LogoMarkIcon({ className, style }: IconProps) {
  return (
    <span
      className={className}
      style={{ ...style, display: "inline-flex", flexShrink: 0 }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" style={{ width: "100%", height: "100%" }} aria-hidden="true">
        <rect x="1" y="1" width="62" height="62" rx="15" fill="#1447E6" />
        <path fill="#FFFFFF" fillRule="evenodd" d="M14 13H35L47 25V31L36 42H25V52H14Z M25 23V32H32L36 28L31 23Z" />
        <path fill="#8EC5FF" d="M31 45H43L51 53H39Z" />
      </svg>
    </span>
  )
}
