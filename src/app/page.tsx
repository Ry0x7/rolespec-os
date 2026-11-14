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
import { InteractivePreview } from "@/features/marketing/components/interactive-preview"
import { HiggsfieldAura } from "@/features/marketing/components/higgsfield-aura"
import { AnimatedBadge } from "@/features/marketing/components/animated-badge"
import { SpotlightCard } from "@/features/marketing/components/spotlight-card"
import { ModelShowcase } from "@/features/marketing/components/model-showcase"
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
      "A structured resume editor with AI enhance on every section, versions you can keep, and real PDF export.",
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
      "Open your RoleSpec workspace. Import an existing PDF or DOCX resume, or build one from scratch.",
  },
  {
    step: "02",
    title: "Tailor it to the role",
    description:
      "Connect your local AI (Ollama / LM Studio) or cloud key. Compare your resume with a job description and export.",
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
    title: "Local Offline Models or Cloud",
    description:
      "Keep it entirely local with Ollama or LM Studio at zero cost, or connect OpenAI, Anthropic, or DeepSeek directly.",
  },
  {
    icon: Server,
    title: "Self-host anywhere",
    description:
      "Run RoleSpec on your own infrastructure or as a native Windows desktop app. You own the database.",
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
        className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl"
      >
        {title}
      </h2>
      <p className="text-pretty text-muted-foreground">{blurb}</p>
    </ScrollRevealItem>
  )
}

export default async function LandingPage() {
  const session = await auth()
  if (session?.user?.id) redirect("/dashboard")

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-brand-500/20">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:p-3 focus:text-foreground focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <MarketingNav />

      <main id="main-content" tabIndex={-1} className="flex-1">
        {/* Hero — centered headline, action, product. Nothing else. */}
        <section
          aria-labelledby="hero-heading"
          className="relative overflow-hidden border-b border-border"
        >
          <HiggsfieldAura />

          <HeroReveal className="relative mx-auto w-full max-w-3xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
            <HeroRevealItem className="flex justify-center">
              <AnimatedBadge />
            </HeroRevealItem>

            <HeroRevealItem>
              <h1
                id="hero-heading"
                className="mx-auto mt-6 max-w-2xl text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-6xl"
              >
                Your job search,
                <br />
                in one private place.
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                Tailor your resume to any role with local or cloud AI, score against ATS filters, write customized outreach, and track every application on one private board.
              </p>
            </HeroRevealItem>

            <HeroRevealItem className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "min-h-12 rounded-full px-7 text-sm font-medium"
                )}
              >
                Open workspace
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex min-h-12 items-center gap-1 text-sm text-brand-400 hover:underline hover:underline-offset-4"
              >
                See how it works
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </HeroRevealItem>

            <HeroRevealItem>
              <p className="mt-6 text-sm text-muted-foreground">
                Free and open source · Runs offline · Zero telemetry
              </p>
            </HeroRevealItem>

            <HeroRevealItem className="mt-12">
              <InteractivePreview />
            </HeroRevealItem>
          </HeroReveal>
        </section>

        {/* Modules — plain cards, no spotlight, no glow */}
        <section
          id="features"
          aria-labelledby="features-heading"
          className="relative mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20"
        >
          <ScrollReveal>
            <SectionHeading
              headingId="features-heading"
              title="Everything for your next application"
              blurb="Your resumes, saved jobs, ATS scans and outreach stay connected, so you can pick up where you left off."
            />

            <ul className="mt-12 grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((module) => (
                <ScrollRevealItem as="li" key={module.name}>
                  <SpotlightCard className="h-full">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground">
                      <module.icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 font-semibold text-foreground">{module.name}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                      {module.description}
                    </p>
                  </SpotlightCard>
                </ScrollRevealItem>
              ))}
            </ul>
          </ScrollReveal>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          aria-labelledby="how-it-works-heading"
          className="relative scroll-mt-20 border-y border-border bg-card/40"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <ScrollReveal>
              <SectionHeading
                headingId="how-it-works-heading"
                title="From your resume to your next opportunity"
                blurb="A clear, repeatable workflow for each application, with your edits saved locally."
              />

              <ol className="relative mt-12 grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-3">
                {STEPS.map((item) => (
                  <ScrollRevealItem as="li" key={item.step}>
                    <SpotlightCard className="h-full">
                      <span className="font-mono text-sm font-semibold text-brand-400">
                        {item.step}
                      </span>
                      <h3 className="mt-3 text-base font-semibold sm:text-lg">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                        {item.description}
                      </p>
                    </SpotlightCard>
                  </ScrollRevealItem>
                ))}
              </ol>
            </ScrollReveal>
          </div>
        </section>

        {/* Local AI & Cloud Model Showcase */}
        <section
          id="ai-stack"
          aria-labelledby="ai-stack-heading"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20"
        >
          <ScrollReveal>
            <SectionHeading
              headingId="ai-stack-heading"
              title="Run locally with Ollama, or bring any model"
              blurb="RoleSpec is designed for complete model freedom. Run local GGUF models on your GPU without internet, or connect ChatGPT, Claude, and DeepSeek."
            />

            <ModelShowcase />
          </ScrollReveal>
        </section>

        {/* Own your stack */}
        <section
          id="pricing"
          aria-labelledby="pricing-heading"
          className="border-t border-border bg-card/40"
        >
          <div className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20">
            <ScrollReveal>
              <SectionHeading
                headingId="pricing-heading"
                title="Own your stack. Run it yourself."
                blurb="Free, open source, and self-hosted. You own the deployment, the database, and the career data."
              />

              <ul className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
                {STACK.map((item) => (
                  <ScrollRevealItem as="li" key={item.title}>
                    <SpotlightCard className="flex h-full items-start gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                        <item.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">{item.title}</h3>
                        <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed sm:text-sm">
                          {item.description}
                        </p>
                      </div>
                    </SpotlightCard>
                  </ScrollRevealItem>
                ))}
              </ul>
            </ScrollReveal>
          </div>
        </section>

        {/* Final CTA */}
        <section
          aria-labelledby="cta-heading"
          className="relative mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24"
        >
          <ScrollReveal>
            <ScrollRevealItem>
              <h2
                id="cta-heading"
                className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-5xl"
              >
                Make your next application count
              </h2>
              <p className="mx-auto mt-4 max-w-md text-pretty text-sm text-muted-foreground sm:text-base">
                Start with your resume. Tailor it to a role with local or cloud AI. Keep every opportunity moving forward.
              </p>
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "mt-8 min-h-12 w-full rounded-full px-7 text-sm font-medium sm:w-auto"
                )}
              >
                Open workspace
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </ScrollRevealItem>
          </ScrollReveal>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
