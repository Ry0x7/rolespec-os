export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    /* Auth screens are dark by design, whatever colour mode the visitor stored —
       `force-dark` restores the dark tokens for this subtree. */
    <div className="force-dark dark relative flex min-h-dvh items-start justify-center bg-background py-10 text-foreground sm:items-center">
      <div className="absolute inset-0 bg-gradient-to-b from-brand-950/20 to-transparent" />
      <div className="relative z-10 w-full max-w-md px-4">{children}</div>
    </div>
  )
}
