import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { cn } from "@/shared/lib/utils"

interface GettingStartedProps {
  hasResume: boolean
  hasAtsScan: boolean
  hasJob: boolean
  hasProfile: boolean
}

export function GettingStarted({
  hasResume,
  hasAtsScan,
  hasJob,
  hasProfile,
}: GettingStartedProps) {
  const steps = [
    { label: "Set up your career profile", href: "/career-profile", done: hasProfile },
    { label: "Create your first resume", href: "/resumes", done: hasResume },
    { label: "Run an ATS scan", href: "/resumes", done: hasAtsScan },
    { label: "Track your first job application", href: "/jobs", done: hasJob },
  ]

  const completed = steps.filter((step) => step.done).length
  if (completed === steps.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Getting started</CardTitle>
        <CardDescription>
          {completed} of {steps.length} complete
        </CardDescription>
      </CardHeader>

      <ul className="mt-4 space-y-2">
        {steps.map((step) => (
          <li key={step.label}>
            {step.done ? (
              <div className="flex items-center gap-3 rounded-md px-2 py-2 text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600/20">
                  <Check className="h-3 w-3 text-brand-400" />
                </span>
                <span className="text-muted-foreground line-through">{step.label}</span>
              </div>
            ) : (
              <Link
                href={step.href}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                <span className="h-5 w-5 rounded-full border border-border" />
                <span className="text-foreground">{step.label}</span>
                <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
