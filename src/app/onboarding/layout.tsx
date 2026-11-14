export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="force-dark dark relative flex min-h-dvh items-start justify-center bg-background py-8 sm:items-center sm:py-12 text-foreground">
      {/* Ambient background aura glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(168,85,247,0.15),transparent_70%)]"
      />
      <div className="relative z-10 w-full max-w-2xl px-4">{children}</div>
    </div>
  )
}
