import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ArrowRight,
  Gauge,
  KeyRound,
  Mail,
  PanelRight,
  ReceiptText,
  Server,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  Target,
} from "lucide-react"
import { auth } from "@/features/auth/config"
import { buttonVariants } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { MarketingNav } from "@/features/marketing/components/marketing-nav"
import { MarketingFooter } from "@/features/marketing/components/marketing-footer"
import { ProductPreview } from "@/features/marketing/components/product-preview"
import {
  HeroReveal,
  HeroRevealItem,
} from "@/features/marketing/components/hero-reveal"
import {
  ScrollReveal,
  ScrollRevealItem,
} from "@/shared/components/scroll-reveal"

/** The modules that ship in the app today — nothing here is aspirational. */
const MODULES = [
  {
    icon: Sparkles,
    name: "Resume Studio",
    description:
      "A structured resume editor with AI enhance on every section, versions you can keep, and PDF export.",
  },
  {
    icon: Gauge,
    name: "ATS Engine",
    description:
      "Score a resume against a real job description. Sub-scores per area and the exact keywords you are missing.",
  },
  {
    icon: SquareKanban,
    name: "Job Tracker",
    description:
      "A kanban pipeline across seven statuses — interested, applied, screening, interview, offer, rejected, withdrawn.",
  },
  {
    icon: Mail,
    name: "Outreach Composer",
    description:
      "Cover letters, cold emails, application emails and replies, drafted from the resume and job you already saved.",
  },
  {
    icon: Target,
    name: "Planner & Goals",
    description:
      "Todos, notes and a calendar next to a weekly application goal, so the search keeps a cadence.",
  },
  {
    icon: PanelRight,
    name: "Chrome Clipper",
    description:
      "Save job postings from Chrome and draft LinkedIn outreach without leaving the page.",
  },
] as const

const STEPS = [
  {
    step: "01",
    title: "Start with your resume",
    description:
      "Create your account on your RoleSpec deployment. Import an existing PDF or DOCX resume, or build one from scratch.",
  },
  {
    step: "02",
    title: "Tailor it to the role",
    description:
      "Connect your AI key in Settings. Compare your resume with a job description, review suggestions, and export your tailored PDF.",
  },
  {
    step: "03",
    title: "Apply, reach out, track",
    description:
      "Clip jobs from the browser, draft the outreach, and move every application across the pipeline until it lands.",
  },
] as const

const STACK = [
  {
    icon: ReceiptText,
    title: "100% Free & Open Source",
    description:
      "Licensed under AGPL-3.0. No subscriptions, no paywalls, no artificial feature gates.",
  },
  {
    icon: ShieldCheck,
    title: "Complete Privacy",
    description:
      "Your career data, resumes, and notes stay in your own database. No tracking, no data harvesting.",
  },
  {
    icon: KeyRound,
    title: "Bring your own AI key",
    description:
      "OpenAI or Anthropic at cost, or keep it entirely local with Ollama or LM Studio. The model bill is yours, not ours.",
  },
  {
    icon: Server,
    title: "Self-host anywhere",
    description:
      "Run RoleSpec on your own infrastructure. Your resumes and applications stay in your own database.",
  },
] as const

/** Shared section heading and supporting copy. */
function SectionHeading({
  headingId,
  title,
  blurb,
}: {
  headingId: string
  title: string
  blurb: string
}) {
  return (
    <ScrollRevealItem className="max-w-2xl space-y-3">
      <h2
        id={headingId}
        className="text-balance text-3xl font-bold tracking-tight sm:text-4xl"
      >
        {title}
      </h2>
      <p className="text-pretty text-muted-foreground">{blurb}</p>
    </ScrollRevealItem>
  )
}

export default async function LandingPage() {
  // A signed-in visitor has no use for the pitch and a "Sign in" nav — send
  // them to the app. Signed-out visitors still get the marketing page.
  const session = await auth()
  if (session?.user?.id) redirect("/dashboard")

  return (
    /* The landing page is dark by design, whatever colour mode the visitor
       stored — `force-dark` restores the dark tokens for this subtree. */
    <div className="force-dark dark flex min-h-screen flex-col bg-background text-foreground">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:p-3 focus:text-foreground focus:ring-2 focus:ring-ring">Skip to content</a>
      <MarketingNav />

      <main id="main-content" tabIndex={-1} className="flex-1">
        <section aria-labelledby="hero-heading" className="border-b border-border">
          <HeroReveal className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-24">
            <div>
              <HeroRevealItem>
                <h1 id="hero-heading" className="max-w-2xl text-balance text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                  Build a stronger resume.<br />
                  <span className="text-brand-300">Keep your job search moving.</span>
                </h1>
                <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
                  Tailor your resume to the role, write your outreach, and track every application in one place.
                </p>
              </HeroRevealItem>
              <HeroRevealItem className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/sign-up" className={cn(buttonVariants({ size: "lg" }), "min-h-11")}>
                  Create account <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link href="#how-it-works" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11")}>
                  See how it works
                </Link>
              </HeroRevealItem>
              <HeroRevealItem>
                <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground">
                  Free & Open Source (AGPL-3.0). Self-hosted. Bring your own AI key.<br />
                  AI provider charges are separate.
                </p>
              </HeroRevealItem>
            </div>
            <HeroRevealItem className="min-w-0">
              <ProductPreview />
            </HeroRevealItem>
          </HeroReveal>
        </section>

        {/* Modules */}
        <section
          id="features"
          aria-labelledby="features-heading"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20"
        >
          <ScrollReveal>
            <SectionHeading
              headingId="features-heading"
              title="Everything for your next application"
              blurb="Your resumes, saved jobs, and outreach stay connected, so you can pick up where you left off."
            />

            <ul className="mt-12 grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((module) => (
                <ScrollRevealItem as="li" key={module.name}>
                  <div className="h-full border-t border-border py-6">
                    <module.icon className="h-5 w-5 text-brand-300" aria-hidden="true" />
                    <h3 className="mt-4 font-semibold">{module.name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {module.description}
                    </p>
                  </div>
                </ScrollRevealItem>
              ))}
            </ul>
          </ScrollReveal>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          aria-labelledby="how-it-works-heading"
          className="scroll-mt-20 border-y border-border bg-card/40"
        >
          <div className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20">
            <ScrollReveal>
              <SectionHeading
                headingId="how-it-works-heading"
                title="From your resume to your next opportunity"
                blurb="A clear path for each application, with your work saved along the way."
              />

              <div className="relative mt-12">
                {/* Connector segments sit in the two grid gutters (gap-6 at
                    md+) so the rail never shows through the glass cards. */}
                <span
                  aria-hidden="true"
                  className="step-rail absolute left-[calc(33.333%-1rem)] top-11 hidden h-px w-6 md:block"
                />
                <span
                  aria-hidden="true"
                  className="step-rail absolute left-[calc(66.667%-0.5rem)] top-11 hidden h-px w-6 md:block"
                />
                <ol className="relative grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-3">
                  {STEPS.map((item) => (
                    <ScrollRevealItem as="li" key={item.step}>
                      <div className="h-full rounded-xl border border-border bg-card p-6">
                        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-700/15 font-mono text-sm font-bold text-brand-300 shadow-glow-sm ring-1 ring-brand-700/40">
                          {item.step}
                        </span>
                        <h3 className="mt-4 text-lg font-semibold">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </ScrollRevealItem>
                  ))}
                </ol>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* Own your stack (kept at #pricing — /pricing redirects here) */}
        <section
          id="pricing"
          aria-labelledby="pricing-heading"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20"
        >
          <ScrollReveal>
            <SectionHeading
              headingId="pricing-heading"
              title="Own your stack. Run it yourself."
              blurb="Free, open source, and self-hosted. You own the deployment, the database, and the relationship with your AI provider."
            />

            <ul className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
              {STACK.map((item) => (
                <ScrollRevealItem as="li" key={item.title}>
                  <div className="flex h-full items-start gap-4 border-t border-border py-6">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-700/15 text-brand-400 shadow-glow-sm ring-1 ring-brand-700/40">
                      <item.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </ScrollRevealItem>
              ))}
            </ul>
          </ScrollReveal>
        </section>

        {/* Final CTA */}
        <section
          aria-labelledby="cta-heading"
          className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24"
        >
          <ScrollReveal>
            <ScrollRevealItem>
              <div className="rounded-xl border border-border bg-card">
                <div className="px-6 py-12 text-center sm:px-12 sm:py-16">

                  <div className="mx-auto flex max-w-2xl flex-col items-center gap-5">
                    <h2
                      id="cta-heading"
                      className="text-balance text-3xl font-extrabold tracking-tight sm:text-5xl"
                    >
                      Make your next application count
                    </h2>
                    <p className="text-pretty text-muted-foreground sm:text-lg">
                      Start with your resume. Tailor it to a role. Keep your next step in sight.
                    </p>
                    <Link
                      href="/sign-up"
                      className={cn(
                        buttonVariants({ size: "lg" }),
                        "min-h-11 w-full sm:w-auto"
                      )}
                    >
                      Create account
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            </ScrollRevealItem>
          </ScrollReveal>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
