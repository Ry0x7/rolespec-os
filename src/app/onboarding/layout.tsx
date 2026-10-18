export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-start justify-center bg-background py-10 sm:items-center">
      <div className="absolute inset-0 bg-gradient-to-b from-brand-950/20 to-transparent" />
      <div className="relative z-10 w-full max-w-lg px-4">{children}</div>
    </div>
  )
}
