import { ArrowRight, Check, FileText, Briefcase } from "lucide-react"

/** Illustrative product content, never presented as a live account or score. */
export function ProductPreview() {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4 text-sm">
        <span className="font-semibold">Your application, connected</span>
        <span className="text-xs text-muted-foreground">Example workflow</span>
      </figcaption>
      <div className="space-y-6 p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <Briefcase className="mt-1 h-5 w-5 shrink-0 text-brand-300" aria-hidden="true" />
          <div>
            <p className="text-lg font-semibold">Product Designer</p>
            <p className="mt-1 text-sm text-muted-foreground">Example company · Saved opportunity</p>
          </div>
        </div>
        <div className="rounded-lg bg-background p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 text-brand-300" aria-hidden="true" />
            Resume tailored to this role
          </div>
          <p className="mt-4 text-sm font-semibold">Experience</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Designed an onboarding flow informed by user interviews and usability testing.
          </p>
          <div className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-sm text-brand-300">
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Relevant skills: user research, product design</span>
          </div>
        </div>
        <ol className="space-y-3 text-sm" aria-label="Application workflow">
          {[
            ["Resume", "Review and export your tailored PDF"],
            ["Outreach", "Draft a cover letter from your saved details"],
            ["Application", "Track the status and plan your follow-up"],
          ].map(([title, description]) => (
            <li key={title} className="flex items-start gap-3">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden="true" />
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-1 leading-relaxed text-muted-foreground">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  )
}
