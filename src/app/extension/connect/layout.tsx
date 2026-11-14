/**
 * Standalone shell, modelled on `src/app/onboarding/layout.tsx`. The page opens
 * in the small popup Chrome spawns for `launchWebAuthFlow`, so it deliberately
 * carries none of the app chrome — no sidebar, no navigation to wander off into.
 */
export default function ExtensionConnectLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-start justify-center bg-background py-10 sm:items-center">
      <div className="absolute inset-0 bg-gradient-to-b from-brand-950/20 to-transparent" />
      <div className="relative z-10 w-full max-w-md px-4">{children}</div>
    </div>
  )
}
