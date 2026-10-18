import { cn } from "@/shared/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg bg-gradient-to-br from-brand-700 to-[var(--accent-warm)]",
        className
      )}
      aria-hidden="true"
    />
  )
}
